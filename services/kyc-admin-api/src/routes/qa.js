const express = require("express");
const router = express.Router();
const { query } = require("../db");
const requireUser = require("../middleware/requireUser");
const { verifyIdToken } = require("../lib/firebaseAuth");
const {
  moderateTextFields,
  sanitizeTagList,
  sanitizeImageData,
  sanitizeImageDataList,
  isAdminProfile,
  moderateWithGemini,
} = require("../lib/communityModeration");
const {
  enforceTrustAction,
  applyTrustPenalty,
  rewardCleanContribution,
  getTrustRestrictions,
} = require("../lib/trustScore");

const PAGE_LIMIT = 30;
const DAILY_IMAGE_LIMIT = 10;
const DAILY_IMAGE_TIMEZONE = "Asia/Saigon";

async function fetchUserProfile(uid) {
  if (!uid) return null;
  const result = await query(
    "SELECT display_name, photo_url, role, gender, trust_points, trust_history FROM user_profiles WHERE uid = $1",
    [uid]
  );
  return result.rowCount ? result.rows[0] : null;
}

async function fetchProfilesByUids(uids = []) {
  const clean = Array.from(new Set((uids || []).filter(Boolean)));
  if (!clean.length) return new Map();
  const result = await query(
    "SELECT uid, display_name, photo_url, role, gender FROM user_profiles WHERE uid = ANY($1::text[])",
    [clean]
  );
  const profileMap = new Map();
  result.rows.forEach((row) => profileMap.set(row.uid, row));
  return profileMap;
}

function mapPostRow(row, commentsMap, likeMap, likedSet, profileMap = new Map()) {
  const liveProfile = profileMap.get(row.user_uid);
  const imageUrls =
    (Array.isArray(row.image_urls) && row.image_urls.filter(Boolean)) ||
    (row.image_url ? [row.image_url] : []);
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags || [],
    image_url: imageUrls[0] || row.image_url || null,
    image_urls: imageUrls,
    likes: Number(likeMap.get(row.id) || 0),
    liked: likedSet ? likedSet.has(row.id) : false,
    created_at: row.created_at,
    author: {
      uid: row.user_uid,
      name: liveProfile?.display_name || row.author_name,
      avatar: liveProfile?.photo_url || row.author_avatar,
      role: liveProfile?.role || row.author_role,
      gender: liveProfile?.gender || null,
    },
    comments: commentsMap.get(row.id) || [],
  };
}

function mapCommentRow(row, profileMap = new Map()) {
  const liveProfile = profileMap.get(row.user_uid);
  const imageUrls =
    (Array.isArray(row.image_urls) && row.image_urls.filter(Boolean)) ||
    (row.image_url ? [row.image_url] : []);
  return {
    id: row.id,
    post_id: row.post_id,
    parent_comment_id: row.parent_comment_id,
    content: row.content,
    image_url: imageUrls[0] || row.image_url || null,
    image_urls: imageUrls,
    created_at: row.created_at,
    author: {
      uid: row.user_uid,
      name: liveProfile?.display_name || row.author_name,
      avatar: liveProfile?.photo_url || row.author_avatar,
      role: liveProfile?.role || row.author_role,
      gender: liveProfile?.gender || null,
    },
    replies: [],
  };
}

function buildCommentTree(rows, profileMap = new Map()) {
  const commentsById = new Map();
  const roots = [];

  rows.forEach((row) => {
    const mapped = mapCommentRow(row, profileMap);
    commentsById.set(mapped.id, mapped);
  });

  rows.forEach((row) => {
    const mapped = commentsById.get(row.id);
    const parentId = row.parent_comment_id;
    if (parentId && commentsById.has(parentId)) {
      commentsById.get(parentId).replies.push(mapped);
    } else {
      roots.push(mapped);
    }
  });

  return roots;
}

function normalizeImageInputs(body = {}) {
  const fromList = Array.isArray(body.imageDataList) ? body.imageDataList : [];
  const fallback = body.imageData ? [body.imageData] : [];
  const merged = [...fromList, ...fallback].filter(Boolean);
  return Array.from(new Set(merged));
}

