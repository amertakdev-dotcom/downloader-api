const axios = require("axios");
const ytdl = require("@distube/ytdl-core");

const UA = process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function validateYouTubeURL(url) {
  return !!(
    url.includes("youtube.com") ||
    url.includes("youtu.be") ||
    url.includes("youtube-nocookie.com")
  );
}

// ─── Method 0: @distube/ytdl-core (PRIMARY — direct from YouTube, no 3rd party) ─
// Cobalt's public "/api/json" endpoint was shut down in Nov 2024, and the
// remaining public cobalt.tools instance has since been blocked by YouTube's
// anti-bot measures — so ytdl-core is now the only reliable source of real
// download links. It resolves googlevideo.com CDN URLs straight from YouTube.
async function getFromYtdlCore(url) {
  try {
    const info = await ytdl.getInfo(url, {
      requestOptions: { headers: { "User-Agent": UA } },
    });
    const allFormats = info.formats || [];

    // Progressive formats (video+audio already muxed together) — these are
    // the ones that can be downloaded directly with one click, no merging
    // needed. YouTube usually offers these up to 720p (itags 18, 22).
    const progressive = allFormats
      .filter((f) => f.hasVideo && f.hasAudio && f.url)
      .sort((a, b) => (b.height || 0) - (a.height || 0));

    // Audio-only formats (highest bitrate first)
    const audioOnly = allFormats
      .filter((f) => f.hasAudio && !f.hasVideo && f.url)
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

    return {
      videoDetails: info.videoDetails,
      progressive,
      audioOnly,
    };
  } catch (e) {
    console.warn("[YouTube] ytdl-core failed:", e.message);
    return null;
  }
}

function bytesToMB(bytes) {
  if (!bytes) return null;
  return Math.round((parseInt(bytes) / (1024 * 1024)) * 10) / 10;
}

// ─── Method 1: Cobalt API (legacy fallback — public instances are largely dead) ─
async function getFromCobalt(url, quality = "1080") {
  const cobaltInstances = [
    "https://cobalt.tools",
    "https://co.wuk.sh",
    "https://cobalt-api.rkm0959.moe",
    "https://cobalt.api.timelessnesses.me",
    "https://cobalt.floofy.dev",
  ];

  for (const instance of cobaltInstances) {
    try {
      const res = await axios.post(
        `${instance}/api/json`,
        {
          url,
          vQuality: quality,
          filenamePattern: "basic",
          isAudioOnly: false,
          disableMetadata: false,
        },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": UA,
          },
        }
      );
      if (res.data && (res.data.url || res.data.status === "stream" || res.data.status === "redirect")) {
        return { instance, data: res.data };
      }
    } catch (e) {
      console.warn(`[Cobalt] ${instance} failed:`, e.message);
      continue;
    }
  }
  return null;
}

// Audio only via Cobalt
async function getAudioFromCobalt(url) {
  const cobaltInstances = [
    "https://cobalt.tools",
    "https://co.wuk.sh",
    "https://cobalt-api.rkm0959.moe",
  ];
  for (const instance of cobaltInstances) {
    try {
      const res = await axios.post(
        `${instance}/api/json`,
        { url, isAudioOnly: true, filenamePattern: "basic" },
        {
          timeout: 15000,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "User-Agent": UA,
          },
        }
      );
      if (res.data?.url || res.data?.status === "stream") {
        return res.data;
      }
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Method 2: YouTube oEmbed (metadata only, always works) ──────────────────
async function getYouTubeOEmbed(url) {
  const res = await axios.get(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
    { timeout: 10000, headers: { "User-Agent": UA } }
  );
  return res.data;
}

// ─── Method 3: YouTube Noembed (metadata fallback) ───────────────────────────
async function getYouTubeNoembed(url) {
  const res = await axios.get(
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
    { timeout: 10000, headers: { "User-Agent": UA } }
  );
  return res.data;
}

// ─── Method 4: YouTube page scrape for metadata ───────────────────────────────
async function scrapeYouTubePage(videoId) {
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const res = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  const html = res.data;

  const data = {};

  // Title
  const titleMatch = html.match(/"title":"([^"]+)"/);
  if (titleMatch) data.title = titleMatch[1].replace(/\\u[\dA-F]{4}/gi, c =>
    String.fromCharCode(parseInt(c.replace(/\\u/i, ""), 16))
  );

  // Duration
  const durMatch = html.match(/"lengthSeconds":"(\d+)"/);
  if (durMatch) data.duration = parseInt(durMatch[1]);

  // View count
  const viewMatch = html.match(/"viewCount":"(\d+)"/);
  if (viewMatch) data.viewCount = viewMatch[1];

  // Author
  const authorMatch = html.match(/"author":"([^"]+)"/);
  if (authorMatch) data.author = authorMatch[1];

  // Channel URL
  const channelMatch = html.match(/"channelUrl":"([^"]+)"/);
  if (channelMatch) data.channelUrl = channelMatch[1];

  // Upload date
  const dateMatch = html.match(/"uploadDate":"([^"]+)"/);
  if (dateMatch) data.uploadDate = dateMatch[1];

  // Keywords
  const kwMatch = html.match(/"keywords":\[([^\]]+)\]/);
  if (kwMatch) {
    try {
      data.keywords = JSON.parse(`[${kwMatch[1]}]`);
    } catch { data.keywords = []; }
  }

  // Short description
  const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  if (descMatch) {
    data.description = descMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .substring(0, 500);
  }

  // Is live
  data.isLive = html.includes('"isLiveContent":true');

  return data;
}

