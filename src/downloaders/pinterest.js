const axios = require("axios");
const cheerio = require("cheerio");

const UA = process.env.USER_AGENT ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/**
 * Resolve Pinterest short URL
 */
async function resolvePinterestUrl(url) {
  try {
    if (url.includes("pin.it") || url.includes("pinterest.com/pin")) {
      const res = await axios.get(url, {
        maxRedirects: 5,
        timeout: 10000,
        headers: { "User-Agent": UA },
        validateStatus: () => true,
      });
      return res.request?.res?.responseUrl || res.config?.url || url;
    }
  } catch {}
  return url;
}

/**
 * Extract Pinterest pin ID from URL
 */
function extractPinId(url) {
  const match = url.match(/\/pin\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Method 1: Pinterest API v3 (public, no key needed)
 */
async function getPinFromAPI(pinId) {
  const apiUrl = `https://www.pinterest.com/resource/PinResource/get/?source_url=%2Fpin%2F${pinId}%2F&data=%7B%22options%22%3A%7B%22id%22%3A%22${pinId}%22%2C%22field_set_key%22%3A%22detailed%22%7D%2C%22context%22%3A%7B%7D%7D`;
  const res = await axios.get(apiUrl, {
    timeout: 12000,
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/javascript, */*, q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "X-APP-VERSION": "e6b2e93",
      "X-Pinterest-AppState": "active",
      Referer: `https://www.pinterest.com/pin/${pinId}/`,
    },
  });
  return res.data;
}

/**
 * Method 2: Scrape Pinterest page directly
 */
async function scrapePinterestPage(url) {
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
 * Method 3: Pinterest oEmbed
 */
async function getPinOEmbed(url) {
  const res = await axios.get(
    `https://www.pinterest.com/oembed.json?url=${encodeURIComponent(url)}`,
    {
      timeout: 10000,
      headers: { "User-Agent": UA },
    }
  );
  return res.data;
}

/**
 * Extract best image URL from Pinterest image object
 */
function getBestImage(images) {
  if (!images) return null;
  const sizes = ["originals", "1200x", "736x", "600x", "474x", "236x"];
  for (const size of sizes) {
    if (images[size]?.url) return images[size].url;
  }
  // Try any available size
  const keys = Object.keys(images);
  if (keys.length > 0) return images[keys[0]]?.url || null;
  return null;
}

/**
 * Upgrade Pinterest image URL to highest quality
 */
function upgradeImageUrl(url) {
  if (!url) return url;
  return url
    .replace(/\/\d+x\d+\//, "/originals/")
    .replace(/\/\d+x\//, "/originals/")
    .replace(/\/_\/?/, "/originals/");
}

/**
 * Main Pinterest Info function
 */
async function getPinterestInfo(url) {
  const resolvedUrl = await resolvePinterestUrl(url);
  const pinId = extractPinId(resolvedUrl);

  const result = {
    success: true,
    platform: "pinterest",
    data: {
      pinId,
      url: resolvedUrl,
      title: null,
      description: null,
      author: null,
      thumbnail: null,
      type: "image",
      downloads: {
        image: null,
        imageOriginal: null,
        video: null,
        videoThumbnail: null,
        images: [], // for multi-image boards
      },
    },
  };

  // ─── Method 1: Pinterest API ───────────────────────────────────────────────
  if (pinId) {
    try {
      const apiData = await getPinFromAPI(pinId);
      const pin = apiData?.resource_response?.data;

      if (pin) {
        result.data.title = pin.title || pin.grid_title || null;
        result.data.description = pin.description || pin.description_html || null;
        result.data.likeCount = pin.reaction_counts?.["1"] || null;
        result.data.saveCount = pin.repin_count || null;
        result.data.commentCount = pin.comment_count || null;

        // Author
        if (pin.pinner) {
          result.data.author = {
            name: pin.pinner.full_name || pin.pinner.username,
            username: pin.pinner.username,
            avatar: getBestImage(pin.pinner.image_medium_url
              ? { medium: { url: pin.pinner.image_medium_url } }
              : pin.pinner.images),
            profileUrl: `https://www.pinterest.com/${pin.pinner.username}/`,
          };
        }

        // Images
        const imgUrl = getBestImage(pin.images);
        if (imgUrl) {
          result.data.thumbnail = imgUrl;
          result.data.downloads.image = imgUrl;
          result.data.downloads.imageOriginal = upgradeImageUrl(imgUrl);
        }

        // Video check
        if (pin.videos?.video_list) {
          result.data.type = "video";
          const videoList = pin.videos.video_list;
          const videoQualities = ["V_HLSV4", "V_720P", "V_480P", "V_360P", "V_HLS"];
          let bestVideo = null;

          for (const q of videoQualities) {
            if (videoList[q]?.url) {
              bestVideo = {
                quality: q,
                url: videoList[q].url,
                width: videoList[q].width,
                height: videoList[q].height,
                duration: videoList[q].duration,
              };
              if (!result.data.downloads.video) {
                result.data.downloads.video = videoList[q].url;
              }
              break;
            }
          }

          // All video qualities
          result.data.downloads.videoFormats = Object.entries(videoList)
            .filter(([, v]) => v?.url)
            .map(([quality, v]) => ({
              quality,
              url: v.url,
              width: v.width,
              height: v.height,
              duration: v.duration,
            }));
        }

        // Story pins / multi-image
        if (pin.story_pin_data?.pages) {
          const pages = pin.story_pin_data.pages;
          const allImages = [];
          for (const page of pages) {
            if (page.blocks) {
              for (const block of page.blocks) {
                if (block.image?.images) {
                  const imgU = getBestImage(block.image.images);
                  if (imgU) allImages.push({ url: imgU });
                }
              }
            }
          }
          if (allImages.length > 0) {
            result.data.downloads.images = allImages;
          }
        }

        if (result.data.downloads.image || result.data.downloads.video) {
          return result;
        }
      }
    } catch (e) {
      console.warn("[Pinterest] API method failed:", e.message);
    }
  }

  // ─── Method 2: Scrape Page ─────────────────────────────────────────────────
  try {
    const html = await scrapePinterestPage(resolvedUrl);
    const $ = cheerio.load(html);

    // Try JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const json = JSON.parse($(el).html());
        if (json["@type"] === "ImageObject" || json.image) {
          if (!result.data.title) result.data.title = json.name || json.headline;
          if (!result.data.description) result.data.description = json.description;
          const imgSrc = json.contentUrl || json.image?.url || json.image;
          if (imgSrc && !result.data.downloads.image) {
            result.data.downloads.image = imgSrc;
            result.data.downloads.imageOriginal = upgradeImageUrl(imgSrc);
            result.data.thumbnail = imgSrc;
          }
        }
      } catch {}
    });

    // Meta tags fallback
    if (!result.data.thumbnail) {
      const ogImage = $('meta[property="og:image"]').attr("content");
      if (ogImage) {
        result.data.thumbnail = ogImage;
        result.data.downloads.image = ogImage;
        result.data.downloads.imageOriginal = upgradeImageUrl(ogImage);
      }
    }
    if (!result.data.title) {
      result.data.title =
        $('meta[property="og:title"]').attr("content") ||
        $("title").text().replace(" | Pinterest", "").trim() ||
        null;
    }
    if (!result.data.description) {
      result.data.description = $('meta[property="og:description"]').attr("content") || null;
    }

    // Try to find video in meta
    const ogVideo = $('meta[property="og:video"]').attr("content") ||
      $('meta[property="og:video:url"]').attr("content");
    if (ogVideo) {
      result.data.type = "video";
      result.data.downloads.video = ogVideo;
    }

    if (result.data.downloads.image || result.data.downloads.video) {
      return result;
    }
  } catch (e) {
    console.warn("[Pinterest] Scrape failed:", e.message);
  }

  // ─── Method 3: oEmbed ─────────────────────────────────────────────────────
  try {
    const oembed = await getPinOEmbed(resolvedUrl);
    if (!result.data.title) result.data.title = oembed.title;
    if (!result.data.author)
      result.data.author = { name: oembed.author_name, url: oembed.author_url };
    if (!result.data.thumbnail && oembed.thumbnail_url) {
      result.data.thumbnail = oembed.thumbnail_url;
      result.data.downloads.image = oembed.thumbnail_url;
      result.data.downloads.imageOriginal = upgradeImageUrl(oembed.thumbnail_url);
    }
    return result;
  } catch (e) {
    console.warn("[Pinterest] oEmbed failed:", e.message);
  }

  if (!result.data.thumbnail && !result.data.downloads.image) {
    throw new Error("Could not extract Pinterest data. The pin may be private or unavailable.");
  }

  return result;
}

module.exports = { getPinterestInfo };
