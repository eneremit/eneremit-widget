// generate-svg.js
// Generates now-playing.svg with:
// Last Read: Book — Author
// Last Watched: Movie (Year)
// Now Listening To: Track — Artist   (or Last Listened To if not now playing)

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER = process.env.LASTFM_USER;

// Public RSS feeds (no secrets needed)
const GOODREADS_RSS = "https://www.goodreads.com/review/list_rss/138343303?shelf=read";
const LETTERBOXD_RSS = "https://letterboxd.com/eneremit/rss/";

function esc(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "eneremit-widget" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function getLastRead() {
  try {
    const xml = await fetchText(GOODREADS_RSS);
    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xml);

    const items = data?.rss?.channel?.item;
    const first = Array.isArray(items) ? items[0] : items;
    const title = first?.title ? String(first.title) : "";

    // Common Goodreads RSS title looks like: "The Little Prince by Antoine de Saint-Exupéry"
    if (title.includes(" by ")) {
      const [book, author] = title.split(" by ");
      return `${book.trim()} — ${author.trim()}`;
    }

    // Fallback: just show title
    return title.trim() || "—";
  } catch {
    return "—";
  }
}

async function getLastWatched() {
  try {
    const xml = await fetchText(LETTERBOXD_RSS);
    const parser = new XMLParser({ ignoreAttributes: false });
    const data = parser.parse(xml);

    const items = data?.rss?.channel?.item;
    const first = Array.isArray(items) ? items[0] : items;
    let title = first?.title ? String(first.title).trim() : "";

    // Letterboxd RSS titles often include year in parentheses. Keep it if present.
    // If not present, we still show the title.
    // Example: "Film Title (2024)"
    return title || "—";
  } catch {
    return "—";
  }
}

function urlencode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function lastfm(method, params) {
  if (!LASTFM_API_KEY || !LASTFM_USER) return null;

  const url =
    `https://ws.audioscrobbler.com/2.0/?method=${encodeURIComponent(method)}&` +
    urlencode({ ...params, api_key: LASTFM_API_KEY, format: "json" });

  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

async function getListeningLine() {
  try {
    const data = await lastfm("user.getrecenttracks", { user: LASTFM_USER, limit: 1 });
    const item = data?.recenttracks?.track?.[0];
    if (!item) return { label: "Last Listened To", value: "—" };

    const track = item?.name ? String(item.name).trim() : "—";
    const artist =
      item?.artist?.["#text"] ? String(item.artist["#text"]).trim() :
      item?.artist?.name ? String(item.artist.name).trim() :
      "—";

    const nowPlaying = Boolean(item?.["@attr"]?.nowplaying);
    return {
      label: nowPlaying ? "Now Listening To" : "Last Listened To",
      value: `${track} — ${artist}`.trim()
    };
  } catch {
    return { label: "Last Listened To", value: "—" };
  }
}

function buildSvg({ lastRead, lastWatched, listenLabel, listenValue }) {
  // Theme-ish styling (you can tweak these 3 constants anytime)
  const width = 520;
  const height = 120;

  const fontFamily = "Times New Roman, Times, serif";
  const fontSize = 14;
  const fill = "#613d12"; // your brown
  const opacity = 1;

  const line1 = `Last Read: ${lastRead}`;
  const line2 = `Last Watched: ${lastWatched}`;
  const line3 = `${listenLabel}: ${listenValue}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="eneremit widget">
  <rect width="100%" height="100%" fill="transparent"/>
  <text x="0" y="30" font-family="${fontFamily}" font-size="${fontSize}" fill="${fill}" fill-opacity="${opacity}">
    ${esc(line1)}
  </text>
  <text x="0" y="60" font-family="${fontFamily}" font-size="${fontSize}" fill="${fill}" fill-opacity="${opacity}">
    ${esc(line2)}
  </text>
  <text x="0" y="90" font-family="${fontFamily}" font-size="${fontSize}" fill="${fill}" fill-opacity="${opacity}">
    ${esc(line3)}
  </text>
</svg>`;
}

(async function main() {
  const [lastRead, lastWatched, listening] = await Promise.all([
    getLastRead(),
    getLastWatched(),
    getListeningLine()
  ]);

  const svg = buildSvg({
    lastRead,
    lastWatched,
    listenLabel: listening.label,
    listenValue: listening.value
  });

  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
