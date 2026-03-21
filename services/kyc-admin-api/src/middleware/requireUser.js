const { verifyIdToken } = require("../lib/firebaseAuth");

module.exports = async function requireUser(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "missing_token" });
  }
  const idToken = header.slice(7);
  try {
    const decoded = await verifyIdToken(idToken);
    req.user = decoded;
    next();
  } catch (err) {
    console.error("verifyIdToken failed", err);
    res.status(401).json({ error: "invalid_token" });
  }
};
