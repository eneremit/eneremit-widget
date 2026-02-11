// generate-svg.cjs
// Generates now-playing.svg with 3 lines:
// Last Read: Book — Author
// Last Watched: Movie (YEAR)
// Now Listening To: Track — Artist  (or "Last Listened To" if not currently playing)

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- REQUIRED ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER = process.env.LASTFM_USER;

// These two are the RSS links you told me work:
const GOODREADS_RSS = process.env.GOODREADS_RSS;   // e.g. https://www.goodreads.com/review/list_rss/138343303?shelf=read
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS; // your Letterboxd RSS link

// --------- SVG STYLE (edit these if you want) ---------
const STYLE = {
  width: 320,
  paddingX: 10,
  paddingY: 18,
  lineGap: 18,
  fontFamily: "Times New Roman, Times, serif",
  fontSize: 13,
  labelColor: "#613d12",
  textColor: "#000000",
  opacity: 1,
};

// --------- helpers ---------
const parser = new XMLParser({ ignoreAttributes: false });

function escapeXml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "eneremit-widget" },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "eneremit-widget" },
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

function pickFirstItem(rssParsed) {
  const channel = rssParsed?.rss?.channel;
  let item = channel?.item;
  if (Array.isArray(item)) item = item[0];
  return item || null;
}

// --------- Last.fm ---------
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

  const track = (item.name || "").trim();
  const artist = (item.artist?.["#text"] || item.artist?.name || "").trim();
  const link = (item.url || "").trim() || null;

  const nowPlaying = Boolean(item?.["@attr"]?.nowplaying);
  const label = nowPlaying ? "Now Listening To" : "Last Listened To";

  const value = [track, artist].filter(Boolean).join(" — ").trim();
  return { text: `${label}: ${value || "—"}`, link };
}

// --------- Letterboxd (Last Watched) ---------
function parseLetterboxdTitle(rawTitle = "") {
  // Common Letterboxd RSS item.title examples:
  // "Hamnet, 2025 - ★★★★"
  // "Hamnet, 2025"
  // We want: "Hamnet (2025)"
  const t = rawTitle.trim();

  // Remove rating suffix like " - ★★★★" or " - 4 stars" etc.
  const noRating = t.split(" - ")[0].trim();

  // Try: "Movie, 2025"
  const m = noRating.match(/^(.+?),\s*(\d{4})(?:\b|$)/);
  if (m) {
    const title = m[1].trim();
    const year = m[2].trim();
    return `${title} (${year})`;
  }

  // Try: "Movie (2025)" already
  const p = noRating.match(/^(.+?)\s*\((\d{4})\)\s*$/);
  if (p) return `${p[1].trim()} (${p[2].trim()})`;

  return noRating || "—";
}

async function getLetterboxdLatest() {
  if (!LETTERBOXD_RSS) return { text: "Last Watched: —", link: null };

  const xml = await fetchText(LETTERBOXD_RSS);
  const parsed = parser.parse(xml);
  const item = pickFirstItem(parsed);
  if (!item) return { text: "Last Watched: —", link: null };

  const rawTitle = (item.title || "").trim();
  const link = (item.link || "").trim() || null;

  const movie = parseLetterboxdTitle(rawTitle);
  return { text: `Last Watched: ${movie || "—"}`, link };
}

// --------- Goodreads (Last Read) ---------
async function getGoodreadsLatest() {
  if (!GOODREADS_RSS) return { text: "Last Read: —", link: null };

  const xml = await fetchText(GOODREADS_RSS);
  const parsed = parser.parse(xml);
  const item = pickFirstItem(parsed);
  if (!item) return { text: "Last Read: —", link: null };

  const rawTitle = (item.title || "").trim();
  const link = (item.link || "").trim() || null;

  // Try common author fields (feeds vary)
  const authorCandidates = [
    item.author_name,
    item.author,
    item["dc:creator"],
    item.creator,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  let author = authorCandidates[0] || "";

  // Fallback: parse "Title by Author" from title
  if (!author && / by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    if (parts.length >= 2) author = parts.slice(1).join(" by ").trim();
  }

  // Clean title: remove trailing " by Author" if present
  let title = rawTitle;
  if (/ by /i.test(rawTitle)) {
    title = rawTitle.split(/ by /i)[0].trim();
  }

  if (!title) return { text: "Last Read: —", link };

  const authorText = author ? ` — ${author}` : "";
  return { text: `Last Read: ${title}${authorText}`, link };
}

// --------- SVG render ---------
function renderSvg(lines) {
  const { width, paddingX, paddingY, lineGap, fontFamily, fontSize, opacity } = STYLE;

  const height = paddingY + lineGap * lines.length + 10;

  const textLines = lines
    .map((line, i) => {
      const y = paddingY + i * lineGap;
      const safeText = escapeXml(line.text);

      // Make whole line clickable if link exists
      if (line.link) {
        const safeLink = escapeXml(line.link);
        return `
  <a href="${safeLink}" target="_blank" rel="noopener noreferrer">
    <text x="${paddingX}" y="${y}" class="line">${safeText}</text>
  </a>`;
      }

      return `\n  <text x="${paddingX}" y="${y}" class="line">${safeText}</text>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .line {
      font-family: ${fontFamily};
      font-size: ${STYLE.fontSize}px;
      fill: ${STYLE.textColor};
      opacity: ${opacity};
    }
  </style>
  <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"/>
  ${textLines}
</svg>`;
}

// --------- main ---------
(async function main() {
  try {
    const [goodreads, letterboxd, lastfm] = await Promise.allSettled([
      getGoodreadsLatest(),
      getLetterboxdLatest(),
      getLastfmLine(),
    ]);

    const gr = goodreads.status === "fulfilled" ? goodreads.value : { text: "Last Read: —", link: null };
    const lb = letterboxd.status === "fulfilled" ? letterboxd.value : { text: "Last Watched: —", link: null };
    const lf = lastfm.status === "fulfilled" ? lastfm.value : { text: "Last Listened To: —", link: null };

    const svg = renderSvg([gr, lb, lf]);
    fs.writeFileSync("now-playing.svg", svg, "utf8");
    console.log("Wrote now-playing.svg");
  } catch (err) {
    console.error("Failed to generate SVG:", err);
    process.exit(1);
  }
})();
