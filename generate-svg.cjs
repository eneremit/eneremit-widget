// generate-svg.cjs
// Generates now-playing.svg (Read / Watched / Listened)
// Natural label/value spacing + wraps ONLY when needed
// Protects author/artist chunk so it doesn't split (Anne Rice, Slayyter, etc.)

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE (Tumblr sidebar tuned) ---------
const STYLE = {
  width: 270,            // keep aligned with sidebar width so Tumblr doesn't shrink it weirdly
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 18,
  paddingBottom: 14,

  fontFamily: "Times New Roman, Times, serif",
  fontSize: 16,
  letterSpacing: "0.3px",

  labelColor: "#222222",
  valueColor: "#613d12",

  gapPx: 6,              // space between label and value on line 1
  lineGap: 24,
  maxLinesPerSection: 2, // value may wrap to 2 lines max
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

function splitLabelValue(lineText) {
  const idx = lineText.indexOf(":");
  if (idx === -1) return { label: lineText.trim(), value: "" };
  return {
    label: lineText.slice(0, idx + 1).trim(),     // includes colon
    value: lineText.slice(idx + 1).trimStart(),   // value after colon
  };
}

// Times at 16px: average glyph width rough estimate.
// We only use this for WRAP decisions, not for spacing.
function approxPxPerChar() {
  return 8.2;
}

function approxCharsThatFit(pxWidth) {
  return Math.max(10, Math.floor(pxWidth / approxPxPerChar()));
}

function ellipsizeToFit(text, maxChars) {
  const t = (text || "").trim();
  if (!t) return "—";
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function wrapByWords(text, maxChars) {
  const t = (text || "").trim();
  if (!t) return ["—"];
  if (t.length <= maxChars) return [t];

  // find a nice break at a space
  const cut = t.lastIndexOf(" ", maxChars);
  const first = (cut > 20 ? t.slice(0, cut) : t.slice(0, maxChars)).trim();

  let rest = t.slice(first.length).trim();
  if (!rest) return [first];

  return [first, rest];
}

/**
 * Smart wrap:
 * - Only wrap if needed
 * - If value has " — " (author/artist), keep that chunk intact:
 *   Prefer:
 *     line1: main title...
 *     line2: — Author/Artist
 *   instead of splitting the name.
 */
function smartWrapValue(label, value, availablePx, gapPx, maxLines) {
  const v = (value || "—").trim() || "—";

  // Estimate how much space value has on line 1 after the label.
  const labelPx = label.length * approxPxPerChar();
  const valuePx = Math.max(60, availablePx - labelPx - gapPx); // never let it become microscopic
  const maxCharsLine1 = approxCharsThatFit(valuePx);

  // If it fits on line 1, do nothing.
  if (v.length <= maxCharsLine1) return [v];

  // Protect author/artist chunk if present
  const sep = " — ";
  if (v.includes(sep)) {
    const parts = v.split(sep);
    const meta = parts.pop().trim();                 // author/artist
    const main = parts.join(sep).trim();             // title (may also include dashes)

    // If the "main" fits on line1, push meta to line2 cleanly.
    if (main && main.length <= maxCharsLine1) {
      const line2 = "— " + meta;
      // Line2 width is full available width (no label)
      const maxCharsLine2 = approxCharsThatFit(availablePx);
      const safe2 = ellipsizeToFit(line2, maxCharsLine2);
      return [main, safe2].slice(0, maxLines);
    }

    // Otherwise: wrap main by words on line1/line2, then (if possible) append meta to line2,
    // but never split meta. If it's too much, meta becomes its own line2.
    const maxCharsLine2 = approxCharsThatFit(availablePx);
    const [m1, m2raw] = wrapByWords(main || v, maxCharsLine1);
    let m2 = (m2raw || "").trim();

    if (!m2) {
      const safe2 = ellipsizeToFit("— " + meta, maxCharsLine2);
      return [m1, safe2].slice(0, maxLines);
    }

    // Try append meta to second line if it fits, otherwise meta alone on second line.
    const candidate = `${m2}${sep}${meta}`.trim();
    if (candidate.length <= maxCharsLine2) {
      return [m1, candidate].slice(0, maxLines);
    }

    const safe2 = ellipsizeToFit("— " + meta, maxCharsLine2);
    return [m1, safe2].slice(0, maxLines);
  }

  // No separator: normal wrap by words
  const maxCharsLine2 = approxCharsThatFit(availablePx);
  const lines = wrapByWords(v, maxCharsLine1);
  if (lines.length === 1) return lines;

  // Ellipsize second line if needed
  lines[1] = ellipsizeToFit(lines[1], maxCharsLine2);
  return lines.slice(0, maxLines);
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
    gapPx,
    lineGap,
    maxLinesPerSection,
  } = STYLE;

  const availablePx = Math.max(40, width - paddingLeft - paddingRight);

  // Pre-calc wrapped blocks so we can compute height
  const blocks = lines.map((line) => {
    const { label, value } = splitLabelValue(line.text);
    const wrapped = smartWrapValue(label, value, availablePx, gapPx, maxLinesPerSection);
    return { label, wrapped, link: line.link || null };
  });

  const totalLines = blocks.reduce((sum, b) => sum + Math.max(1, b.wrapped.length), 0);
  const height = paddingTop + paddingBottom + totalLines * lineGap;

  let cursor = 0;

  const rendered = blocks
    .map((b) => {
      const y1 = paddingTop + (cursor + 1) * lineGap;
      const labelSafe = escapeXml(b.label);
      const v1 = escapeXml(b.wrapped[0] || "—");
      const v2 = b.wrapped[1] ? escapeXml(b.wrapped[1]) : "";

      cursor += Math.max(1, b.wrapped.length);

      // Line 1: label + value starts immediately after label (dx)
      // Line 2: value-only, aligned to left padding (no weird gaps)
      const textNode = `
  <text x="${paddingLeft}" y="${y1}" class="line" text-anchor="start">
    <tspan class="label">${labelSafe}</tspan>
    <tspan class="value" dx="${gapPx}">${v1}</tspan>${
      v2 ? `\n    <tspan class="value" x="${paddingLeft}" dy="${lineGap}">${v2}</tspan>` : ""
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
