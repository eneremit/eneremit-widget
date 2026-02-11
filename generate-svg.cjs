// generate-svg.cjs
// Generates now-playing.svg
// Left-aligned version (stable layout) — BIGGER + safer parsing

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE (BIGGER + NO CLIPPING) ---------
const STYLE = {
  width: 420,          // wider canvas
  paddingLeft: 12,
  paddingTop: 26,      // more top breathing room
  paddingBottom: 22,   // more bottom breathing room

  fontFamily: "Times New Roman, Times, serif",
  fontSize: 22,        // bigger text
  lineGap: 34,         // bigger line spacing

  color: "#613d12",
  letterSpacing: "0.3px",
};

const parser = new XMLParser({ ignoreAttributes: false });

// ---------- helpers ----------
function escapeXml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": "eneremit-widget" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "eneremit-widget" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

function pickFirstItem(rssParsed) {
  const channel = rssParsed?.rss?.channel;
  let item = channel?.item;
  if (Array.isArray(item)) item = item[0];
  return item || null;
}

function cleanAuthor(authorRaw) {
  let a = (authorRaw || "").toString().trim();

  // common “weird” outputs you mentioned
  if (!a) return "";
  if (a === "__" || a === "_" || a === "-" || a === "—") return "";

  // remove any accidental leftover separators
  a = a.replace(/^[-—_]+\s*/, "").replace(/\s*[-—_]+$/, "").trim();

  return a;
}

// ---------- Last.fm ----------
async function getLastfmLine() {
  if (!LASTFM_API_KEY || !LASTFM_USER) {
    return { text: "Last Listened To: —", link: null };
  }

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
  if (!item) return { text: "Last Listened To: —", link: null };

  const track = item.name?.trim() || "";
  const artist =
    item.artist?.["#text"]?.trim() ||
    item.artist?.name?.trim() ||
    "";

  const link = (item.url || "").trim() || null;
  const nowPlaying = Boolean(item?.["@attr"]?.nowplaying);
  const label = nowPlaying ? "Now Listening To" : "Last Listened To";
  const value = [track, artist].filter(Boolean).join(" — ").trim();

  return { text: `${label}: ${value || "—"}`, link };
}

// ---------- Letterboxd ----------
function parseLetterboxdTitle(rawTitle = "") {
  const t = rawTitle.trim();
  const clean = t.split(" - ")[0].trim();

  // Letterboxd often gives: "Movie Title, 2025"
  const m = clean.match(/^(.+?),\s*(\d{4})(?:\b|$)/);
  if (m) return `${m[1].trim()} (${m[2].trim()})`;

  // fallback: already "Movie (2025)"
  const p = clean.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (p) return `${p[1].trim()} (${p[2].trim()})`;

  return clean || "—";
}

async function getLetterboxdLatest() {
  if (!LETTERBOXD_RSS) return { text: "Last Watched: —", link: null };

  const xml = await fetchText(LETTERBOXD_RSS);
  const parsed = parser.parse(xml);
  const item = pickFirstItem(parsed);
  if (!item) return { text: "Last Watched: —", link: null };

  const movie = parseLetterboxdTitle(item.title || "");
  const link = (item.link || "").trim() || null;

  return { text: `Last Watched: ${movie || "—"}`, link };
}

// ---------- Goodreads ----------
async function getGoodreadsLatest() {
  if (!GOODREADS_RSS) return { text: "Last Read: —", link: null };

  const xml = await fetchText(GOODREADS_RSS);
  const parsed = parser.parse(xml);
  const item = pickFirstItem(parsed);
  if (!item) return { text: "Last Read: —", link: null };

  let rawTitle = (item.title || "").toString().trim();
  const link = (item.link || "").toString().trim() || null;

  // try known author fields
  let author =
    item["dc:creator"] ||
    item.creator ||
    item.author ||
    item.author_name ||
    "";

  author = cleanAuthor(author);

  // fallback: "Title by Author" inside title string
  if (!author && / by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    rawTitle = (parts[0] || "").trim();
    author = cleanAuthor((parts.slice(1).join(" by ") || "").trim());
  } else if (/ by /i.test(rawTitle)) {
    // if author already found, still strip " by ..." from title
    rawTitle = rawTitle.split(/ by /i)[0].trim();
  }

  const title = rawTitle || "—";
  const authorText = author ? ` — ${author}` : "";

  return { text: `Last Read: ${title}${authorText}`, link };
}

// ---------- SVG ----------
function renderSvg(lines) {
  const {
    width,
    paddingLeft,
    paddingTop,
    paddingBottom,
    fontSize,
    lineGap,
    fontFamily,
    color,
    letterSpacing,
  } = STYLE;

  // Height must account for top + bottom + (line count * gap) + extra headroom
  const height = paddingTop + paddingBottom + lineGap * lines.length + 10;

  const rendered = lines
    .map((line, i) => {
      const y = paddingTop + (i + 1) * lineGap;
      const safeText = escapeXml(line.text);

      const textNode = `
  <text x="${paddingLeft}" y="${y}" class="line" text-anchor="start">${safeText}</text>`;

      if (line.link) {
        const safeLink = escapeXml(line.link);
        return `
  <a href="${safeLink}" target="_blank" rel="noopener noreferrer">${textNode}
  </a>`;
      }
      return textNode;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}"
     shape-rendering="geometricPrecision"
     text-rendering="geometricPrecision">
  <style>
    .line {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      fill: ${color};
      letter-spacing: ${letterSpacing};
    }
    a { text-decoration: none; }
  </style>

  <rect width="100%" height="100%" fill="transparent"/>
${rendered}
</svg>`;
}

// ---------- main ----------
(async function main() {
  try {
    const results = await Promise.allSettled([
      getGoodreadsLatest(),
      getLetterboxdLatest(),
      getLastfmLine(),
    ]);

    const gr =
      results[0].status === "fulfilled"
        ? results[0].value
        : { text: "Last Read: —", link: null };

    const lb =
      results[1].status === "fulfilled"
        ? results[1].value
        : { text: "Last Watched: —", link: null };

    const lf =
      results[2].status === "fulfilled"
        ? results[2].value
        : { text: "Last Listened To: —", link: null };

    const svg = renderSvg([gr, lb, lf]);
    fs.writeFileSync("now-playing.svg", svg, "utf8");
    console.log("Wrote now-playing.svg");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
