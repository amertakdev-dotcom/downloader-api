const express = require("express");
const axios = require("axios");
const router = express.Router();

const UA = process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function sanitizeFilename(name) {
  return String(name || "download")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .trim()
    .slice(0, 150) || "download";
}

// ────────────────────────────────────────────────────────────────────────────────
// GET /api/proxy-download?url=...&filename=...&ext=mp4
//
// Streams the remote file through our own server and forces a real, one-click
// download (Content-Disposition: attachment) instead of letting the browser
// open the raw media URL in a new tab / native player.
// ────────────────────────────────────────────────────────────────────────────────
router.get("/proxy-download", async (req, res) => {
  const fileUrl = req.query.url;
  const ext = (req.query.ext || "").replace(/[^a-zA-Z0-9]/g, "");
  let filename = sanitizeFilename(req.query.filename);

  if (!fileUrl) {
    return res.status(400).json({ success: false, error: 'Missing "url" parameter.' });
  }

  let parsed;
  try {
    parsed = new URL(fileUrl);
  } catch {
    return res.status(400).json({ success: false, error: "Invalid file URL." });
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return res.status(400).json({ success: false, error: "Invalid file URL protocol." });
  }

  if (ext && !filename.toLowerCase().endsWith("." + ext.toLowerCase())) {
    filename += "." + ext;
  }

  try {
    const upstream = await axios.get(fileUrl, {
      responseType: "stream",
      timeout: 60000,
      maxRedirects: 5,
      headers: { "User-Agent": UA, Referer: parsed.origin },
      validateStatus: (s) => s >= 200 && s < 400,
    });

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", upstream.headers["content-type"] || "application/octet-stream");
    if (upstream.headers["content-length"]) {
      res.setHeader("Content-Length", upstream.headers["content-length"]);
    }

    upstream.data.pipe(res);
    upstream.data.on("error", (err) => {
      console.error("[proxy-download] stream error:", err.message);
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
  } catch (err) {
    console.error("[proxy-download] failed:", err.message);
    if (!res.headersSent) {
      res.status(502).json({
        success: false,
        error: "Failed to fetch the file. The link may have expired — try fetching it again.",
      });
    }
  }
});

module.exports = router;
