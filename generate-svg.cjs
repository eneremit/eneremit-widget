// generate-svg.cjs
// Generates now-playing.svg with 3 lines:
// Last Read: Title — Author
// Last Watched: Movie (YEAR) — Director
// Now Listening To / Last Listened To: Track — Artist
//
// Requires: npm i fast-xml-parser
// Node 20+ (GitHub Actions runner) has fetch built-in.

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER = process.env.LASTFM_USER;

const GOODREADS_RSS_URL = process.env.GOODREADS_RSS_URL;     // e.g. https://www.goodreads.com/review/list_rss/138343303?shelf=read
const LETTERBOXD_RSS_URL = process.env.LETTERBOXD_RSS_URL;   // e.g. your letterboxd RSS feed url

// ---- STYLE (tweak these) ----
const FONT_FAMILY = "Times New Roman, Times, serif";
const FONT_SIZE_PX = 15;          // <-- MAKE IT BIGGER/SMALLER HERE (try 15, 16, 17)
const LINE_GAP_PX = 22;           // distance between lines (increase if you increase font size)
const PADDING_X = 18;
const PADDING_Y = 20;
const SVG_WIDTH = 520;            // layout width inside the SVG
const SVG_HEIGHT = 120;           // should fit 3 lines comfortably
const TEXT_COLOR = "#2c2c2c";
const LABEL_OPACITY = 0.55;
const VALUE_OPACITY = 0.95;

