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
      "INSERT INTO user_profiles (uid, email, display_name, full_name, photo_url) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (uid) DO UPDATE SET email = EXCLUDED.email RETURNING *",
      [uid, req.user.email || null, req.user.name || null, req.user.name || null, req.user.picture || null]
    );
    return res.json({ profile: inserted.rows[0] });
  }

  const current = result.rows[0];
  const fallbackEmail = req.user.email || null;
  const fallbackDisplayName = req.user.name || null;
  const fallbackPhoto = req.user.picture || null;

  if (!current.email && !fallbackEmail && !current.display_name && !fallbackDisplayName && !current.photo_url && !fallbackPhoto) {
    return res.json({ profile: current });
  }

  const shouldRefreshProfile =
    (!current.email && fallbackEmail) ||
    (!current.display_name && fallbackDisplayName) ||
    (!current.full_name && fallbackDisplayName) ||
    (!current.photo_url && fallbackPhoto);

  if (shouldRefreshProfile) {
    const merged = await upsertProfile(uid, {
      email: current.email || fallbackEmail,
      display_name: current.display_name || fallbackDisplayName,
      full_name: current.full_name || fallbackDisplayName,
      photo_url: current.photo_url || fallbackPhoto,
    });
    return res.json({ profile: merged });
  }

  res.json({ profile: current });
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
