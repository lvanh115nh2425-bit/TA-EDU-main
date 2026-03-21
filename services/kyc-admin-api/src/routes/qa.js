const express = require("express");
const router = express.Router();
const { query } = require("../db");
const requireUser = require("../middleware/requireUser");
const { verifyIdToken } = require("../lib/firebaseAuth");

const PAGE_LIMIT = 30;

async function fetchUserProfile(uid) {
  if (!uid) return null;
  const result = await query("SELECT display_name, photo_url, role FROM user_profiles WHERE uid = $1", [uid]);
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
    let commentsMap = new Map();
    let likesMap = new Map();
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
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/", requireUser, async (req, res) => {
  const { title, body, tags, imageData } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: "missing_title_body" });
  }
  try {
    const profile = await fetchUserProfile(req.user.uid);
    const authorName = profile?.display_name || req.user.name || req.user.email || "Người dùng";
    const authorAvatar = profile?.photo_url || req.user.picture || null;
    const authorRole = profile?.role || req.user.role || null;
    const result = await query(
      `INSERT INTO qa_posts (user_uid, title, body, tags, author_name, author_avatar, author_role, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        req.user.uid,
        title,
        body,
        Array.isArray(tags) ? tags.slice(0, 8) : null,
        authorName,
        authorAvatar,
        authorRole,
        sanitizeImageData(imageData)
      ]
    );
    const postRow = result.rows[0];
    res.status(201).json({
      post: mapPostRow(postRow, new Map(), new Map(), new Set())
    });
  } catch (err) {
    console.error("qa POST error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/comments", requireUser, async (req, res) => {
  const postId = Number(req.params.id);
  if (!postId) return res.status(400).json({ error: "invalid_post_id" });
  const { content } = req.body || {};
  if (!content || !content.trim()) {
    return res.status(400).json({ error: "missing_content" });
  }
  try {
    const profile = await fetchUserProfile(req.user.uid);
    const authorName = profile?.display_name || req.user.name || req.user.email || "Người dùng";
    const authorAvatar = profile?.photo_url || req.user.picture || null;
    const authorRole = profile?.role || req.user.role || null;
    const check = await query("SELECT id FROM qa_posts WHERE id = $1", [postId]);
    if (!check.rowCount) return res.status(404).json({ error: "post_not_found" });
    const result = await query(
      `INSERT INTO qa_comments (post_id, user_uid, content, author_name, author_avatar, author_role)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [postId, req.user.uid, content, authorName, authorAvatar, authorRole]
    );
    res.status(201).json({ comment: mapCommentRow(result.rows[0]) });
  } catch (err) {
    console.error("qa comment error", err);
    res.status(500).json({ error: "server_error" });
  }
});

router.post("/:id/like", requireUser, async (req, res) => {
  const postId = Number(req.params.id);
  if (!postId) return res.status(400).json({ error: "invalid_post_id" });
  try {
    const check = await query("SELECT id FROM qa_posts WHERE id = $1", [postId]);
    if (!check.rowCount) return res.status(404).json({ error: "post_not_found" });
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
    res.status(500).json({ error: "server_error" });
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
  } catch (err) {
    return null;
  }
}

function sanitizeImageData(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("data:image/")) return null;
  // Limit to ~4MB
  if (Buffer.byteLength(trimmed, "utf-8") > 4 * 1024 * 1024) {
    return null;
  }
  return trimmed;
}
