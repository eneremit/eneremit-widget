// generate-svg.cjs
// Generates now-playing.svg (Read / Watched / Listened)
// Natural label/value spacing + wraps ONLY when needed
// Adds: cache-busting, no-store fetch, timeout+retry, more robust RSS parsing

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE (Tumblr sidebar tuned) ---------
const STYLE = {
  width: 290, // was 270
  paddingLeft: 0,
  paddingRight: 0,
  paddingTop: 18,
  paddingBottom: 14,

  fontFamily: "Times New Roman, Times, serif",
  fontSize: 16,
  letterSpacing: "0.3px",

  labelColor: "#222222",
  valueColor: "#613d12",

  // Wrapping / layout
  labelWidthPx: 140,
  gapPx: 6,
  lineGap: 24,
  maxLinesPerSection: 2,
};

// More tolerant parser options help RSS/Atom weirdness
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: true,
});

// ---------- helpers ----------
function escapeXml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function firstOf(v) {
  return Array.isArray(v) ? v[0] : v;
}

function withCacheBust(url) {
  if (!url) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}cb=${Date.now()}`;
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, opts = {}, { retries = 2, timeoutMs = 9000 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, opts, timeoutMs);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (e) {
      lastErr = e;
      // small backoff
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchText(url) {
  const res = await fetchWithRetry(withCacheBust(url), {
    cache: "no-store",
    headers: {
      "User-Agent": "eneremit-widget",
      Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    },
  });
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetchWithRetry(withCacheBust(url), {
    cache: "no-store",
    headers: {
      "User-Agent": "eneremit-widget",
      Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
    },
  });
  return await res.json();
}

// Supports both RSS (rss.channel.item) and Atom (feed.entry)
function pickFirstItem(parsed) {
  const rssItem = parsed?.rss?.channel?.item;
  const atomEntry = parsed?.feed?.entry;
  return firstOf(rssItem) || firstOf(atomEntry) || null;
}

function splitLabelValue(lineText) {
  const idx = lineText.indexOf(":");
  if (idx === -1) return { label: lineText.trim(), value: "" };
  return {
    label: lineText.slice(0, idx + 1).trim(),
    value: lineText.slice(idx + 1).trimStart(),
  };
}

// Rough width estimate for Times at 16px. We use it ONLY to decide if we wrap.
function approxPxPerChar() {
  return 7.0;
}

function approxCharsThatFit(pxWidth) {
  return Math.max(10, Math.floor(pxWidth / approxPxPerChar()));
}

function ellipsize(text, maxChars) {
  const t = (text || "").trim();
  if (!t) return "—";
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function wrapByWords(text, maxChars) {
  const t = (text || "—").trim() || "—";
  if (t.length <= maxChars) return [t];

  const cut = t.lastIndexOf(" ", maxChars);
  const first = (cut > 20 ? t.slice(0, cut) : t.slice(0, maxChars)).trim();

  let rest = t.slice(first.length).trim();
  if (!rest) return [first];

  return [first, rest];
}

// Smart wrap rules:
// - Prefer ONE line whenever possible.
// - If value contains " — " (author/artist), never split the name.
//   If it can’t fit, move "— Author" whole onto line 2.
function smartWrapValue(value, maxCharsLine1, maxCharsLine2, maxLines) {
  const v = (value || "—").trim() || "—";

  if (v.length <= maxCharsLine1 + 6) return [v];

  const sep = " — ";
  if (v.includes(sep)) {
    const parts = v.split(sep);
    const meta = parts.pop().trim();
    const main = parts.join(sep).trim();

    if (main && main.length <= maxCharsLine1 + 6) {
      return [main, ellipsize("— " + meta, maxCharsLine2)].slice(0, maxLines);
    }

    const [m1] = wrapByWords(main || v, maxCharsLine1 + 2);
    return [m1, ellipsize("— " + meta, maxCharsLine2)].slice(0, maxLines);
  }

  const [l1, l2raw] = wrapByWords(v, maxCharsLine1 + 2);
  const l2 = l2raw ? ellipsize(l2raw, maxCharsLine2) : "";
  return l2 ? [l1, l2].slice(0, maxLines) : [l1];
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
      _: String(Date.now()), // extra anti-cache
    }).toString();

  const data = await fetchJson(url);
  const item = data?.recenttracks?.track?.[0];
  if (!item) return { text: "Last Listened To: —", link: null };

  const track = (safeText(item.name) || "").trim();
  const artist = (safeText(item.artist?.["#text"] || item.artist?.name) || "").trim();
  const link =
    (safeText(item.url) || "").trim() || `https://www.last.fm/user/${encodeURIComponent(LASTFM_USER)}`;

  const nowPlaying = item?.["@attr"]?.nowplaying === "true" || item?.["@attr"]?.nowplaying === true;
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

  const rawTitle =
    (safeText(item.title) || safeText(item["dc:title"]) || safeText(item["media:title"]) || "").trim();

  const movie = parseLetterboxdTitle(rawTitle);
  const link = (safeText(item.link) || safeText(item.id) || "").trim() || null;

  return { text: `Last Watched: ${movie || "—"}`, link };
}