// ─── Method 5: y2mate fallback ───────────────────────────────────────────────
async function getFromY2Mate(url, videoId) {
  try {
    // Step 1: analyze
    const analyzeRes = await axios.post(
      "https://www.y2mate.com/mates/analyzeV2/ajax",
      new URLSearchParams({
        k_query: url,
        k_page: "home",
        hl: "en",
        q_auto: "0",
      }),
      {
        timeout: 15000,
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://www.y2mate.com/",
        },
      }
    );

    const analyzeData = analyzeRes.data;
    if (!analyzeData?.links) return null;

    const formats = [];

    // mp4 video
    if (analyzeData.links.mp4) {
      for (const [quality, info] of Object.entries(analyzeData.links.mp4)) {
        if (info.k) {
          formats.push({
            quality: info.q || quality,
            format: "mp4",
            size: info.size || null,
            k: info.k,
            type: "video",
          });
        }
      }
    }

    // mp3 audio
    if (analyzeData.links.mp3) {
      for (const [quality, info] of Object.entries(analyzeData.links.mp3)) {
        if (info.k) {
          formats.push({
            quality: info.q || quality,
            format: "mp3",
            size: info.size || null,
            k: info.k,
            type: "audio",
          });
        }
      }
    }

    return {
      vid: analyzeData.vid || videoId,
      title: analyzeData.title || null,
      formats,
      _raw: analyzeData,
    };
  } catch (e) {
    console.warn("[Y2Mate] failed:", e.message);
    return null;
  }
}

// ─── Method 6: SaveFrom.net ───────────────────────────────────────────────────
async function getFromSaveFrom(url) {
  try {
    const res = await axios.get(
      `https://worker.sf-tools.com/savefrom.php?sf_url=${encodeURIComponent(url)}`,
      {
        timeout: 12000,
        headers: {
          "User-Agent": UA,
          Referer: "https://en.savefrom.net/",
        },
      }
    );
    return res.data;
  } catch {
    return null;
  }
}

