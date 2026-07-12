const express = require("express");
const router = express.Router();
const { getYouTubeInfo } = require("../src/downloaders/youtube");
const { getTikTokInfo } = require("../src/downloaders/tiktok");
const { getPinterestInfo } = require("../src/downloaders/pinterest");
const { getSpotifyInfo } = require("../src/downloaders/spotify");

// ─── Validate URL helper ───────────────────────────────────────────────────────
function requireUrl(req, res) {
  const url = req.query.url || req.body?.url;
  if (!url) {
    res.status(400).json({ success: false, error: 'Missing "url" parameter.' });
    return null;
  }
  return url.trim();
}

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/youtube?url=...
// ────────────────────────────────────────────────────────────────────────────────
router.get("/youtube", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getYouTubeInfo(url);
    return res.json(data);
  } catch (err) {
    console.error("[/api/youtube]", err.message);
    return res.status(500).json({
      success: false,
      platform: "youtube",
      error: err.message || "Failed to fetch YouTube data.",
    });
  }
});

// Also support POST
router.post("/youtube", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getYouTubeInfo(url);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ success: false, platform: "youtube", error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/tiktok?url=...
// ────────────────────────────────────────────────────────────────────────────────
router.get("/tiktok", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getTikTokInfo(url);
    return res.json(data);
  } catch (err) {
    console.error("[/api/tiktok]", err.message);
    return res.status(500).json({
      success: false,
      platform: "tiktok",
      error: err.message || "Failed to fetch TikTok data.",
    });
  }
});

router.post("/tiktok", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getTikTokInfo(url);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ success: false, platform: "tiktok", error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/pinterest?url=...
// ────────────────────────────────────────────────────────────────────────────────
router.get("/pinterest", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getPinterestInfo(url);
    return res.json(data);
  } catch (err) {
    console.error("[/api/pinterest]", err.message);
    return res.status(500).json({
      success: false,
      platform: "pinterest",
      error: err.message || "Failed to fetch Pinterest data.",
    });
  }
});

router.post("/pinterest", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getPinterestInfo(url);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ success: false, platform: "pinterest", error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/spotify?url=...
// ────────────────────────────────────────────────────────────────────────────────
router.get("/spotify", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getSpotifyInfo(url);
    return res.json(data);
  } catch (err) {
    console.error("[/api/spotify]", err.message);
    return res.status(500).json({
      success: false,
      platform: "spotify",
      error: err.message || "Failed to fetch Spotify data.",
    });
  }
});

router.post("/spotify", async (req, res) => {
  const url = requireUrl(req, res);
  if (!url) return;
  try {
    const data = await getSpotifyInfo(url);
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ success: false, platform: "spotify", error: err.message });
  }
});

module.exports = router;