async function getTodayImageUsage(uid) {
  if (!uid) return 0;
  const sql = `
    WITH usage_rows AS (
      SELECT COALESCE(array_length(image_urls, 1), CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END, 0) AS total
      FROM qa_posts
      WHERE user_uid = $1
        AND (created_at AT TIME ZONE '${DAILY_IMAGE_TIMEZONE}')::date = (NOW() AT TIME ZONE '${DAILY_IMAGE_TIMEZONE}')::date
      UNION ALL
      SELECT COALESCE(array_length(image_urls, 1), CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END, 0) AS total
      FROM qa_comments
      WHERE user_uid = $1
        AND (created_at AT TIME ZONE '${DAILY_IMAGE_TIMEZONE}')::date = (NOW() AT TIME ZONE '${DAILY_IMAGE_TIMEZONE}')::date
    )
    SELECT COALESCE(SUM(total), 0) AS total FROM usage_rows
  `;
  const result = await query(sql, [uid]);
  return Number(result.rows?.[0]?.total || 0);
}

async function enforceDailyImageQuota(uid, requestedCount) {
  const count = Number(requestedCount || 0);
  if (!count) {
    return { ok: true, used: await getTodayImageUsage(uid), remaining: DAILY_IMAGE_LIMIT };
  }
  const used = await getTodayImageUsage(uid);
  const nextTotal = used + count;
  if (nextTotal > DAILY_IMAGE_LIMIT) {
    return {
      ok: false,
      code: "daily_image_limit_reached",
      message: `Mỗi ngày bạn chỉ được đăng tối đa ${DAILY_IMAGE_LIMIT} ảnh cho cả bài viết và bình luận.`,
      used,
      requested: count,
      remaining: Math.max(0, DAILY_IMAGE_LIMIT - used),
      limit: DAILY_IMAGE_LIMIT,
    };
  }
  return {
    ok: true,
    used,
    requested: count,
    remaining: Math.max(0, DAILY_IMAGE_LIMIT - nextTotal),
    limit: DAILY_IMAGE_LIMIT,
  };
}

router.get("/", async (req, res) => {
  try {
    const viewerUid = await getViewerUid(req);
    const posts = await query(
      "SELECT * FROM qa_posts ORDER BY created_at DESC LIMIT $1",
      [Number(req.query.limit) || PAGE_LIMIT]
    );
    const ids = posts.rows.map((row) => row.id);
    const commentsMap = new Map();
    const likesMap = new Map();
    let likedSet = null;

    if (ids.length) {
      const profileUids = posts.rows.map((row) => row.user_uid).filter(Boolean);
      const comments = await query(
        "SELECT * FROM qa_comments WHERE post_id = ANY($1::int[]) ORDER BY created_at ASC",
        [ids]
      );
      comments.rows.forEach((row) => {
        if (row.user_uid) profileUids.push(row.user_uid);
      });
      const profileMap = await fetchProfilesByUids(profileUids);
      const commentsByPost = new Map();
      comments.rows.forEach((row) => {
        if (!commentsByPost.has(row.post_id)) commentsByPost.set(row.post_id, []);
        commentsByPost.get(row.post_id).push(row);
      });
      commentsByPost.forEach((rows, postIdValue) => {
        commentsMap.set(postIdValue, buildCommentTree(rows, profileMap));
      });

      const likes = await query(
        "SELECT post_id, COUNT(*) AS total FROM qa_likes WHERE post_id = ANY($1::int[]) GROUP BY post_id",
        [ids]
      );
      likes.rows.forEach((row) => likesMap.set(row.post_id, Number(row.total)));

      if (viewerUid) {
        likedSet = new Set();
        const likedRows = await query(
          "SELECT post_id FROM qa_likes WHERE user_uid = $1 AND post_id = ANY($2::int[])",
          [viewerUid, ids]
        );
        likedRows.rows.forEach((row) => likedSet.add(row.post_id));
      }

      return res.json({
        posts: posts.rows.map((row) => mapPostRow(row, commentsMap, likesMap, likedSet, profileMap)),
      });
    }

    res.json({ posts: posts.rows.map((row) => mapPostRow(row, commentsMap, likesMap, likedSet)) });
  } catch (err) {
    console.error("qa GET error", err);
    res.status(500).json({ error: "server_error", message: "Khong tai duoc danh sach bai dang." });
  }
});

