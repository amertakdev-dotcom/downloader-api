const ytdl = require("@distube/ytdl-core");

/**
 * Get YouTube video info + download links
 * @param {string} url - YouTube video URL
 * @returns {object} - Video metadata + download formats
 */
async function getYouTubeInfo(url) {
  if (!ytdl.validateURL(url)) {
    throw new Error("Invalid YouTube URL.");
  }

  const info = await ytdl.getInfo(url, {
    requestOptions: {
      headers: {
        "User-Agent": process.env.USER_AGENT ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    },
  });

  const videoDetails = info.videoDetails;

  // ─── Thumbnail (highest quality) ──────────────────────────────────────────
  const thumbnails = videoDetails.thumbnails || [];
  const thumbnail = thumbnails.length > 0
    ? thumbnails[thumbnails.length - 1].url
    : null;

  // ─── Filter Formats ───────────────────────────────────────────────────────
  const allFormats = info.formats;

  // Video formats with audio (muxed)
  const videoFormats = allFormats
    .filter((f) => f.hasVideo && f.hasAudio && f.container === "mp4")
    .map((f) => ({
      quality: f.qualityLabel || f.quality,
      itag: f.itag,
      mimeType: f.mimeType,
      container: f.container,
      fps: f.fps,
      bitrate: f.bitrate,
      contentLength: f.contentLength ? parseInt(f.contentLength) : null,
      fileSizeMB: f.contentLength
        ? (parseInt(f.contentLength) / 1024 / 1024).toFixed(2)
        : null,
      url: f.url,
    }))
    .sort((a, b) => {
      const parseQ = (q) => parseInt((q || "0").replace(/\D/g, "")) || 0;
      return parseQ(b.quality) - parseQ(a.quality);
    });

  // Audio only formats
  const audioFormats = allFormats
    .filter((f) => !f.hasVideo && f.hasAudio)
    .map((f) => ({
      quality: f.audioBitrate ? `${f.audioBitrate}kbps` : "unknown",
      itag: f.itag,
      mimeType: f.mimeType,
      container: f.container,
      audioBitrate: f.audioBitrate,
      contentLength: f.contentLength ? parseInt(f.contentLength) : null,
      fileSizeMB: f.contentLength
        ? (parseInt(f.contentLength) / 1024 / 1024).toFixed(2)
        : null,
      url: f.url,
    }))
    .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

  // Best picks
  const bestVideo = videoFormats[0] || null;
  const bestAudio = audioFormats[0] || null;

  return {
    success: true,
    platform: "youtube",
    data: {
      videoId: videoDetails.videoId,
      title: videoDetails.title,
      description: videoDetails.shortDescription || videoDetails.description,
      duration: videoDetails.lengthSeconds,
      durationFormatted: formatDuration(parseInt(videoDetails.lengthSeconds)),
      viewCount: videoDetails.viewCount,
      author: {
        name: videoDetails.author?.name,
        channelUrl: videoDetails.author?.channel_url,
        thumbnail: videoDetails.author?.thumbnails?.[0]?.url || null,
      },
      thumbnail,
      thumbnails,
      isLive: videoDetails.isLiveContent,
      uploadDate: videoDetails.uploadDate,
      keywords: videoDetails.keywords || [],
      bestDownload: {
        video: bestVideo
          ? {
              quality: bestVideo.quality,
              url: bestVideo.url,
              fileSizeMB: bestVideo.fileSizeMB,
              container: bestVideo.container,
            }
          : null,
        audio: bestAudio
          ? {
              quality: bestAudio.quality,
              url: bestAudio.url,
              fileSizeMB: bestAudio.fileSizeMB,
              container: bestAudio.container,
            }
          : null,
      },
      formats: {
        video: videoFormats,
        audio: audioFormats,
      },
    },
  };
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

module.exports = { getYouTubeInfo };
