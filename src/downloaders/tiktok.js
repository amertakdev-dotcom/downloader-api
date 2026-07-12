const axios = require("axios");

const UA = process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Extract TikTok video ID from URL
 */
function extractTikTokId(url) {
  const patterns = [
    /tiktok\.com\/@[^/]+\/video\/(\d+)/,
    /tiktok\.com\/v\/(\d+)/,
    /vm\.tiktok\.com\/(\w+)/,
    /vt\.tiktok\.com\/(\w+)/,
    /tiktok\.com\/t\/(\w+)/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

/**
 * Tikwm returns some media links as root-relative paths (e.g.
 * "/video/media/play/xxxx.mp4") instead of full URLs. Passing a relative
 * path straight to the proxy-download endpoint makes `new URL(...)` throw
 * ("Invalid file URL"), so every tikwm-sourced link must be normalized to
 * an absolute https://www.tikwm.com/... URL before it's used anywhere.
 */
function absolutizeTikwmUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//i.test(url)) return url;
  return `https://www.tikwm.com${url.startsWith("/") ? "" : "/"}${url}`;
}

/**
 * Resolve short TikTok URL to full URL
 */
async function resolveShortUrl(url) {
  try {
    const res = await axios.get(url, {
      maxRedirects: 5,
      timeout: 10000,
      headers: { "User-Agent": UA },
      validateStatus: () => true,
    });
    return res.request?.res?.responseUrl || res.config?.url || url;
  } catch {
    return url;
  }
}

/**
 * Method 1: TikTok oEmbed API (for metadata)
 */
async function getTikTokOEmbed(url) {
  const res = await axios.get(
    `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`,
    { timeout: 10000, headers: { "User-Agent": UA } }
  );
  return res.data;
}

/**
 * Method 2: SnapTik API (no watermark)
 */
async function getFromSnapTik(url) {
  const res = await axios.post(
    "https://snaptik.app/abc2.php",
    new URLSearchParams({ url }),
    {
      timeout: 15000,
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://snaptik.app/",
        Origin: "https://snaptik.app",
      },
    }
  );
  const html = res.data;
  // Extract video URLs from response
  const videoUrls = [];
  const patterns = [
    /href="(https:\/\/[^"]+\.mp4[^"]*)"/g,
    /src="(https:\/\/[^"]+\.mp4[^"]*)"/g,
    /"(https:\/\/v\d+\.muscdn\.com[^"]*)"/g,
    /"(https:\/\/[^"]*tiktok[^"]*\.mp4[^"]*)"/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      const u = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
      if (u && !videoUrls.includes(u)) videoUrls.push(u);
    }
  }
  return videoUrls;
}

/**
 * Method 3: Tikwm API (reliable public API)
 */
async function getFromTikwm(url) {
  const res = await axios.post(
    "https://www.tikwm.com/api/",
    new URLSearchParams({ url, count: "12", cursor: "0", web: "1", hd: "1" }),
    {
      timeout: 15000,
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://www.tikwm.com/",
      },
    }
  );
  return res.data;
}

/**
 * Method 4: SSSTik
 */
async function getFromSssTik(url) {
  // Get token first
  const page = await axios.get("https://ssstik.io/", {
    timeout: 10000,
    headers: { "User-Agent": UA },
  });
  const tokenMatch = page.data.match(/s_tt\s*=\s*["']([^"']+)["']/);
  const token = tokenMatch ? tokenMatch[1] : "";

  const res = await axios.post(
    "https://ssstik.io/abc?url=dl",
    new URLSearchParams({ id: url, locale: "en", tt: token }),
    {
      timeout: 15000,
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://ssstik.io/",
        Origin: "https://ssstik.io",
        "HX-Request": "true",
        "HX-Target": "target",
        "HX-Current-URL": "https://ssstik.io/",
      },
    }
  );
  const html = res.data;
  const urls = [];
  const patterns = [
    /href="(https:\/\/[^"]+\.mp4[^"]*)"/g,
    /src="(https:\/\/[^"]+\.mp4[^"]*)"/g,
    /"(https:\/\/[^"]*tikcdn[^"]*)"/g,
  ];
  for (const p of patterns) {
    let m;
    while ((m = p.exec(html)) !== null) {
      const u = m[1].replace(/\\u0026/g, "&").replace(/\\/g, "");
      if (u && !urls.includes(u)) urls.push(u);
    }
  }
  return urls;
}

/**
 * Main TikTok Info function
 */
