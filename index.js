/**
 * Compatibility re-export.
 * Functions logic now lives in backend/firebase-functions/index.js
 * but we keep this bridge so old tooling continues to require("./index").
 */
module.exports = require("./backend/firebase-functions/index.js");