router.post("/", requireUser, async (req, res) => {
  const { title, body, tags } = req.body || {};
  const imageDataList = normalizeImageInputs(req.body || {});
  if (!title || !body) {
    return res.status(400).json({ error: "missing_title_body", message: "Thieu tieu de hoac noi dung." });
  }

  try {
    const trustGate = await enforceTrustAction(req.user.uid, {
      action: "post",
      withImage: imageDataList.length > 0,
    });
    if (!trustGate.ok) {
      return res.status(403).json({
        error: trustGate.code,
        message: trustGate.message,
        trust: trustGate.trust,
        restrictions: trustGate.restrictions,
      });
    }

    const moderation = moderateTextFields([
      { label: "tieu de", value: title },
      { label: "noi dung", value: body },
      ...(Array.isArray(tags) ? tags.map((tag) => ({ label: "tu khoa", value: tag })) : []),
    ]);
    if (!moderation.ok) {
      const trustProfile = await applyTrustPenalty(req.user.uid, "profanity", { action: "post" });
      return res.status(400).json({
        error: moderation.code,
        message: moderation.message,
        trust: trustProfile?.trust_points ?? trustGate.trust,
      });
    }

    const imageListResult = sanitizeImageDataList(imageDataList);
    if (!imageListResult.ok) {
      return res.status(400).json({ error: imageListResult.code, message: imageListResult.message });
    }

    const dailyQuota = await enforceDailyImageQuota(req.user.uid, imageListResult.value.length);
    if (!dailyQuota.ok) {
      return res.status(400).json({
        error: dailyQuota.code,
        message: dailyQuota.message,
        used: dailyQuota.used,
        remaining: dailyQuota.remaining,
        limit: dailyQuota.limit,
      });
    }

    const aiModeration = await moderateWithGemini({
      texts: [title, body, ...(Array.isArray(tags) ? tags : [])],
      imageDataList: imageListResult.value,
    });
    if (!aiModeration.ok && aiModeration.code !== "moderation_service_error") {
      let trust = trustGate.trust;
      if (aiModeration.code === "moderated_by_ai") {
        const trustProfile = await applyTrustPenalty(
          req.user.uid,
          imageListResult.value.length ? "sensitive_image" : "profanity",
          { action: "post" }
        );
        trust = trustProfile?.trust_points ?? trust;
      }
      const status = aiModeration.code === "moderation_service_error" ? 503 : 400;
      return res.status(status).json({
        error: aiModeration.code,
        message: aiModeration.message,
        trust,
      });
    }
    if (!aiModeration.ok && aiModeration.code === "moderation_service_error") {
      console.warn("qa POST moderation soft-failed", aiModeration.message);
    }

    const profile = await fetchUserProfile(req.user.uid);
    const authorName = profile?.display_name || req.user.name || req.user.email || "Nguoi dung";
    const authorAvatar = profile?.photo_url || req.user.picture || null;
    const authorRole = profile?.role || req.user.role || null;
    const result = await query(
      `INSERT INTO qa_posts (user_uid, title, body, tags, author_name, author_avatar, author_role, image_url, image_urls)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        req.user.uid,
        String(title).trim(),
        String(body).trim(),
        sanitizeTagList(tags),
        authorName,
        authorAvatar,
        authorRole,
        imageListResult.value[0] || null,
        imageListResult.value.length ? imageListResult.value : null,
      ]
    );
    const trustProfile = await rewardCleanContribution(req.user.uid, "post");
    const trust = trustProfile?.trust_points ?? trustGate.trust;

    res.status(201).json({
      post: mapPostRow(result.rows[0], new Map(), new Map(), new Set()),
      trust,
      restrictions: getTrustRestrictions(trust),
    });
  } catch (err) {
    console.error("qa POST error", err);
    res.status(500).json({ error: "server_error", message: "Khong the dang bai." });
  }
});

router.post("/:id/comments", requireUser, async (req, res) => {
  const postId = Number(req.params.id);
  if (!postId) {
    return res.status(400).json({ error: "invalid_post_id", message: "ID bai dang khong hop le." });
  }

  const { content, parentCommentId } = req.body || {};
  const imageDataList = normalizeImageInputs(req.body || {});
  const commentText = String(content || "").trim();
  if (!commentText && !imageDataList.length) {
    return res.status(400).json({ error: "missing_content", message: "Binh luan can co noi dung hoac hinh anh." });
  }

  try {
    const trustGate = await enforceTrustAction(req.user.uid, {
      action: "comment",
      withImage: imageDataList.length > 0,
    });
    if (!trustGate.ok) {
      return res.status(403).json({
        error: trustGate.code,
        message: trustGate.message,
        trust: trustGate.trust,
        restrictions: trustGate.restrictions,
      });
    }

    if (commentText) {
      const moderation = moderateTextFields([{ label: "binh luan", value: commentText }]);
      if (!moderation.ok) {
        const trustProfile = await applyTrustPenalty(req.user.uid, "profanity", { action: "comment" });
        return res.status(400).json({
          error: moderation.code,
          message: moderation.message,
          trust: trustProfile?.trust_points ?? trustGate.trust,
        });
      }
    }

    const imageListResult = sanitizeImageDataList(imageDataList);
    if (!imageListResult.ok) {
      return res.status(400).json({ error: imageListResult.code, message: imageListResult.message });
    }

    const dailyQuota = await enforceDailyImageQuota(req.user.uid, imageListResult.value.length);
    if (!dailyQuota.ok) {
      return res.status(400).json({
        error: dailyQuota.code,
        message: dailyQuota.message,
        used: dailyQuota.used,
        remaining: dailyQuota.remaining,
        limit: dailyQuota.limit,
      });
    }

    const aiModeration = await moderateWithGemini({
      texts: commentText ? [commentText] : [],
      imageDataList: imageListResult.value,
    });
    if (!aiModeration.ok && aiModeration.code !== "moderation_service_error") {
      let trust = trustGate.trust;
      if (aiModeration.code === "moderated_by_ai") {
        const trustProfile = await applyTrustPenalty(
          req.user.uid,
          imageListResult.value.length ? "sensitive_image" : "profanity",
          { action: "comment" }
        );
        trust = trustProfile?.trust_points ?? trust;
      }
      const status = aiModeration.code === "moderation_service_error" ? 503 : 400;
      return res.status(status).json({
        error: aiModeration.code,
        message: aiModeration.message,
        trust,
      });
    }
    if (!aiModeration.ok && aiModeration.code === "moderation_service_error") {
      console.warn("qa comment moderation soft-failed", aiModeration.message);
    }

    const profile = await fetchUserProfile(req.user.uid);
    const authorName = profile?.display_name || req.user.name || req.user.email || "Nguoi dung";
    const authorAvatar = profile?.photo_url || req.user.picture || null;
    const authorRole = profile?.role || req.user.role || null;
    const check = await query("SELECT id FROM qa_posts WHERE id = $1", [postId]);
    if (!check.rowCount) {
      return res.status(404).json({ error: "post_not_found", message: "Khong tim thay bai dang." });
    }

    let parentId = null;
    if (parentCommentId != null && parentCommentId !== "") {
      parentId = Number(parentCommentId);
      if (!parentId) {
        return res.status(400).json({ error: "invalid_parent_comment_id", message: "ID binh luan goc khong hop le." });
      }
      const parentCheck = await query(
        "SELECT id FROM qa_comments WHERE id = $1 AND post_id = $2",
        [parentId, postId]
      );
      if (!parentCheck.rowCount) {
        return res.status(404).json({ error: "parent_comment_not_found", message: "Khong tim thay binh luan can tra loi." });
      }
    }

    const result = await query(
      `INSERT INTO qa_comments (post_id, parent_comment_id, user_uid, content, image_url, image_urls, author_name, author_avatar, author_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        postId,
        parentId,
        req.user.uid,
        commentText,
        imageListResult.value[0] || null,
        imageListResult.value.length ? imageListResult.value : null,
        authorName,
        authorAvatar,
        authorRole,
      ]
    );
    const trustProfile = await rewardCleanContribution(req.user.uid, "comment");
    const trust = trustProfile?.trust_points ?? trustGate.trust;

    res.status(201).json({
      comment: mapCommentRow(result.rows[0]),
      trust,
      restrictions: getTrustRestrictions(trust),
    });
  } catch (err) {
    console.error("qa comment error", err);
    res.status(500).json({ error: "server_error", message: "Khong the gui binh luan." });
  }
});