async function getTikTokInfo(url) {
  // Resolve short URLs
  let resolvedUrl = url;
  if (
    url.includes("vm.tiktok.com") ||
    url.includes("vt.tiktok.com") ||
    url.includes("/t/")
  ) {
    resolvedUrl = await resolveShortUrl(url);
  }

  const result = {
    success: true,
    platform: "tiktok",
    data: {
      url: resolvedUrl,
      title: null,
      author: null,
      thumbnail: null,
      duration: null,
      type: "video",
      downloads: {
        noWatermark: null,
        withWatermark: null,
        audio: null,
        images: [],
      },
    },
  };

  // ─── Step 1: Get metadata via oEmbed ──────────────────────────────────────
  try {
    const oembed = await getTikTokOEmbed(resolvedUrl);
    result.data.title = oembed.title || null;
    result.data.author = {
      name: oembed.author_name || null,
      url: oembed.author_url || null,
    };
    result.data.thumbnail = oembed.thumbnail_url || null;
    result.data.thumbnailWidth = oembed.thumbnail_width || null;
    result.data.thumbnailHeight = oembed.thumbnail_height || null;
  } catch (e) {
    console.warn("[TikTok] oEmbed failed:", e.message);
  }

  // ─── Step 2: Try Tikwm (most reliable) ───────────────────────────────────
  try {
    const tikwm = await getFromTikwm(resolvedUrl);
    if (tikwm && tikwm.code === 0 && tikwm.data) {
      const d = tikwm.data;
      if (!result.data.title) result.data.title = d.title || null;
      if (!result.data.author)
        result.data.author = {
          name: d.author?.nickname || d.author?.unique_id || null,
          uniqueId: d.author?.unique_id || null,
          avatar: d.author?.avatar || null,
        };
      if (!result.data.thumbnail) result.data.thumbnail = absolutizeTikwmUrl(d.cover || d.origin_cover) || null;
      result.data.duration = d.duration || null;
      result.data.playCount = d.play_count ?? null;
      result.data.likeCount = d.digg_count || null;
      result.data.commentCount = d.comment_count || null;
      result.data.shareCount = d.share_count || null;
      result.data.createTime = d.create_time || null;

      // Video downloads — tikwm sometimes returns these as root-relative
      // paths, so normalize each one to an absolute URL.
      if (d.play) result.data.downloads.noWatermark = absolutizeTikwmUrl(d.play);
      if (d.wmplay) result.data.downloads.withWatermark = absolutizeTikwmUrl(d.wmplay);
      if (d.hdplay) result.data.downloads.hdNoWatermark = absolutizeTikwmUrl(d.hdplay);
      if (d.music) result.data.downloads.audio = absolutizeTikwmUrl(d.music);
      if (d.music_info) {
        result.data.music = {
          title: d.music_info.title,
          author: d.music_info.author,
          duration: d.music_info.duration,
          url: absolutizeTikwmUrl(d.music_info.play),
          cover: absolutizeTikwmUrl(d.music_info.cover),
        };
      }

      // Image slides (TikTok photo posts)
      if (d.images && Array.isArray(d.images) && d.images.length > 0) {
        result.data.type = "image";
        result.data.downloads.images = d.images.map((img, i) => ({
          index: i + 1,
          url: absolutizeTikwmUrl(img),
        }));
      }

      if (result.data.downloads.noWatermark || result.data.downloads.images.length > 0) {
        return result;
      }
    }
  } catch (e) {
    console.warn("[TikTok] Tikwm failed:", e.message);
  }

  // ─── Step 3: Fallback to SnapTik ──────────────────────────────────────────
  try {
    const snapUrls = await getFromSnapTik(resolvedUrl);
    if (snapUrls.length > 0) {
      result.data.downloads.noWatermark = snapUrls[0];
      if (snapUrls[1]) result.data.downloads.withWatermark = snapUrls[1];
      return result;
    }
  } catch (e) {
    console.warn("[TikTok] SnapTik failed:", e.message);
  }

  // ─── Step 4: Fallback to SssTik ───────────────────────────────────────────
  try {
    const sssUrls = await getFromSssTik(resolvedUrl);
    if (sssUrls.length > 0) {
      result.data.downloads.noWatermark = sssUrls[0];
      if (sssUrls[1]) result.data.downloads.withWatermark = sssUrls[1];
      return result;
    }
  } catch (e) {
    console.warn("[TikTok] SssTik failed:", e.message);
  }

  // If nothing worked but we have metadata
  if (result.data.title || result.data.thumbnail) {
    result.data.warning = "Could not extract direct download links. Metadata only.";
    return result;
  }

  throw new Error("Failed to get TikTok data. The URL may be private or invalid.");
}

module.exports = { getTikTokInfo };
