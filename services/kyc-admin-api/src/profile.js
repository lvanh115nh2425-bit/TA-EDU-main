const express = require("express");
const router = express.Router();
const { query } = require("./db");
const { upsertProfile } = require("./store/userProfiles");
const requireUser = require("./middleware/requireUser");

router.use(requireUser);

router.get("/me", async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "invalid_user" });
  const result = await query("SELECT * FROM user_profiles WHERE uid = $1", [uid]);
  if (!result.rowCount) {
    const inserted = await query(
      "INSERT INTO user_profiles (uid, email, display_name, photo_url) VALUES ($1,$2,$3,$4) ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email RETURNING *",
      [uid, req.user.email || null, req.user.name || null, req.user.picture || null]
    );
    return res.json({ profile: inserted.rows[0] });
  }
  res.json({ profile: result.rows[0] });
});

router.put("/me", async (req, res) => {
  const uid = req.user?.uid;
  if (!uid) return res.status(401).json({ error: "invalid_user" });
  try {
    const profile = await upsertProfile(uid, req.body || {});
    res.json({ profile });
  } catch (err) {
    console.error("update profile error", err);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
