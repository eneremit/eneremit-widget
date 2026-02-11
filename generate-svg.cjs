// generate-svg.cjs
// Generates now-playing.svg (Read / Watched / Listened)
// Values wrap onto a second line when long (no clipping, no squishing)

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE (Tumblr sidebar tuned) ---------
const STYLE = {
  width: 270, // keep aligned with sidebar width
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 18,
  paddingBottom: 14,

  fontFamily: "Times New Roman, Times, serif",
  fontSize: 16,
  letterSpacing: "0.3px",

  labelColor: "#222222",
  valueColor: "#613d12",

  // Layout
  labelWidthPx: 128,     // space reserved for "Last Listened To:"
  gapPx: 6,              // space between label and value
  lineGap: 24,           // vertical distance between rendered lines
  maxLinesPerSection: 2, // wrap value to at most 2 lines
};

const parser = new XMLParser({ ignoreAttributes: false });

// ---------- helpers ----------
function escapeXml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;"); // keep XML valid
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
  if (idx === -1) return { label: lineText.trim(), value: "" };
  return {
    label: lineText.slice(0, idx + 1).trim(),
    value: lineText.slice(idx + 1).trimStart(),
  };
}

// Approx width-per-character estimate for Times at 16px.
// This is not perfect typography math, but good enough for 2-line wrapping.
function approxCharsThatFit(pxWidth) {
  // Times New Roman average glyph width ~0.52em-ish; at 16px that's ~8.3px
  const approxPxPerChar = 8.2;
  return Math.max(10, Math.floor(pxWidth / approxPxPerChar));
}

function wrapToTwoLines(value, maxCharsPerLine) {
  const text = (value || "—").trim();
  if (!text) return ["—"];

  if (text.length <= maxCharsPerLine) return [text];

  // try to wrap at a space before the limit
  const cut = text.lastIndexOf(" ", maxCharsPerLine);
  const first = (cut > 20 ? text.slice(0, cut) : text.slice(0, maxCharsPerLine)).trim();

  let rest = text.slice(first.length).trim();
  if (!rest) return [first];

  // second line: keep as-is; if absurdly long, end with ellipsis
  if (rest.length > maxCharsPerLine) {
    rest = rest.slice(0, Math.max(0, maxCharsPerLine - 1)).trimEnd() + "…";
  }

  return [first, rest];
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
  const clean = t.split(" - ")[0].trim();

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
    paddingRight,
    paddingTop,
    paddingBottom,
    fontFamily,
    fontSize,
    letterSpacing,
    labelColor,
    valueColor,
    labelWidthPx,
    gapPx,
    lineGap,
    maxLinesPerSection,
  } = STYLE;

  const valueX = paddingLeft + labelWidthPx + gapPx;
  const valueWidth = Math.max(40, width - paddingRight - valueX);
  const maxChars = approxCharsThatFit(valueWidth);

  // Build rendered blocks and count how many total lines we need
  const blocks = lines.map((line) => {
    const { label, value } = splitLabelValue(line.text);
    const wrapped = wrapToTwoLines(value || "—", maxChars).slice(0, maxLinesPerSection);
    return { label: label || "", wrapped, link: line.link || null };
  });

  const totalRenderedLines = blocks.reduce((sum, b) => sum + Math.max(1, b.wrapped.length), 0);
  const height = paddingTop + paddingBottom + totalRenderedLines * lineGap;

  let cursorLine = 0;

  const rendered = blocks
    .map((b) => {
      const labelSafe = escapeXml(b.label);

      // First line of section includes label + first value line
      const firstY = paddingTop + (cursorLine + 1) * lineGap;
      const firstValue = escapeXml(b.wrapped[0] || "—");

      // Optional second line is value-only (indented to valueX)
      const secondLine = b.wrapped[1] ? escapeXml(b.wrapped[1]) : "";

      cursorLine += Math.max(1, b.wrapped.length);

      const textNode = `
  <text x="${paddingLeft}" y="${firstY}" class="line" text-anchor="start">
    <tspan class="label">${labelSafe}</tspan>
    <tspan class="value" x="${valueX}">${firstValue}</tspan>
    ${
      secondLine
        ? `\n    <tspan class="value" x="${valueX}" dy="${lineGap}">${secondLine}</tspan>`
        : ""
    }
  </text>`;

      if (b.link) {
        const safeLink = escapeXml(b.link);
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