// ---------- Goodreads ----------
async function getGoodreadsLatest() {
  if (!GOODREADS_RSS) return { text: "Last Read: —", link: null };

  const xml = await fetchText(GOODREADS_RSS);
  const parsed = parser.parse(xml);
  const item = pickFirstItem(parsed);
  if (!item) return { text: "Last Read: —", link: null };

  const rawTitle =
    (safeText(item.title) || safeText(item["dc:title"]) || safeText(item["media:title"]) || "").trim();

  const link = (safeText(item.link) || safeText(item.id) || "").trim() || null;

  const authorCandidates = [
    safeText(item.author_name),
    safeText(item.author),
    safeText(item["dc:creator"]),
    safeText(item.creator),
  ]
    .map((v) => v.trim())
    .filter(Boolean);

  let author = authorCandidates[0] || "";
  let title = rawTitle;

  if (/ by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    title = (parts[0] || "").trim();
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

  const availablePx = Math.max(60, width - paddingLeft - paddingRight);
  const maxCharsFullLine = approxCharsThatFit(availablePx) + 10;

  const maxCharsLine1Value =
    approxCharsThatFit(Math.max(80, availablePx - labelWidthPx - gapPx)) + 10;
  const maxCharsLine2Value = maxCharsFullLine;

  const blocks = lines.map((line) => {
    const { label, value } = splitLabelValue(line.text);
    const wrapped = smartWrapValue(
      value || "—",
      maxCharsLine1Value,
      maxCharsLine2Value,
      maxLinesPerSection
    );
    const valueX = paddingLeft + labelWidthPx + gapPx;
    return { label, wrapped, link: line.link || null, valueX };
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

      const textNode = `
  <text x="${paddingLeft}" y="${y1}" class="line" text-anchor="start">
    <tspan class="label">${labelSafe}</tspan>
    <tspan class="value"> ${v1}</tspan>${
      v2
        ? `\n    <tspan class="value" x="${b.valueX}" dy="${lineGap}">${v2}</tspan>`
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
     viewBox="0 0 ${width} ${height}"
     overflow="visible">
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
  // Don’t fail the whole build if one feed flakes
  const [grRes, lbRes, lfRes] = await Promise.allSettled([
    getGoodreadsLatest(),
    getLetterboxdLatest(),
    getLastfmLine(),
  ]);

  const gr = grRes.status === "fulfilled" ? grRes.value : { text: "Last Read: —", link: null };
  const lb = lbRes.status === "fulfilled" ? lbRes.value : { text: "Last Watched: —", link: null };
  const lf = lfRes.status === "fulfilled" ? lfRes.value : { text: "Last Listened To: —", link: null };

  // Optional: leaves breadcrumbs in Actions logs
  console.log("DEBUG gr:", gr);
  console.log("DEBUG lb:", lb);
  console.log("DEBUG lf:", lf);

  const svg = renderSvg([gr, lb, lf]);
  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
})();
