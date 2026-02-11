/**
 * generate-svg.js
 * Generates now-playing.svg with 3 lines:
 * - Last Read (Goodreads RSS)
 * - Last Watched (Letterboxd RSS)
 * - Now Listening To / Last Listened To (Last.fm)
 *
 * Secrets (GitHub Actions):
 * - LASTFM_API_KEY
 * - LASTFM_USER
 * - GOODREADS_RSS
 * - LETTERBOXD_RSS
 */

import fs from "node:fs";

const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";

const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

function decodeEntities(str = "") {
  // Basic HTML entity decoding good enough for titles
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Fetch helper with nice errors
async function fetchText(url) {
  if (!url) return "";
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return await res.json();
}

function getFirstRssItemBlock(xml) {
  // Grab first <item>...</item>
  const m = xml.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
  return m ? m[1] : "";
}

function getTag(block, tagName) {
  // Handles: <title>...</title> or <dc:creator>...</dc:creator>
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = block.match(re);
  return m ? decodeEntities(m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim()) : "";
}

function stripHtml(str = "") {
  return str.replace(/<[^>]+>/g, "").trim();
}

/**
 * Goodreads RSS
 * Usually item <title> looks like: "The Little Prince by Antoine de Saint-Exupéry"
 */
async function getGoodreadsLastRead() {
  if (!GOODREADS_RSS) return { book: "—", author: "" };

  try {
    const xml = await fetchText(GOODREADS_RSS);
    const item = getFirstRssItemBlock(xml);
    if (!item) return { book: "—", author: "" };

    let title = getTag(item, "title");
    title = stripHtml(title);

    // Try to split "Book Title by Author"
    const idx = title.toLowerCase().lastIndexOf(" by ");
    if (idx > 0) {
      const book = title.slice(0, idx).trim();
      const author = title.slice(idx + 4).trim();
      return { book: book || "—", author: author || "" };
    }

    // Fallback: some feeds include creator/author fields
    const creator = getTag(item, "dc:creator") || getTag(item, "author");
    return { book: title || "—", author: creator || "" };
  } catch {
    return { book: "—", author: "" };
  }
}

/**
 * Letterboxd RSS
 * Titles often look like: "Opalite (2024) - ★★★★" or "Film Title, 2024 - ★★★"
 * We’ll extract "Film Title" and a 4-digit year if present.
 */
async function getLetterboxdLastWatched() {
  if (!LETTERBOXD_RSS) return { film: "—", year: "" };

  try {
    const xml = await fetchText(LETTERBOXD_RSS);
    const item = getFirstRssItemBlock(xml);
    if (!item) return { film: "—", year: "" };

    let title = getTag(item, "title");
    title = stripHtml(title);

    // Keep only left side of " - ..."
    title = title.split(" - ")[0].trim();

    // Extract a 4-digit year anywhere
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : "";

    // Remove common patterns: "(2024)" or ", 2024"
    let film = title
      .replace(/\((19|20)\d{2}\)/g, "")
      .replace(/,\s*(19|20)\d{2}\b/g, "")
      .trim();

    // Sometimes title includes extra suffixes; keep it clean
    film = film || "—";

    return { film, year };
  } catch {
    return { film: "—", year: "" };
  }
}

/**
 * Last.fm recent track
 */
async function getLastfmListening() {
  if (!LASTFM_API_KEY || !LASTFM_USER) {
    return { label: "Last Listened To", track: "—", artist: "" };
  }

  try {
    const url =
      "https://ws.audioscrobbler.com/2.0/?" +
      new URLSearchParams({
        method: "user.getrecenttracks",
        user: LASTFM_USER,
        api_key: LASTFM_API_KEY,
        format: "json",
        limit: "1",
      }).toString();

    const data = await fetchJson(url);
    const item = data?.recenttracks?.track?.[0];
    if (!item) return { label: "Last Listened To", track: "—", artist: "" };

    const nowPlaying = !!item?.["@attr"]?.nowplaying;
    const track = decodeEntities(item?.name || "—");
    const artist = decodeEntities(item?.artist?.["#text"] || item?.artist?.name || "");

    return {
      label: nowPlaying ? "Now Listening To" : "Last Listened To",
      track,
      artist,
    };
  } catch {
    return { label: "Last Listened To", track: "—", artist: "" };
  }
}

function makeSvg({ lastRead, lastWatched, listening }) {
  // Styling: Times New Roman vibe, warm brown like your theme snippet (#613d12)
  const fontFamily = "Times New Roman, Times, serif";
  const fill = "#613d12";
  const opacity = "1";

  const line1 =
    `Last Read: ${lastRead.book}` + (lastRead.author ? ` — ${lastRead.author}` : "");
  const line2 =
    `Last Watched: ${lastWatched.film}` + (lastWatched.year ? ` (${lastWatched.year})` : "");
  const line3 =
    `${listening.label}: ${listening.track}` + (listening.artist ? ` — ${listening.artist}` : "");

  // SVG size: adjust if you want wider
  const width = 360;
  const height = 70;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Now Playing Widget">
  <style>
    .t {
      font-family: ${fontFamily};
      font-size: 13px;
      fill: ${fill};
      fill-opacity: ${opacity};
      letter-spacing: 0.2px;
    }
  </style>

  <text class="t" x="0" y="18">${escapeXml(line1)}</text>
  <text class="t" x="0" y="40">${escapeXml(line2)}</text>
  <text class="t" x="0" y="62">${escapeXml(line3)}</text>
</svg>`;
}

async function main() {
  const [lastRead, lastWatched, listening] = await Promise.all([
    getGoodreadsLastRead(),
    getLetterboxdLastWatched(),
    getLastfmListening(),
  ]);

  const svg = makeSvg({ lastRead, lastWatched, listening });
  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
