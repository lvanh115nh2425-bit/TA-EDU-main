const express = require("express");
const router = express.Router();
const { query } = require("../db");
const requireUser = require("../middleware/requireUser");

const SEARCH_LIMIT = 8;
const MESSAGE_LIMIT = 150;
const ADMIN_EMAILS = (process.env.TAEDU_ADMIN_EMAILS || "khkt.anhtu@gmail.com,lvanh.115nh2425@gmail.com")
  .split(",")
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

router.use(requireUser);

function normalizePair(uidA, uidB) {
  return [uidA, uidB].sort((a, b) => String(a || "").localeCompare(String(b || "")));
}

function trimMessage(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function mapProfile(row) {
  return {
    uid: row.uid,
    display_name: row.display_name || row.full_name || row.email || "Người dùng",
    full_name: row.full_name || "",
    email: row.email || "",
    photo_url: row.photo_url || null,
    role: row.role || "student",
  };
}

async function fetchProfilesByUids(uids = []) {
  const clean = Array.from(new Set((uids || []).filter(Boolean)));
  if (!clean.length) return new Map();
  const result = await query(
    `SELECT uid, display_name, full_name, email, photo_url, role
       FROM user_profiles
      WHERE uid = ANY($1::text[])`,
    [clean]
  );
  return new Map(result.rows.map((row) => [row.uid, mapProfile(row)]));
}

async function ensureConversationAccess(conversationId, uid) {
  const result = await query(
    `SELECT *
       FROM inbox_conversations
      WHERE id = $1
        AND ($2 = user_a_uid OR $2 = user_b_uid)`,
    [conversationId, uid]
  );
  return result.rows[0] || null;
}

function mapConversation(row, profileMap, viewerUid) {
  const peerUid = row.user_a_uid === viewerUid ? row.user_b_uid : row.user_a_uid;
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_message_preview: row.last_message_preview || "",
    unread_count: Number(row.unread_count || 0),
    pinned: Boolean(row.pinned_for_viewer),
    peer: profileMap.get(peerUid) || {
      uid: peerUid,
      display_name: "Người dùng",
      full_name: "",
      email: "",
      photo_url: null,
      role: "student",
    },
  };
}

router.get("/conversations", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const result = await query(
      `SELECT c.*,
              CASE
                WHEN c.user_a_uid = $1 THEN c.pinned_by_a
                ELSE c.pinned_by_b
              END AS pinned_for_viewer,
              (
                SELECT COUNT(*)
                  FROM inbox_messages m
                 WHERE m.conversation_id = c.id
                   AND m.sender_uid <> $1
                   AND m.read_at IS NULL
              ) AS unread_count
         FROM inbox_conversations c
        WHERE c.user_a_uid = $1 OR c.user_b_uid = $1
        ORDER BY pinned_for_viewer DESC, c.updated_at DESC`,
      [viewerUid]
    );

    const peerUids = result.rows.map((row) => (row.user_a_uid === viewerUid ? row.user_b_uid : row.user_a_uid));
    const profileMap = await fetchProfilesByUids(peerUids);

    res.json({
      conversations: result.rows.map((row) => mapConversation(row, profileMap, viewerUid)),
    });
  } catch (err) {
    console.error("inbox conversations error", err);
    res.status(500).json({ error: "server_error", message: "Không thể tải danh sách hội thoại." });
  }
});

router.get("/summary", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const result = await query(
      `SELECT COUNT(*) AS unread_total
         FROM inbox_messages m
         JOIN inbox_conversations c ON c.id = m.conversation_id
        WHERE m.sender_uid <> $1
          AND m.read_at IS NULL
          AND (c.user_a_uid = $1 OR c.user_b_uid = $1)`,
      [viewerUid]
    );
    res.json({ unread_total: Number(result.rows[0]?.unread_total || 0) });
  } catch (err) {
    console.error("inbox summary error", err);
    res.status(500).json({ error: "server_error", message: "Không thể tải tổng quan inbox." });
  }
});

