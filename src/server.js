require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const downloadRoutes = require("../routes/download");
const infoRoutes = require("../routes/info");

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined"));

// ─── Rate Limiter ──────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests. Please try again later.",
    retryAfter: "60 seconds",
  },
});
app.use("/api/", limiter);

// ─── API Key Middleware (optional) ────────────────────────────────────────────
app.use("/api/", (req, res, next) => {
  const secret = process.env.API_SECRET_KEY;
  if (!secret || secret === "your_secret_key_here_change_this") return next();
  const provided = req.headers["x-api-key"] || req.query.apikey;
  if (!provided || provided !== secret) {
    return res.status(401).json({ success: false, error: "Unauthorized. Invalid API key." });
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use("/api", downloadRoutes);
app.use("/api", infoRoutes);

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  res.json({
    name: "Amertak Network - Downloader API",
    version: "1.0.0",
    status: "online",
    platforms: ["youtube", "tiktok", "pinterest", "spotify"],
    endpoints: {
      youtube: "GET /api/youtube?url=VIDEO_URL",
      tiktok: "GET /api/tiktok?url=VIDEO_OR_POST_URL",
      pinterest: "GET /api/pinterest?url=PIN_URL",
      spotify: "GET /api/spotify?url=TRACK_OR_ALBUM_URL",
      info: "GET /api/info?url=ANY_URL (auto-detect platform)",
    },
    docs: "Add x-api-key header if API_SECRET_KEY is set in .env",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: "Endpoint not found." });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[ERROR]", err);
  res.status(500).json({ success: false, error: err.message || "Internal server error." });
});

app.listen(PORT, () => {
  console.log(`✅ Amertak Downloader API running on port ${PORT}`);
  console.log(`🌐 http://localhost:${PORT}`);
});
