/**
 * generate-svg.js
 * Creates now-playing.svg with exactly 3 lines:
 * 1) Last Read: Book — Author
 * 2) Last Watched: Movie (Year)
 * 3) Now Listening To: Track — Artist  (if now playing)
 *    OR Last Listened To: Track — Artist
 *
 * Required GitHub Secrets (Actions):
 * - LASTFM_API_KEY
 * - LASTFM_USERNAME
 *
 * Optional (if you want to override defaults):
 * - GOODREADS_RSS_URL
 * - LETTERBOXD_RSS_URL
 */

const fs = require("fs");

// -------------------- CONFIG (tweak styling here)
const STYLE = {
  width: 520,          // SVG width
  paddingX: 14,        // left padding
  paddingY: 18,        // top padding
  lineGap: 22,         // vertical gap between lines
  fontFamily: "Times New Roman, Times, serif",
  fontSize: 13,
  fill: "#613d12",
  opacity: 1,
  letterSpacing: "0.2px",
};

// -------------------- ENV
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USERNAME = process.env.LASTFM_USERNAME;

// Defaults you can keep (they match your accounts from earlier messages)
const LETTERBOXD_RSS_URL =
  process.env.LETTERBOXD_RSS_URL || "https://letterboxd.com/eneremit/rss/";
const GOODREADS_RSS_URL =
  process.env.GOODREADS_RSS_URL ||
  "https://www.goodreads.com/review/list_rss/138343303?shelf=read";

if (!LASTFM_API_KEY || !LASTFM_USERNAME) {
  console.error("Missing env vars. Make sure you set GitHub Secrets:");
  console.error("- LASTFM_API_KEY");
  console.error("- LASTFM_USERNAME");
  process.exit(1);
}

// -------------------- Helpers
function escapeXml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeHtmlEntities(s = "") {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Very small RSS helper:
 * pulls the first <item>...</item> then the <title>...</title>
 * Handles CDATA and basic entities.
 */
function getFirstRssItemTitle(xml = "") {
  const itemMatch = xml.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
  if (!itemMatch) return null;

  const item = itemMatch[1];
  const titleMatch = item.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) return null;

  let title = titleMatch[1].trim();
  title = title.replace(/^<!\[CDATA\[/i, "").replace(/\]\]>$/i, "").trim();
  title = decodeHtmlEntities(title);

  // normalize whitespace
  title = title.replace(/\s+/g, " ").trim();
  return title || null;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "eneremit-widget/1.0 (+github actions)" },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed ${res.status} for ${url}`);
  }
  return await res.text();
}

// -------------------- Data fetchers
async function getMusicLine() {
  // Recent tracks (limit 1)
  const url =
    "https://ws.audioscrobbler.com/2.0/?" +
    new URLSearchParams({
      method: "user.getrecenttracks",
      user: LASTFM_USERNAME,
      api_key: LASTFM_API_KEY,
      format: "json",
      limit: "1",
    }).toString();

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm error ${res.status}`);
  const data = await res.json();

  const item = data?.recenttracks?.track?.[0];
  if (!item) return "Last Listened To: —";

  const track = item?.name || "—";
  // recenttracks uses artist["#text"]
  const artist = item?.artist?.["#text"] || "—";
  const isNowPlaying = Boolean(item?.["@attr"]?.nowplaying);

  const label = isNowPlaying ? "Now Listening To:" : "Last Listened To:";
  return `${label} ${track} — ${artist}`;
}

async function getBookLine() {
  try {
    const xml = await fetchText(GOODREADS_RSS_URL);
    const title = getFirstRssItemTitle(xml);
    if (!title) return "Last Read: —";

    // Goodreads commonly: "The Little Prince by Antoine de Saint-Exupéry"
    // Sometimes includes extra bits; we’ll keep it clean.
    const cleaned = title
      .replace(/\s+\(.*?\)\s*$/, "") // drop trailing "(Hardcover)" etc
      .replace(/\s+-\s+.*$/, "");    // drop trailing "- rating" if it appears

    const m = cleaned.match(/^(.*?)\s+by\s+(.*)$/i);
    if (m) return `Last Read: ${m[1].trim()} — ${m[2].trim()}`;

    // fallback if format differs
    return `Last Read: ${cleaned}`;
  } catch (e) {
    return "Last Read: —";
  }
}

async function getMovieLine() {
  try {
    const xml = await fetchText(LETTERBOXD_RSS_URL);
    const title = getFirstRssItemTitle(xml);
    if (!title) return "Last Watched: —";

    // Letterboxd titles often look like:
    // "Opalite (not) ..." no; typically:
    // "Film Title, 2023 - ★★★★"
    // or "Film Title (2023) - ★★★★"
    let cleaned = title;

    // Remove rating chunk like " - ★★★★" or " - ★★★½"
    cleaned = cleaned.replace(/\s+-\s+.*$/, "").trim();

    let movie = cleaned;
    let year = null;

    // Try "Title, 2023"
    let m = cleaned.match(/^(.*?),\s*(\d{4})$/);
    if (m) {
      movie = m[1].trim();
      year = m[2];
    } else {
      // Try "Title (2023)"
      m = cleaned.match(/^(.*?)\s*\((\d{4})\)\s*$/);
      if (m) {
        movie = m[1].trim();
        year = m[2];
      }
    }

    return year ? `Last Watched: ${movie} (${year})` : `Last Watched: ${movie}`;
  } catch (e) {
    return "Last Watched: —";
  }
}

// -------------------- SVG builder
function buildSvg(lines) {
  const height = STYLE.paddingY + (lines.length - 1) * STYLE.lineGap + STYLE.paddingY;

  const textEls = lines
    .map((line, i) => {
      const y = STYLE.paddingY + i * STYLE.lineGap;
      return `<text x="${STYLE.paddingX}" y="${y}" dominant-baseline="middle">${escapeXml(
        line
      )}</text>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${STYLE.width}" height="${height}" viewBox="0 0 ${STYLE.width} ${height}">
  <style>
    text {
      font-family: ${STYLE.fontFamily};
      font-size: ${STYLE.fontSize}px;
      fill: ${STYLE.fill};
      opacity: ${STYLE.opacity};
      letter-spacing: ${STYLE.letterSpacing};
    }
  </style>
  ${textEls}
</svg>`;
}

// -------------------- main
(async function main() {
  try {
    const [bookLine, movieLine, musicLine] = await Promise.all([
      getBookLine(),
      getMovieLine(),
      getMusicLine(),
    ]);

    const svg = buildSvg([bookLine, movieLine, musicLine]);
    fs.writeFileSync("now-playing.svg", svg, "utf8");

    console.log("✅ Wrote now-playing.svg");
    console.log(bookLine);
    console.log(movieLine);
    console.log(musicLine);
  } catch (err) {
    console.error("❌ Failed to generate SVG:", err);
    process.exit(1);
  }
})();
