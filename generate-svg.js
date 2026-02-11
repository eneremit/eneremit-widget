// generate-svg.js (Node 20+; uses built-in fetch)
// Outputs: 3 lines, no images.
// Lines:
// - Last Read: Book — Author
// - Last Watched: Movie (Year)
// - Now Listening To: Track — Artist  (or Last Listened To if not currently playing)

import fs from "fs";

const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";

const LETTERBOXD_USER = process.env.LETTERBOXD_USER || ""; // e.g. "eneremit"
const GOODREADS_USER_ID = process.env.GOODREADS_USER_ID || ""; // e.g. "138343303"

// ---- helpers
async function safeFetchText(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function safeFetchJson(url, opts) {
  try {
    const res = await fetch(url, opts);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// minimal XML helpers (good enough for RSS)
function firstTagValue(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/i, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function firstItem(xml) {
  const m = xml.match(/<item\b[^>]*>([\s\S]*?)<\/item>/i);
  return m ? m[1] : null;
}

function decodeHtml(s) {
  return (s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- data getters
async function getLastfmLine() {
  if (!LASTFM_API_KEY || !LASTFM_USER) {
    return { label: "Last Listened To", value: "—" };
  }

  const url =
    `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
    `&user=${encodeURIComponent(LASTFM_USER)}` +
    `&limit=1&api_key=${encodeURIComponent(LASTFM_API_KEY)}&format=json`;

  const data = await safeFetchJson(url);
  const track = data?.recenttracks?.track?.[0];
  if (!track) return { label: "Last Listened To", value: "—" };

  const name = track.name || "—";
  const artist = track.artist?.["#text"] || track.artist?.name || "—";
  const isNowPlaying = Boolean(track["@attr"]?.nowplaying);

  return {
    label: isNowPlaying ? "Now Listening To" : "Last Listened To",
    value: `${name} — ${artist}`,
  };
}

async function getLetterboxdLine() {
  if (!LETTERBOXD_USER) return { label: "Last Watched", value: "—" };

  // Letterboxd provides an RSS feed per user:
  // https://letterboxd.com/{user}/rss/
  const rssUrl = `https://letterboxd.com/${encodeURIComponent(LETTERBOXD_USER)}/rss/`;
  const xml = await safeFetchText(rssUrl);
  if (!xml) return { label: "Last Watched", value: "—" };

  const item = firstItem(xml);
  if (!item) return { label: "Last Watched", value: "—" };

  // RSS <title> is usually like: "Film Title (2024) ★★★★½" or similar.
  const rawTitle = decodeHtml(firstTagValue(item, "title") || "");
  if (!rawTitle) return { label: "Last Watched", value: "—" };

  // Strip rating stars and trailing junk.
  // Keep "Movie (Year)" if present.
  const cleaned = rawTitle
    .replace(/\s+★.*$/u, "")     // remove star ratings
    .replace(/\s+\(re-?watch\).*$/i, "")
    .trim();

  return { label: "Last Watched", value: cleaned || "—" };
}

async function getGoodreadsLine() {
  if (!GOODREADS_USER_ID) return { label: "Last Read", value: "—" };

  // Goodreads “list RSS” works with numeric user id:
  // https://www.goodreads.com/review/list_rss/{id}?shelf=read
  const rssUrl = `https://www.goodreads.com/review/list_rss/${encodeURIComponent(
    GOODREADS_USER_ID
  )}?shelf=read`;

  const xml = await safeFetchText(rssUrl);
  if (!xml) return { label: "Last Read", value: "—" };

  const item = firstItem(xml);
  if (!item) return { label: "Last Read", value: "—" };

  // RSS <title> often like: "The Little Prince by Antoine de Saint-Exupéry"
  const rawTitle = decodeHtml(firstTagValue(item, "title") || "");
  if (!rawTitle) return { label: "Last Read", value: "—" };

  // Normalize: "Book — Author"
  const m = rawTitle.match(/^(.*?)\s+by\s+(.*)$/i);
  if (m) {
    return { label: "Last Read", value: `${m[1].trim()} — ${m[2].trim()}` };
  }
  return { label: "Last Read", value: rawTitle.trim() || "—" };
}

// ---- SVG render (simple + theme-friendly)
function renderSVG(lines) {
  // Adjust these to match your Tumblr theme precisely:
  const fontFamily = "Times New Roman, Times, serif";
  const fontSize = 13; // px
  const lineHeight = 18; // px
  const fill = "#613d12"; // your theme’s brown-ish text
  const fill2 = "#000000"; // for author/artist? keeping single color for simplicity
  const bg = "transparent";

  const paddingX = 12;
  const paddingY = 12;
  const width = 460;
  const height = paddingY * 2 + lineHeight * lines.length;

  const textY = (i) => paddingY + fontSize + i * lineHeight;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${bg}" />
  <style>
    .t { font-family: ${fontFamily}; font-size: ${fontSize}px; fill: ${fill}; letter-spacing: 0.3px; }
    .label { opacity: 0.85; }
    .val { opacity: 1; }
  </style>

  ${lines
    .map(
      (ln, i) => `
  <text class="t" x="${paddingX}" y="${textY(i)}">
    <tspan class="label">${esc(ln.label)}: </tspan><tspan class="val">${esc(ln.value)}</tspan>
  </text>`
    )
    .join("")}
</svg>`;
}

(async () => {
  // Never crash the workflow. Worst case: placeholders.
  const [book, movie, music] = await Promise.all([
    getGoodreadsLine(),
    getLetterboxdLine(),
    getLastfmLine(),
  ]);

  const svg = renderSVG([book, movie, music]);
  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
  process.exitCode = 0;
})();