// ─── Main Export ──────────────────────────────────────────────────────────────
async function getYouTubeInfo(url) {
  if (!validateYouTubeURL(url)) {
    throw new Error("Invalid YouTube URL.");
  }

  const videoId = extractVideoId(url);

  const result = {
    success: true,
    platform: "youtube",
    data: {
      videoId,
      title: null,
      description: null,
      duration: null,
      durationFormatted: null,
      viewCount: null,
      author: { name: null, channelUrl: null, thumbnail: null },
      thumbnail: null,
      thumbnails: [],
      isLive: false,
      uploadDate: null,
      keywords: [],
      bestDownload: { video: null, audio: null },
      formats: { video: [], audio: [] },
      cobaltLinks: [],
    },
  };

  // ── Build thumbnail URLs from videoId (always works, no API) ──────────────
  if (videoId) {
    result.data.thumbnails = [
      { url: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`, width: 1280, height: 720 },
      { url: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`, width: 640, height: 480 },
      { url: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`, width: 480, height: 360 },
      { url: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`, width: 320, height: 180 },
      { url: `https://img.youtube.com/vi/${videoId}/default.jpg`, width: 120, height: 90 },
    ];
    result.data.thumbnail = result.data.thumbnails[0].url;
  }

  // ── Step 1: oEmbed metadata (fast & always works) ─────────────────────────
  try {
    const oembed = await getYouTubeOEmbed(url);
    result.data.title = oembed.title || null;
    result.data.author.name = oembed.author_name || null;
    result.data.author.channelUrl = oembed.author_url || null;
    if (oembed.thumbnail_url) {
      result.data.thumbnail = oembed.thumbnail_url;
      result.data.thumbnails.unshift({ url: oembed.thumbnail_url, width: oembed.thumbnail_width, height: oembed.thumbnail_height });
    }
  } catch (e) {
    console.warn("[YouTube] oEmbed failed:", e.message);
    // Try noembed fallback
    try {
      const ne = await getYouTubeNoembed(url);
      if (ne?.title) result.data.title = ne.title;
      if (ne?.author_name) result.data.author.name = ne.author_name;
    } catch {}
  }

  // ── Step 2: Scrape page for extended metadata ─────────────────────────────
  if (videoId) {
    try {
      const scraped = await scrapeYouTubePage(videoId);
      if (scraped.title && !result.data.title) result.data.title = scraped.title;
      if (scraped.duration) {
        result.data.duration = scraped.duration;
        result.data.durationFormatted = formatDuration(scraped.duration);
      }
      if (scraped.viewCount) result.data.viewCount = scraped.viewCount;
      if (scraped.author && !result.data.author.name) result.data.author.name = scraped.author;
      if (scraped.channelUrl) result.data.author.channelUrl = scraped.channelUrl;
      if (scraped.uploadDate) result.data.uploadDate = scraped.uploadDate;
      if (scraped.keywords?.length) result.data.keywords = scraped.keywords;
      if (scraped.description) result.data.description = scraped.description;
      if (typeof scraped.isLive === "boolean") result.data.isLive = scraped.isLive;
    } catch (e) {
      console.warn("[YouTube] Page scrape failed:", e.message);
    }
  }

  // ── Step 3: ytdl-core for real download links (primary) ───────────────────
  const cobaltLinks = [];
  let usedYtdlCore = false;

  try {
    const ytd = await getFromYtdlCore(url);
    if (ytd) {
      usedYtdlCore = true;

      // Fill in any metadata still missing from oEmbed/scrape
      const vd = ytd.videoDetails || {};
      if (!result.data.title && vd.title) result.data.title = vd.title;
      if (!result.data.author.name && vd.author?.name) result.data.author.name = vd.author.name;
      if (!result.data.duration && vd.lengthSeconds) {
        result.data.duration = parseInt(vd.lengthSeconds);
        result.data.durationFormatted = formatDuration(result.data.duration);
      }

      for (const f of ytd.progressive) {
        cobaltLinks.push({
          quality: f.qualityLabel || `${f.height || "?"}p`,
          url: f.url,
          type: "video",
          source: "ytdl-core",
          format: f.container || "mp4",
          fileSizeMB: bytesToMB(f.contentLength),
        });
      }

      for (const f of ytd.audioOnly.slice(0, 3)) {
        cobaltLinks.push({
          quality: f.audioBitrate ? `${f.audioBitrate}kbps` : "best",
          url: f.url,
          type: "audio",
          source: "ytdl-core",
          format: f.container || "m4a",
          fileSizeMB: bytesToMB(f.contentLength),
        });
      }
    }
  } catch (e) {
    console.warn("[YouTube] ytdl-core step failed:", e.message);
  }

  // ── Step 3b: Cobalt API for download links (legacy fallback) ──────────────
  const qualityList = ["1080", "720", "480", "360"];

  if (!usedYtdlCore || cobaltLinks.length === 0) {
  for (const q of qualityList) {
    try {
      const cobalt = await getFromCobalt(url, q);
      if (cobalt?.data?.url) {
        cobaltLinks.push({
          quality: `${q}p`,
          url: cobalt.data.url,
          type: "video",
          source: cobalt.instance,
          format: "mp4",
          fileSizeMB: null,
        });
        // Only need the first working instance for multiple qualities
        if (cobaltLinks.length === 1) break; // Get one quality first, then continue
      }
    } catch {}
    // Don't spam, just get top quality
    if (cobaltLinks.length > 0) break;
  }

  // If first quality worked, get others from same instance
  if (cobaltLinks.length > 0) {
    const workingInstance = cobaltLinks[0].source;
    for (const q of ["720", "480", "360"]) {
      if (cobaltLinks.find(l => l.quality === `${q}p`)) continue;
      try {
        const res = await axios.post(
          `${workingInstance}/api/json`,
          { url, vQuality: q, filenamePattern: "basic", isAudioOnly: false },
          { timeout: 12000, headers: { "Content-Type": "application/json", Accept: "application/json" } }
        );
        if (res.data?.url) {
          cobaltLinks.push({
            quality: `${q}p`,
            url: res.data.url,
            type: "video",
            source: workingInstance,
            format: "mp4",
            fileSizeMB: null,
          });
        }
      } catch {}
    }

    // Audio from same instance
    try {
      const audioRes = await axios.post(
        `${workingInstance}/api/json`,
        { url, isAudioOnly: true, filenamePattern: "basic" },
        { timeout: 12000, headers: { "Content-Type": "application/json", Accept: "application/json" } }
      );
      if (audioRes.data?.url) {
        cobaltLinks.push({
          quality: "best",
          url: audioRes.data.url,
          type: "audio",
          source: workingInstance,
          format: "mp3",
          fileSizeMB: null,
        });
      }
    } catch {}
  } else {
    // Cobalt fully failed — try audio-only fallback
    try {
      const audioData = await getAudioFromCobalt(url);
      if (audioData?.url) {
        cobaltLinks.push({
          quality: "best",
          url: audioData.url,
          type: "audio",
          source: "cobalt",
          format: "mp3",
          fileSizeMB: null,
        });
      }
    } catch {}
  }
  } // end cobalt fallback (only runs when ytdl-core produced nothing)

  result.data.cobaltLinks = cobaltLinks;

  // Map links to formats structure (same shape as before for HTML compatibility)
  result.data.formats.video = cobaltLinks
    .filter(l => l.type === "video")
    .map(l => ({
      quality: l.quality,
      itag: null,
      mimeType: `video/${l.format || "mp4"}`,
      container: l.format || "mp4",
      fps: null,
      bitrate: null,
      contentLength: null,
      fileSizeMB: l.fileSizeMB || null,
      url: l.url,
    }));

  result.data.formats.audio = cobaltLinks
    .filter(l => l.type === "audio")
    .map(l => ({
      quality: l.quality || "best",
      itag: null,
      mimeType: `audio/${l.format || "mp3"}`,
      container: l.format || "mp3",
      audioBitrate: null,
      contentLength: null,
      fileSizeMB: l.fileSizeMB || null,
      url: l.url,
    }));

  // bestDownload
  const bestVid = result.data.formats.video[0] || null;
  const bestAud = result.data.formats.audio[0] || null;

  result.data.bestDownload = {
    video: bestVid ? { quality: bestVid.quality, url: bestVid.url, fileSizeMB: bestVid.fileSizeMB, container: bestVid.container } : null,
    audio: bestAud ? { quality: bestAud.quality, url: bestAud.url, fileSizeMB: bestAud.fileSizeMB, container: bestAud.container } : null,
  };

  // ── Step 4: Y2Mate fallback if Cobalt gave nothing ────────────────────────
  if (!bestVid && !bestAud && videoId) {
    try {
      const y2 = await getFromY2Mate(url, videoId);
      if (y2) {
        if (!result.data.title && y2.title) result.data.title = y2.title;
        result.data.y2mateFormats = y2.formats;

        const videoFmts = y2.formats.filter(f => f.type === "video");
        const audioFmts = y2.formats.filter(f => f.type === "audio");

        result.data.formats.video = videoFmts.map(f => ({
          quality: f.quality,
          itag: null,
          mimeType: "video/mp4",
          container: "mp4",
          fps: null,
          bitrate: null,
          contentLength: null,
          fileSizeMB: f.size || null,
          url: null, // Y2Mate needs a second convert call — provide k key
          y2mateKey: f.k,
          y2mateVid: y2.vid,
          note: "Requires convert call with y2mateKey",
        }));

        result.data.formats.audio = audioFmts.map(f => ({
          quality: f.quality,
          itag: null,
          mimeType: "audio/mp3",
          container: "mp3",
          audioBitrate: null,
          contentLength: null,
          fileSizeMB: f.size || null,
          url: null,
          y2mateKey: f.k,
          y2mateVid: y2.vid,
          note: "Requires convert call with y2mateKey",
        }));

        result.data.y2mateNote = "Direct URLs not available from Y2Mate — use y2mateKey to call convert endpoint separately.";
      }
    } catch (e) {
      console.warn("[YouTube] Y2Mate failed:", e.message);
    }
  }

  // ── Step 5: SaveFrom fallback ──────────────────────────────────────────────
  if (!bestVid && !bestAud && videoId) {
    try {
      const sf = await getFromSaveFrom(url);
      if (sf?.url?.length) {
        result.data.saveFromLinks = sf.url.map(u => ({
          quality: u.name || "unknown",
          url: u.url,
          type: "video",
          size: u.size || null,
        }));
        if (!result.data.bestDownload.video && result.data.saveFromLinks[0]?.url) {
          result.data.bestDownload.video = {
            quality: result.data.saveFromLinks[0].quality,
            url: result.data.saveFromLinks[0].url,
            fileSizeMB: null,
            container: "mp4",
          };
        }
      }
    } catch (e) {
      console.warn("[YouTube] SaveFrom failed:", e.message);
    }
  }

  // Warning if no download found at all
  if (!result.data.bestDownload.video && !result.data.bestDownload.audio &&
      !result.data.saveFromLinks?.length && !result.data.y2mateFormats?.length) {
    result.data.warning = "Could not obtain download links. All fallback methods failed. The video may be age-restricted, private, or unavailable in the server region.";
  }

  return result;
}

module.exports = { getYouTubeInfo, getFromYtdlCore };
