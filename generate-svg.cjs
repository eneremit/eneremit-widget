// generate-svg.cjs
// Generates now-playing.svg (3 lines) sized for Tumblr sidebar (no shrink)

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE tuned for Tumblr sidebar ---------
const STYLE = {
  width: 270,          // IMPORTANT: match sidebar width so it doesn't get scaled down
  paddingLeft: 0,
  paddingTop: 18,
  paddingBottom: 14,

  fontFamily: "Times New Roman, Times, serif",
  fontSize: 16,        // bigger than before
  lineGap: 24,         // more breathing room

  labelColor: "#222222",
  valueColor: "#613d12",
  letterSpacing: "0.3px",

  // how much of the VALUE text to keep (book/movie/song part)
  // increase if you want, but this is already pretty generous for 270px width.
  maxValueChars: 60,
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

function clampValue(s, maxChars) {
  const t = (s || "").trim();
  if (!t) return "—";
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
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

function splitLabelValue(lineText) {
  const idx = lineText.indexOf(":");
  if (idx === -1) return { label: lineText, value: "" };
  return { label: lineText.slice(0, idx + 1), value: lineText.slice(idx + 1).trimStart() };
}

// ---------- Last.fm ----------
async function getLastfmLine() {
  if (!LASTFM_API_KEY || !LASTFM_USER) return { text: "Last Listened To: —", link: null };

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

// ---------- Letterboxd ----------
function parseLetterboxdTitle(rawTitle = "") {
  const t = rawTitle.trim();
  const clean = t.split(" - ")[0].trim(); // drop rating suffix etc.

  const m = clean.match(/^(.+?),\s*(\d{4})/);
  if (m) return `${m[1].trim()} (${m[2].trim()})`;

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

  const movie = parseLetterboxdTitle((item.title || "").trim());
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

  const rawTitle = (item.title || "").trim();
  const link = (item.link || "").trim() || null;

  const authorCandidates = [item.author_name, item.author, item["dc:creator"], item.creator]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  let author = authorCandidates[0] || "";

  let title = rawTitle;
  if (/ by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    title = parts[0].trim();
    if (!author) author = parts.slice(1).join(" by ").trim();
  }

  if (!title) return { text: "Last Read: —", link };

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
    labelColor,
    valueColor,
    letterSpacing,
    maxValueChars,
  } = STYLE;

  const height = paddingTop + paddingBottom + lineGap * lines.length;

  const rendered = lines
    .map((line, i) => {
      const y = paddingTop + (i + 1) * lineGap;

      const { label, value } = splitLabelValue(line.text);
      const safeLabel = escapeXml(label);
      const safeValue = escapeXml(clampValue(value, maxValueChars));

      const textNode = `
  <text x="${paddingLeft}" y="${y}" class="line" text-anchor="start">
    <tspan class="label">${safeLabel}</tspan>
    <tspan class="value"> ${safeValue}</tspan>
  </text>`;

      if (line.link) {
        const safeLink = escapeXml(line.link);
        return `
  <a href="${safeLink}" target="_blank" rel="noopener noreferrer">
    ${textNode}
  </a>`;
      }
      return textNode;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${width}" height="${height}"
     viewBox="0 0 ${width} ${height}">
  <style>
    .line {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      letter-spacing: ${letterSpacing};
    }
    .label { fill: ${labelColor}; }
    .value { fill: ${valueColor}; }
    a { text-decoration: none; }
  </style>

  <rect width="100%" height="100%" fill="transparent"/>
${rendered}
</svg>`;
}

// ---------- main ----------
(async function main() {
  try {
    const [grRes, lbRes, lfRes] = await Promise.allSettled([
      getGoodreadsLatest(),
      getLetterboxdLatest(),
      getLastfmLine(),
    ]);

    const gr = grRes.status === "fulfilled" ? grRes.value : { text: "Last Read: —", link: null };
    const lb = lbRes.status === "fulfilled" ? lbRes.value : { text: "Last Watched: —", link: null };
    const lf = lfRes.status === "fulfilled" ? lfRes.value : { text: "Last Listened To: —", link: null };

    const svg = renderSvg([gr, lb, lf]);
    fs.writeFileSync("now-playing.svg", svg, "utf8");
    console.log("Wrote now-playing.svg");
  } catch (err) {
    console.error("Failed to generate SVG:", err);
    process.exit(1);
  }
})();
