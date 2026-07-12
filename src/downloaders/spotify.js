const axios = require("axios");
const cheerio = require("cheerio");
const { getFromYtdlCore } = require("./youtube");

const UA = process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Detect Spotify content type from URL
 */
function detectSpotifyType(url) {
  if (url.includes("/track/")) return "track";
  if (url.includes("/album/")) return "album";
  if (url.includes("/playlist/")) return "playlist";
  if (url.includes("/artist/")) return "artist";
  if (url.includes("/episode/")) return "episode";
  return "unknown";
}

/**
 * Extract Spotify ID from URL
 */
function extractSpotifyId(url) {
  const match = url.match(/spotify\.com\/(?:intl-[a-z]+\/)?(?:track|album|playlist|artist|episode)\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

/**
 * Get Spotify oEmbed data (no API key needed)
 */
async function getSpotifyOEmbed(url) {
  const res = await axios.get(
    `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
    {
      timeout: 10000,
      headers: { "User-Agent": UA },
    }
  );
  return res.data;
}

/**
 * Scrape Spotify open page for metadata
 */
async function scrapeSpotifyPage(url) {
  const res = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  return res.data;
}

/**
 * Method: SpotifyDown (free download service)
 */
async function getFromSpotifyDown(url) {
  const spotifyId = extractSpotifyId(url);
  const type = detectSpotifyType(url);
  if (!spotifyId || type !== "track") return null;

  try {
    // SpotifyDown API
    const res = await axios.get(
      `https://spotifydown.com/api/download/${spotifyId}`,
      {
        timeout: 20000,
        headers: {
          "User-Agent": UA,
          Referer: "https://spotifydown.com/",
          Origin: "https://spotifydown.com",
        },
      }
    );
    return res.data;
  } catch {
    return null;
  }
}

/**
 * Method: Spotify Mate
 */
async function getFromSpotifyMate(url) {
  try {
    const res = await axios.post(
      "https://spotifymate.com/action",
      new URLSearchParams({ url }),
      {
        timeout: 20000,
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          Referer: "https://spotifymate.com/",
          Origin: "https://spotifymate.com",
        },
      }
    );
    return res.data;
  } catch {
    return null;
  }
}

/**
 * Method: Loader.to / Y2Mate for Spotify (via YouTube search match)
 */
async function getYouTubeMatchDownload(trackTitle, artistName) {
  try {
    // Search YouTube for track
    const query = encodeURIComponent(`${trackTitle} ${artistName} audio`);
    const ytSearchUrl = `https://www.youtube.com/results?search_query=${query}`;

    const res = await axios.get(ytSearchUrl, {
      timeout: 10000,
      headers: { "User-Agent": UA },
    });

    const html = res.data;
    // Extract first video ID from initial data
    const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
    if (!match) return null;

    const videoId = match[1];
    return {
      youtubeVideoId: videoId,
      youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
      note: "Download via YouTube match",
    };
  } catch {
    return null;
  }
}

/**
 * Main Spotify Info function
 */
