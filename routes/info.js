const express = require("express");
const router = express.Router();
const { getYouTubeInfo } = require("../src/downloaders/youtube");
const { getTikTokInfo } = require("../src/downloaders/tiktok");
const { getPinterestInfo } = require("../src/downloaders/pinterest");
const { getSpotifyInfo } = require("../src/downloaders/spotify");

/**
 * Auto-detect platform from URL
 */
function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("tiktok.com") || u.includes("vm.tiktok") || u.includes("vt.tiktok")) return "tiktok";
  if (u.includes("pinterest.com") || u.includes("pin.it")) return "pinterest";
  if (u.includes("spotify.com") || u.includes("open.spotify")) return "spotify";
  return null;
}

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/info?url=...  (auto-detect platform)
// ────────────────────────────────────────────────────────────────────────────────
router.get("/info", async (req, res) => {
  const url = (req.query.url || "").trim();
  if (!url) {
    return res.status(400).json({ success: false, error: 'Missing "url" parameter.' });
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({
      success: false,
      error: "Unsupported platform. Supported: YouTube, TikTok, Pinterest, Spotify.",
      detectedPlatform: null,
      supportedPlatforms: ["youtube", "tiktok", "pinterest", "spotify"],
    });
  }

  try {
    let data;
    switch (platform) {
      case "youtube":   data = await getYouTubeInfo(url); break;
      case "tiktok":    data = await getTikTokInfo(url); break;
      case "pinterest": data = await getPinterestInfo(url); break;
      case "spotify":   data = await getSpotifyInfo(url); break;
    }
    return res.json({ ...data, detectedPlatform: platform });
  } catch (err) {
    console.error(`[/api/info][${platform}]`, err.message);
    return res.status(500).json({
      success: false,
      platform,
      error: err.message || "Failed to fetch data.",
    });
  }
});

router.post("/info", async (req, res) => {
  const url = (req.body?.url || req.query.url || "").trim();
  if (!url) {
    return res.status(400).json({ success: false, error: 'Missing "url" parameter.' });
  }

  const platform = detectPlatform(url);
  if (!platform) {
    return res.status(400).json({
      success: false,
      error: "Unsupported platform.",
      supportedPlatforms: ["youtube", "tiktok", "pinterest", "spotify"],
    });
  }

  try {
    let data;
    switch (platform) {
      case "youtube":   data = await getYouTubeInfo(url); break;
      case "tiktok":    data = await getTikTokInfo(url); break;
      case "pinterest": data = await getPinterestInfo(url); break;
      case "spotify":   data = await getSpotifyInfo(url); break;
    }
    return res.json({ ...data, detectedPlatform: platform });
  } catch (err) {
    return res.status(500).json({ success: false, platform, error: err.message });
  }
});

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/detect?url=...  (just detect, don't download)
// ────────────────────────────────────────────────────────────────────────────────
router.get("/detect", (req, res) => {
  const url = (req.query.url || "").trim();
  if (!url) return res.status(400).json({ success: false, error: 'Missing "url" parameter.' });
  const platform = detectPlatform(url);
  return res.json({
    success: !!platform,
    url,
    platform: platform || null,
    supported: !!platform,
    message: platform
      ? `Platform detected: ${platform}`
      : "URL does not match any supported platform.",
  });
});

module.exports = router;