// Helper: safe XML text
function escapeXml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function fetchText(url) {
  if (!url) return "";
  const res = await fetch(url, { headers: { "User-Agent": "eneremit-widget/1.0" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

function parseRss(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    // Goodreads/Letterboxd can have namespaces; keep them:
    removeNSPrefix: false,
  });
  return parser.parse(xmlText);
}

function firstItemFromRss(parsed) {
  const channel =
    parsed?.rss?.channel ||
    parsed?.feed || // sometimes Atom-ish
    parsed?.["rdf:RDF"]?.channel;

  // RSS 2.0
  if (channel?.item) {
    const items = Array.isArray(channel.item) ? channel.item : [channel.item];
    return items[0] || null;
  }

  // Atom
  if (parsed?.feed?.entry) {
    const entries = Array.isArray(parsed.feed.entry) ? parsed.feed.entry : [parsed.feed.entry];
    return entries[0] || null;
  }

  return null;
}

// ---------- GOODREADS ----------
function extractGoodreadsTitleAuthor(item) {
  // Goodreads RSS commonly gives title like: "The Little Prince by Antoine de Saint-Exupéry"
  // Sometimes author can appear in dc:creator or author_name depending on feed variant.
  const rawTitle = item?.title ? String(item.title) : "";
  const dcCreator = item?.["dc:creator"] ? String(item["dc:creator"]) : "";
  const authorName = item?.author_name ? String(item.author_name) : "";
  const authorField = dcCreator || authorName;

  // Try " by " split first
  if (rawTitle.includes(" by ")) {
    const [t, a] = rawTitle.split(" by ");
    const title = (t || "").trim();
    const author = (a || "").trim();
    if (title) return { title, author: author || authorField || "—" };
  }

  // Sometimes title may be just title, author elsewhere
  const title = rawTitle.trim();
  const author = authorField.trim();

  return {
    title: title || "—",
    author: author || "—",
  };
}

// ---------- LETTERBOXD ----------
function formatMovieTitleYear(rawTitle) {
  // Convert "Hamnet, 2025" -> "Hamnet (2025)"
  const t = (rawTitle || "").trim();
  const m = t.match(/^(.*?),\s*(\d{4})$/);
  if (m) return `${m[1].trim()} (${m[2]})`;
  return t || "—";
}

async function extractLetterboxdDirectorFromFilmPage(filmUrl) {
  if (!filmUrl) return "—";
  try {
    const html = await fetchText(filmUrl);

    // Letterboxd pages usually include JSON-LD with director(s)
    const scriptMatch = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (!scriptMatch) return "—";

    const jsonText = scriptMatch[1].trim();

    // Sometimes there are multiple JSON blocks or invalid trailing; be defensive:
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch {
      return "—";
    }

    // Look for director in common spots
    const director = data?.director;
    if (Array.isArray(director)) {
      const names = director.map(d => d?.name).filter(Boolean);
      return names[0] || "—";
    }
    if (director?.name) return director.name;

    return "—";
  } catch {
    return "—";
  }
}

// ---------- LAST.FM ----------
async function getLastFmLine() {
  if (!LASTFM_API_KEY || !LASTFM_USER) {
    return { label: "Last Listened To:", value: "—", url: "https://www.last.fm/" };
  }

  const url =
    `https://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks` +
    `&user=${encodeURIComponent(LASTFM_USER)}` +
    `&api_key=${encodeURIComponent(LASTFM_API_KEY)}` +
    `&format=json&limit=1`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm request failed ${res.status}`);
  const data = await res.json();

  const track = data?.recenttracks?.track?.[0];
  if (!track) return { label: "Last Listened To:", value: "—", url: `https://www.last.fm/user/${LASTFM_USER}` };

  const isNowPlaying = !!track?.["@attr"]?.nowplaying;
  const name = track?.name ? String(track.name) : "—";
  const artist = track?.artist?.["#text"] ? String(track.artist["#text"]) : "—";
  const trackUrl = track?.url ? String(track.url) : `https://www.last.fm/user/${LASTFM_USER}`;

  return {
    label: isNowPlaying ? "Now Listening To:" : "Last Listened To:",
    value: `${name} — ${artist}`,
    url: trackUrl,
  };
}

// ---------- BUILD ALL 3 LINES ----------
async function getGoodreadsLine() {
  if (!GOODREADS_RSS_URL) return { label: "Last Read:", value: "—", url: "https://www.goodreads.com/" };

  try {
    const xml = await fetchText(GOODREADS_RSS_URL);
    const parsed = parseRss(xml);
    const item = firstItemFromRss(parsed);

    if (!item) return { label: "Last Read:", value: "—", url: "https://www.goodreads.com/" };

    const { title, author } = extractGoodreadsTitleAuthor(item);

    // Prefer the book/review link if present
    const link = item?.link ? String(item.link) : "https://www.goodreads.com/";
    return { label: "Last Read:", value: `${title} — ${author}`, url: link };
  } catch {
    return { label: "Last Read:", value: "—", url: "https://www.goodreads.com/" };
  }
}

async function getLetterboxdLine() {
  if (!LETTERBOXD_RSS_URL) return { label: "Last Watched:", value: "—", url: "https://letterboxd.com/" };

  try {
    const xml = await fetchText(LETTERBOXD_RSS_URL);
    const parsed = parseRss(xml);
    const item = firstItemFromRss(parsed);

    if (!item) return { label: "Last Watched:", value: "—", url: "https://letterboxd.com/" };

    const rawTitle = item?.title ? String(item.title) : "—";
    const filmUrl = item?.link ? String(item.link) : "https://letterboxd.com/";

    const movieTitle = formatMovieTitleYear(rawTitle);
    const director = await extractLetterboxdDirectorFromFilmPage(filmUrl);

    // If director fetch fails, just show movie (year)
    const value = director && director !== "—" ? `${movieTitle} — ${director}` : movieTitle;

    return { label: "Last Watched:", value, url: filmUrl };
  } catch {
    return { label: "Last Watched:", value: "—", url: "https://letterboxd.com/" };
  }
}

// ---------- SVG RENDER ----------
function renderSvg(lines) {
  const bg = "transparent"; // keep it clean for tumblr
  const y1 = PADDING_Y + FONT_SIZE_PX;
  const y2 = y1 + LINE_GAP_PX;
  const y3 = y2 + LINE_GAP_PX;

  const [l1, l2, l3] = lines;

  // NOTE: per-line clicking works best when embedded as <object type="image/svg+xml"> (not <img>).
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}">
  <rect x="0" y="0" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="${bg}" />

  <style>
    .t { font-family: ${FONT_FAMILY}; font-size: ${FONT_SIZE_PX}px; dominant-baseline: alphabetic; }
    .label { fill: ${TEXT_COLOR}; opacity: ${LABEL_OPACITY}; }
    .value { fill: ${TEXT_COLOR}; opacity: ${VALUE_OPACITY}; }
    a:hover .value { opacity: 1; text-decoration: underline; }
  </style>

  <a href="${escapeXml(l1.url)}" target="_blank" rel="noopener noreferrer">
    <text class="t" x="${PADDING_X}" y="${y1}">
      <tspan class="label">${escapeXml(l1.label)} </tspan>
      <tspan class="value">${escapeXml(l1.value)}</tspan>
    </text>
  </a>

  <a href="${escapeXml(l2.url)}" target="_blank" rel="noopener noreferrer">
    <text class="t" x="${PADDING_X}" y="${y2}">
      <tspan class="label">${escapeXml(l2.label)} </tspan>
      <tspan class="value">${escapeXml(l2.value)}</tspan>
    </text>
  </a>

  <a href="${escapeXml(l3.url)}" target="_blank" rel="noopener noreferrer">
    <text class="t" x="${PADDING_X}" y="${y3}">
      <tspan class="label">${escapeXml(l3.label)} </tspan>
      <tspan class="value">${escapeXml(l3.value)}</tspan>
    </text>
  </a>
</svg>`;
}

(async function main() {
  const [gr, lb, fm] = await Promise.all([
    getGoodreadsLine(),
    getLetterboxdLine(),
    getLastFmLine(),
  ]);

  const svg = renderSvg([gr, lb, fm]);
  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