async function getSpotifyInfo(url) {
  const type = detectSpotifyType(url);
  const spotifyId = extractSpotifyId(url);

  if (type === "unknown" || !spotifyId) {
    throw new Error("Invalid Spotify URL. Supported: track, album, playlist, artist, episode.");
  }

  const result = {
    success: true,
    platform: "spotify",
    data: {
      spotifyId,
      type,
      url,
      title: null,
      artist: null,
      album: null,
      thumbnail: null,
      thumbnailHD: null,
      duration: null,
      releaseDate: null,
      trackCount: null,
      previewUrl: null,
      embedUrl: `https://open.spotify.com/embed/${type}/${spotifyId}`,
      spotifyUri: `spotify:${type}:${spotifyId}`,
      openInSpotify: url,
      downloads: {
        mp3: null,
        youtubeMatch: null,
      },
    },
  };

  // ─── Step 1: Get oEmbed metadata ──────────────────────────────────────────
  try {
    const oembed = await getSpotifyOEmbed(url);
    result.data.title = oembed.title || null;
    result.data.artist = oembed.provider_name || "Spotify";
    result.data.thumbnail = oembed.thumbnail_url || null;
    result.data.thumbnailWidth = oembed.thumbnail_width || null;
    result.data.thumbnailHeight = oembed.thumbnail_height || null;
  } catch (e) {
    console.warn("[Spotify] oEmbed failed:", e.message);
  }

  // ─── Step 2: Scrape full page for better metadata ─────────────────────────
  try {
    const html = await scrapeSpotifyPage(url);
    const $ = cheerio.load(html);

    // Parse JSON-LD or next data
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1]);
        const entity =
          nextData?.props?.pageProps?.state?.data?.entity ||
          nextData?.props?.pageProps?.entity;

        if (entity) {
          if (!result.data.title) result.data.title = entity.name || null;

          if (entity.artists?.items) {
            result.data.artist = entity.artists.items.map((a) => a.profile?.name || a.name).join(", ");
          }

          if (entity.coverArt?.sources) {
            const sources = entity.coverArt.sources.sort(
              (a, b) => (b.width || 0) - (a.width || 0)
            );
            result.data.thumbnailHD = sources[0]?.url || null;
            if (!result.data.thumbnail) result.data.thumbnail = sources[sources.length - 1]?.url || null;
          }

          result.data.duration = entity.duration?.totalMilliseconds
            ? Math.round(entity.duration.totalMilliseconds / 1000)
            : null;

          result.data.releaseDate = entity.date?.isoString || entity.releaseDate || null;
          result.data.trackCount = entity.tracksV2?.totalCount || entity.tracks?.total || null;

          if (entity.previews?.[0]?.url) {
            result.data.previewUrl = entity.previews[0].url;
          }
        }
      } catch {}
    }

    // Fallback to meta tags
    if (!result.data.title) {
      result.data.title = $('meta[property="og:title"]').attr("content") || $("title").text().replace(" | Spotify", "").trim() || null;
    }
    if (!result.data.thumbnail) {
      result.data.thumbnail = $('meta[property="og:image"]').attr("content") || null;
    }
    const ogDesc = $('meta[property="og:description"]').attr("content");
    if (ogDesc && !result.data.artist) {
      const artistMatch = ogDesc.match(/^(.+?)(?:\s·|\s-|\s–)/);
      if (artistMatch) result.data.artist = artistMatch[1].trim();
    }
  } catch (e) {
    console.warn("[Spotify] Page scrape failed:", e.message);
  }

  // ─── Step 3: Try download for tracks ──────────────────────────────────────
  if (type === "track") {
    // Try SpotifyDown
    try {
      const dlData = await getFromSpotifyDown(url);
      if (dlData && dlData.link) {
        result.data.downloads.mp3 = {
          url: dlData.link,
          quality: "128kbps",
          format: "mp3",
          source: "spotifydown",
        };
      }
    } catch (e) {
      console.warn("[Spotify] SpotifyDown failed:", e.message);
    }

    // Try Spotify Mate as fallback
    if (!result.data.downloads.mp3) {
      try {
        const mateData = await getFromSpotifyMate(url);
        if (mateData && typeof mateData === "object") {
          const dlUrl = mateData.link || mateData.download || mateData.url;
          if (dlUrl) {
            result.data.downloads.mp3 = {
              url: dlUrl,
              quality: "128kbps",
              format: "mp3",
              source: "spotifymate",
            };
          }
        }
      } catch (e) {
        console.warn("[Spotify] SpotifyMate failed:", e.message);
      }
    }

    // YouTube match as universal fallback.
    // SpotifyDown's domain is dead (moved to spotidownloader.com, which
    // gates every request behind a Cloudflare browser challenge our server
    // can't solve) and SpotifyMate is itself just a YouTube-audio-ripper
    // wrapped in ads. So instead of only linking out to the YouTube page
    // (which needs a second manual step and isn't a real "download"), we
    // extract a real, direct audio URL from that matched video ourselves
    // using the same ytdl-core pipeline that already powers /api/youtube —
    // this turns the button back into an actual one-click Download.
    if (!result.data.downloads.mp3 && result.data.title) {
      try {
        const ytMatch = await getYouTubeMatchDownload(result.data.title, result.data.artist || "");
        if (ytMatch) {
          result.data.downloads.youtubeMatch = ytMatch;

          try {
            const ytd = await getFromYtdlCore(ytMatch.youtubeUrl);
            const bestAudio = ytd?.audioOnly?.[0];
            if (bestAudio?.url) {
              result.data.downloads.mp3 = {
                url: bestAudio.url,
                quality: bestAudio.audioBitrate ? `${bestAudio.audioBitrate}kbps` : "best",
                format: bestAudio.container || "m4a",
                source: "youtube-match",
              };
            }
          } catch (e) {
            console.warn("[Spotify] YouTube-match audio extraction failed:", e.message);
          }
        }
      } catch (e) {
        console.warn("[Spotify] YouTube match failed:", e.message);
      }
    }

    // Preview URL always available for 30s
    if (result.data.previewUrl) {
      result.data.downloads.preview = {
        url: result.data.previewUrl,
        quality: "aac",
        duration: "30s",
        note: "30-second Spotify preview",
      };
    }
  }

  if (!result.data.title && !result.data.thumbnail) {
    throw new Error("Could not extract Spotify data. The URL may be invalid or region-locked.");
  }

  return result;
}

module.exports = { getSpotifyInfo };
