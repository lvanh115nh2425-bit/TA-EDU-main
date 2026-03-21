require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");

const { ensureSchema, ensureDefaultAdmin } = require("./db");
const authRouter = require("./routes/auth");
const kycRouter = require("./routes/kyc");
const profileRouter = require("./profile");
const qaRouter = require("./routes/qa");
const timetableRouter = require("./routes/timetable");
const legalRouter = require("./routes/legal");
const examRouter = require("./routes/exam");

const app = express();
const PORT = process.env.PORT || 4001;
const rawOrigins = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

let corsOptions = {};
if (!rawOrigins.length || rawOrigins.includes("*")) {
  corsOptions.origin = true; // reflect request origin
} else {
  corsOptions.origin = rawOrigins;
}

app.use(cors(corsOptions));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("tiny"));

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "kyc-admin-api" });
});

app.use("/api", authRouter);
app.use("/api/kyc", kycRouter);
app.use("/api/profile", profileRouter);
app.use("/api/qa", qaRouter);
app.use("/api/timetable", timetableRouter);
app.use("/api/legal", legalRouter);
app.use("/api/exam", examRouter);

app.use((err, req, res, next) => {
  console.error("Unhandled error", err);
  res.status(500).json({ error: "server_error" });
});

async function start() {
  try {
    await ensureSchema();
    await ensureDefaultAdmin();
    app.listen(PORT, () => {
      console.log(`KYC admin API listening on ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server", err);
    process.exit(1);
  }
}

start();
