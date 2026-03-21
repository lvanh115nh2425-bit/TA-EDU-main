const express = require("express");
const router = express.Router();
const { login } = require("../auth");

router.post("/login", async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: "missing_credentials" });
  }

  try {
    const token = await login(username.trim(), password);
    if (!token) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    res.json({ token });
  } catch (err) {
    console.error("login error", err);
    res.status(500).json({ error: "server_error" });
  }
});

module.exports = router;
