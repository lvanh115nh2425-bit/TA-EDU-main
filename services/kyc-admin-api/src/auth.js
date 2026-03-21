const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { query } = require("./db");

const JWT_SECRET = process.env.JWT_SECRET || "taedu-admin-secret";
const TOKEN_TTL = process.env.JWT_TTL || "8h";

async function login(username, password) {
  const res = await query("SELECT id, password_hash FROM admins WHERE username = $1", [
    username,
  ]);
  if (!res.rowCount) return null;
  const admin = res.rows[0];
  const ok = await bcrypt.compare(password, admin.password_hash);
  if (!ok) return null;
  const token = jwt.sign({ sub: admin.id, username }, JWT_SECRET, {
    expiresIn: TOKEN_TTL,
  });
  return token;
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token" });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.admin = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid_token" });
  }
}

module.exports = {
  login,
  requireAuth,
};