router.post("/:id/like", requireUser, async (req, res) => {
  const postId = Number(req.params.id);
  if (!postId) {
    return res.status(400).json({ error: "invalid_post_id", message: "ID bai dang khong hop le." });
  }

  try {
    const check = await query("SELECT id FROM qa_posts WHERE id = $1", [postId]);
    if (!check.rowCount) {
      return res.status(404).json({ error: "post_not_found", message: "Khong tim thay bai dang." });
    }

    const existing = await query(
      "SELECT id FROM qa_likes WHERE post_id = $1 AND user_uid = $2",
      [postId, req.user.uid]
    );
    let liked;
    if (existing.rowCount) {
      await query("DELETE FROM qa_likes WHERE id = $1", [existing.rows[0].id]);
      liked = false;
    } else {
      await query("INSERT INTO qa_likes (post_id, user_uid) VALUES ($1, $2)", [postId, req.user.uid]);
      liked = true;
    }

    const count = await query("SELECT COUNT(*) AS total FROM qa_likes WHERE post_id = $1", [postId]);
    res.json({ liked, likes: Number(count.rows[0].total) });
  } catch (err) {
    console.error("qa like error", err);
    res.status(500).json({ error: "server_error", message: "Khong the cap nhat luot thich." });
  }
});

router.delete("/:id", requireUser, async (req, res) => {
  const postId = Number(req.params.id);
  if (!postId) {
    return res.status(400).json({ error: "invalid_post_id", message: "ID bai dang khong hop le." });
  }

  try {
    const profile = await fetchUserProfile(req.user.uid);
    const existing = await query("SELECT id, user_uid FROM qa_posts WHERE id = $1", [postId]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: "post_not_found", message: "Khong tim thay bai dang." });
    }
    const canDelete = isAdminProfile(req.user, profile) || existing.rows[0].user_uid === req.user.uid;
    if (!canDelete) {
      return res.status(403).json({ error: "forbidden", message: "Ban khong co quyen xoa bai dang nay." });
    }

    await query("DELETE FROM qa_posts WHERE id = $1", [postId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("qa delete error", err);
    res.status(500).json({ error: "server_error", message: "Khong the xoa bai dang." });
  }
});