router.get("/admins", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const result = await query(
      `SELECT uid, display_name, full_name, email, photo_url, role
         FROM user_profiles
        WHERE uid <> $1
          AND (
            LOWER(COALESCE(role, '')) = 'admin'
            OR LOWER(COALESCE(email, '')) = ANY($2::text[])
          )
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 8`,
      [viewerUid, ADMIN_EMAILS]
    );
    res.json({ admins: result.rows.map(mapProfile) });
  } catch (err) {
    console.error("inbox admin list error", err);
    res.status(500).json({ error: "server_error", message: "Không thể tải danh sách admin." });
  }
});

router.get("/users", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const keyword = String(req.query.q || "").trim();
    if (keyword.length < 1) {
      return res.json({ users: [] });
    }

    const result = await query(
      `SELECT uid, display_name, full_name, email, photo_url, role
         FROM user_profiles
        WHERE uid <> $1
          AND (
            COALESCE(display_name, '') ILIKE $2
            OR COALESCE(full_name, '') ILIKE $2
            OR COALESCE(email, '') ILIKE $2
          )
        ORDER BY
          CASE WHEN COALESCE(display_name, '') ILIKE $3 THEN 0 ELSE 1 END,
          updated_at DESC NULLS LAST,
          created_at DESC NULLS LAST
        LIMIT $4`,
      [viewerUid, `%${keyword}%`, `${keyword}%`, SEARCH_LIMIT]
    );

    res.json({ users: result.rows.map(mapProfile) });
  } catch (err) {
    console.error("inbox user search error", err);
    res.status(500).json({ error: "server_error", message: "Không thể tìm người dùng để nhắn tin." });
  }
});

router.post("/conversations", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const targetUid = String(req.body?.targetUid || "").trim();
    if (!targetUid) {
      return res.status(400).json({ error: "missing_target_uid", message: "Thiếu người nhận." });
    }
    if (targetUid === viewerUid) {
      return res.status(400).json({ error: "invalid_target_uid", message: "Bạn không thể tự nhắn cho chính mình." });
    }

    const targetResult = await query(
      `SELECT uid, display_name, full_name, email, photo_url, role
         FROM user_profiles
        WHERE uid = $1`,
      [targetUid]
    );
    if (!targetResult.rowCount) {
      return res.status(404).json({ error: "target_not_found", message: "Không tìm thấy người nhận." });
    }

    const [userA, userB] = normalizePair(viewerUid, targetUid);
    const existing = await query(
      `SELECT *
         FROM inbox_conversations
        WHERE user_a_uid = $1 AND user_b_uid = $2`,
      [userA, userB]
    );

    let conversation = existing.rows[0];
    if (!conversation) {
      const inserted = await query(
        `INSERT INTO inbox_conversations (user_a_uid, user_b_uid)
         VALUES ($1, $2)
         RETURNING *`,
        [userA, userB]
      );
      conversation = inserted.rows[0];
    }

    const profileMap = await fetchProfilesByUids([viewerUid, targetUid]);
    res.status(existing.rowCount ? 200 : 201).json({
      conversation: mapConversation(
        { ...conversation, unread_count: 0, pinned_for_viewer: conversation.user_a_uid === viewerUid ? conversation.pinned_by_a : conversation.pinned_by_b },
        profileMap,
        viewerUid
      ),
    });
  } catch (err) {
    console.error("create conversation error", err);
    res.status(500).json({ error: "server_error", message: "Không thể tạo hội thoại." });
  }
});

