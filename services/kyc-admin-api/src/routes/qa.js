const express = require("express");
const router = express.Router();
const { query } = require("../db");
const requireUser = require("../middleware/requireUser");
const { verifyIdToken } = require("../lib/firebaseAuth");
const {
  moderateTextFields,
  sanitizeTagList,
  sanitizeImageData,
  isAdminProfile,
  moderateWithOpenAI,
} = require("../lib/communityModeration");
const {
  enforceTrustAction,
  applyTrustPenalty,
  rewardCleanContribution,
  getTrustRestrictions,
} = require("../lib/trustScore");

const PAGE_LIMIT = 30;

async function fetchUserProfile(uid) {
  if (!uid) return null;
  const result = await query(
    "SELECT display_name, photo_url, role, trust_points, trust_history FROM user_profiles WHERE uid = $1",
    [uid]
  );
  return result.rowCount ? result.rows[0] : null;
}

function mapPostRow(row, commentsMap, likeMap, likedSet) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    tags: row.tags || [],
    image_url: row.image_url,
    likes: Number(likeMap.get(row.id) || 0),
    liked: likedSet ? likedSet.has(row.id) : false,
    created_at: row.created_at,
    author: {
      name: row.author_name,
      avatar: row.author_avatar,
      role: row.author_role,
    },
    comments: commentsMap.get(row.id) || [],
  };
}

function mapCommentRow(row) {
  return {
    id: row.id,
    content: row.content,
    created_at: row.created_at,
    author: {
      name: row.author_name,
      avatar: row.author_avatar,
      role: row.author_role,
    },
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
      const comments = await query(
        "SELECT * FROM qa_comments WHERE post_id = ANY($1::int[]) ORDER BY created_at ASC",
        [ids]
      );
      comments.rows.forEach((row) => {
        if (!commentsMap.has(row.post_id)) commentsMap.set(row.post_id, []);
        commentsMap.get(row.post_id).push(mapCommentRow(row));
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
    }

    res.json({ posts: posts.rows.map((row) => mapPostRow(row, commentsMap, likesMap, likedSet)) });
  } catch (err) {
    console.error("qa GET error", err);
    res.status(500).json({ error: "server_error", message: "Khong tai duoc danh sach bai dang." });
  }
});

router.post("/", requireUser, async (req, res) => {
  const { title, body, tags, imageData } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: "missing_title_body", message: "Thieu tieu de hoac noi dung." });
  }

  try {
    const trustGate = await enforceTrustAction(req.user.uid, {
      action: "post",
      withImage: Boolean(imageData),
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

    const imageResult = imageData ? sanitizeImageData(imageData) : { ok: true, value: null };
    if (!imageResult.ok) {
      return res.status(400).json({ error: imageResult.code, message: imageResult.message });
    }

    const aiModeration = await moderateWithOpenAI({
      texts: [title, body, ...(Array.isArray(tags) ? tags : [])],
      imageData: imageResult.value,
    });
    if (!aiModeration.ok) {
      let trust = trustGate.trust;
      if (aiModeration.code === "moderated_by_ai") {
        const trustProfile = await applyTrustPenalty(
          req.user.uid,
          imageResult.value ? "sensitive_image" : "profanity",
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

    const profile = await fetchUserProfile(req.user.uid);
    const authorName = profile?.display_name || req.user.name || req.user.email || "Nguoi dung";
    const authorAvatar = profile?.photo_url || req.user.picture || null;
    const authorRole = profile?.role || req.user.role || null;
    const result = await query(
      `INSERT INTO qa_posts (user_uid, title, body, tags, author_name, author_avatar, author_role, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.user.uid,
        String(title).trim(),
        String(body).trim(),
        sanitizeTagList(tags),
        authorName,
        authorAvatar,
        authorRole,
        imageResult.value,
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

  const { content } = req.body || {};
  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: "missing_content", message: "Noi dung binh luan dang trong." });
  }

  try {
    const trustGate = await enforceTrustAction(req.user.uid, {
      action: "comment",
      withImage: false,
    });
    if (!trustGate.ok) {
      return res.status(403).json({
        error: trustGate.code,
        message: trustGate.message,
        trust: trustGate.trust,
        restrictions: trustGate.restrictions,
      });
    }

    const moderation = moderateTextFields([{ label: "binh luan", value: content }]);
    if (!moderation.ok) {
      const trustProfile = await applyTrustPenalty(req.user.uid, "profanity", { action: "comment" });
      return res.status(400).json({
        error: moderation.code,
        message: moderation.message,
        trust: trustProfile?.trust_points ?? trustGate.trust,
      });
    }

    const aiModeration = await moderateWithOpenAI({ texts: [content] });
    if (!aiModeration.ok) {
      let trust = trustGate.trust;
      if (aiModeration.code === "moderated_by_ai") {
        const trustProfile = await applyTrustPenalty(req.user.uid, "profanity", { action: "comment" });
        trust = trustProfile?.trust_points ?? trust;
      }
      const status = aiModeration.code === "moderation_service_error" ? 503 : 400;
      return res.status(status).json({
        error: aiModeration.code,
        message: aiModeration.message,
        trust,
      });
    }

    const profile = await fetchUserProfile(req.user.uid);
    const authorName = profile?.display_name || req.user.name || req.user.email || "Nguoi dung";
    const authorAvatar = profile?.photo_url || req.user.picture || null;
    const authorRole = profile?.role || req.user.role || null;
    const check = await query("SELECT id FROM qa_posts WHERE id = $1", [postId]);
    if (!check.rowCount) {
      return res.status(404).json({ error: "post_not_found", message: "Khong tim thay bai dang." });
    }

    const result = await query(
      `INSERT INTO qa_comments (post_id, user_uid, content, author_name, author_avatar, author_role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [postId, req.user.uid, String(content).trim(), authorName, authorAvatar, authorRole]
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
    if (!isAdminProfile(req.user, profile)) {
      return res.status(403).json({ error: "forbidden", message: "Chi admin moi co quyen xoa bai dang." });
    }

    const existing = await query("SELECT id FROM qa_posts WHERE id = $1", [postId]);
    if (!existing.rowCount) {
      return res.status(404).json({ error: "post_not_found", message: "Khong tim thay bai dang." });
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
    if (!isAdminProfile(req.user, profile)) {
      return res.status(403).json({ error: "forbidden", message: "Chi admin moi co quyen xoa binh luan." });
    }

    const existing = await query(
      "SELECT id FROM qa_comments WHERE id = $1 AND post_id = $2",
      [commentId, postId]
    );
    if (!existing.rowCount) {
      return res.status(404).json({ error: "comment_not_found", message: "Khong tim thay binh luan." });
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