router.delete("/:postId/comments/:commentId", requireUser, async (req, res) => {
  const postId = Number(req.params.postId);
  const commentId = Number(req.params.commentId);
  if (!postId || !commentId) {
    return res.status(400).json({ error: "invalid_comment_id", message: "ID binh luan khong hop le." });
  }

  try {
    const profile = await fetchUserProfile(req.user.uid);
    const existing = await query(
      `SELECT c.id, c.user_uid, p.user_uid AS post_owner_uid
       FROM qa_comments c
       JOIN qa_posts p ON p.id = c.post_id
       WHERE c.id = $1 AND c.post_id = $2`,
      [commentId, postId]
    );
    if (!existing.rowCount) {
      return res.status(404).json({ error: "comment_not_found", message: "Khong tim thay binh luan." });
    }
    const row = existing.rows[0];
    const canDelete =
      isAdminProfile(req.user, profile) ||
      row.user_uid === req.user.uid ||
      row.post_owner_uid === req.user.uid;
    if (!canDelete) {
      return res.status(403).json({ error: "forbidden", message: "Ban khong co quyen xoa binh luan nay." });
    }

    await query("DELETE FROM qa_comments WHERE id = $1", [commentId]);
    res.json({ ok: true });
  } catch (err) {
    console.error("qa delete comment error", err);
    res.status(500).json({ error: "server_error", message: "Khong the xoa binh luan." });
  }
});

module.exports = router;

async function getViewerUid(req) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  try {
    const decoded = await verifyIdToken(token);
    return decoded?.uid || null;
  } catch (_) {
    return null;
  }
}