router.get("/conversations/:id/messages", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const conversationId = Number(req.params.id);
    if (!conversationId) {
      return res.status(400).json({ error: "invalid_conversation_id", message: "ID hội thoại không hợp lệ." });
    }

    const conversation = await ensureConversationAccess(conversationId, viewerUid);
    if (!conversation) {
      return res.status(404).json({ error: "conversation_not_found", message: "Không tìm thấy hội thoại." });
    }

    const result = await query(
      `SELECT id, conversation_id, sender_uid, content, created_at, read_at
         FROM inbox_messages
        WHERE conversation_id = $1
        ORDER BY created_at ASC
        LIMIT $2`,
      [conversationId, MESSAGE_LIMIT]
    );
    const senderUids = result.rows.map((row) => row.sender_uid);
    const profileMap = await fetchProfilesByUids(senderUids);

    res.json({
      messages: result.rows.map((row) => ({
        id: row.id,
        conversation_id: row.conversation_id,
        sender_uid: row.sender_uid,
        content: row.content,
        created_at: row.created_at,
        read_at: row.read_at,
        sender: profileMap.get(row.sender_uid) || {
          uid: row.sender_uid,
          display_name: "Người dùng",
          full_name: "",
          email: "",
          photo_url: null,
          role: "student",
        },
      })),
    });
  } catch (err) {
    console.error("inbox messages error", err);
    res.status(500).json({ error: "server_error", message: "Không thể tải tin nhắn." });
  }
});

router.post("/conversations/:id/messages", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const conversationId = Number(req.params.id);
    if (!conversationId) {
      return res.status(400).json({ error: "invalid_conversation_id", message: "ID hội thoại không hợp lệ." });
    }

    const conversation = await ensureConversationAccess(conversationId, viewerUid);
    if (!conversation) {
      return res.status(404).json({ error: "conversation_not_found", message: "Không tìm thấy hội thoại." });
    }

    const content = trimMessage(req.body?.content);
    if (!content) {
      return res.status(400).json({ error: "missing_content", message: "Tin nhắn đang trống." });
    }

    const inserted = await query(
      `INSERT INTO inbox_messages (conversation_id, sender_uid, content)
       VALUES ($1, $2, $3)
       RETURNING id, conversation_id, sender_uid, content, created_at, read_at`,
      [conversationId, viewerUid, content]
    );

    await query(
      `UPDATE inbox_conversations
          SET updated_at = NOW(),
              last_message_preview = $2
        WHERE id = $1`,
      [conversationId, content.slice(0, 280)]
    );

    const profileMap = await fetchProfilesByUids([viewerUid]);
    res.status(201).json({
      message: {
        ...inserted.rows[0],
        sender: profileMap.get(viewerUid),
      },
    });
  } catch (err) {
    console.error("send inbox message error", err);
    res.status(500).json({ error: "server_error", message: "Không thể gửi tin nhắn." });
  }
});

router.post("/conversations/:id/read", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const conversationId = Number(req.params.id);
    if (!conversationId) {
      return res.status(400).json({ error: "invalid_conversation_id", message: "ID hội thoại không hợp lệ." });
    }

    const conversation = await ensureConversationAccess(conversationId, viewerUid);
    if (!conversation) {
      return res.status(404).json({ error: "conversation_not_found", message: "Không tìm thấy hội thoại." });
    }

    await query(
      `UPDATE inbox_messages
          SET read_at = NOW()
        WHERE conversation_id = $1
          AND sender_uid <> $2
          AND read_at IS NULL`,
      [conversationId, viewerUid]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("mark inbox read error", err);
    res.status(500).json({ error: "server_error", message: "Không thể cập nhật trạng thái đã đọc." });
  }
});

router.post("/conversations/:id/pin", async (req, res) => {
  try {
    const viewerUid = req.user.uid;
    const conversationId = Number(req.params.id);
    if (!conversationId) {
      return res.status(400).json({ error: "invalid_conversation_id", message: "ID hội thoại không hợp lệ." });
    }

    const conversation = await ensureConversationAccess(conversationId, viewerUid);
    if (!conversation) {
      return res.status(404).json({ error: "conversation_not_found", message: "Không tìm thấy hội thoại." });
    }

    const nextPinned = Boolean(req.body?.pinned);
    const column = conversation.user_a_uid === viewerUid ? "pinned_by_a" : "pinned_by_b";
    await query(`UPDATE inbox_conversations SET ${column} = $2 WHERE id = $1`, [conversationId, nextPinned]);
    res.json({ ok: true, pinned: nextPinned });
  } catch (err) {
    console.error("pin inbox conversation error", err);
    res.status(500).json({ error: "server_error", message: "Không thể ghim hội thoại." });
  }
});

module.exports = router;
