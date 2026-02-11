// generate-svg.cjs
// Generates now-playing.svg (3 lines) with:
// - Labels (Last Read/Watched/Listened) in TEXT color
// - Values (book/movie/song) in LINK color
// - Left-aligned, bigger type, stable layout

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE ---------
const STYLE = {
  width: 440,

  paddingLeft: 12,
  paddingTop: 30,
  paddingBottom: 26,

  fontFamily: "Times New Roman, Times, serif",
  fontSize: 26,
  lineGap: 40,

  // ✅ per your theme:
  // labels (Last Read/Watched/Listened) = #222222
  // values (names) = #613d12
  labelColor: "#222222",
  valueColor: "#613d12",

  labelLetterSpacing: "0.3px",
  valueLetterSpacing: "0.3px",
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

  const m = clean.match(/^(.+?),\s*(\d{4})(?:\b|$)/);
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

  const link = (item.link || "").trim() || null;

  let rawTitle = (item.title || "").trim();

  const authorCandidates = [
    item["dc:creator"],
    item.creator,
    item.author,
    item.author_name,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  let author = authorCandidates[0] || "";

  if (!author && / by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    if (parts.length >= 2) author = parts.slice(1).join(" by ").trim();
  }

  let title = rawTitle;
  if (/ by /i.test(rawTitle)) {
    title = rawTitle.split(/ by /i)[0].trim();
  }

  if (!title) return { text: "Last Read: —", link };

  const authorText = author ? ` — ${author}` : " — —";
  return { text: `Last Read: ${title}${authorText}`, link };
}

// ---------- SVG ----------
function splitLabelValue(lineText) {
  const idx = lineText.indexOf(":");
  if (idx === -1) return { label: lineText.trim(), value: "" };
  return {
    label: lineText.slice(0, idx + 1).trim(),
    value: lineText.slice(idx + 1).trim(),
  };
}

function renderSvg(lines) {
  const {
    width,
    paddingLeft,
    paddingTop,
    paddingBottom,
    lineGap,
    fontFamily,
    fontSize,
    labelColor,
    valueColor,
    labelLetterSpacing,
    valueLetterSpacing,
  } = STYLE;

  const height = paddingTop + paddingBottom + lineGap * lines.length + 10;

  const rendered = lines
    .map((line, i) => {
      const y = paddingTop + (i + 1) * lineGap;
      const { label, value } = splitLabelValue(line.text);

      const safeLabel = escapeXml(label || "");
      const safeValue = escapeXml(value || "—");

      const textNode = `
  <text x="${paddingLeft}" y="${y}" class="line" text-anchor="start">
    <tspan class="label">${safeLabel}</tspan>
    <tspan class="value">${safeValue ? " " + safeValue : " —"}</tspan>
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
     viewBox="0 0 ${width} ${height}"
     shape-rendering="geometricPrecision"
     text-rendering="geometricPrecision">
  <style>
    .line {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
    }
    .label {
      fill: ${labelColor};
      letter-spacing: ${labelLetterSpacing};
    }
    .value {
      fill: ${valueColor};
      letter-spacing: ${valueLetterSpacing};
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
    const [grRes, lbRes, lfRes] = await Promise.allSettled([
      getGoodreadsLatest(),
      getLetterboxdLatest(),
      getLastfmLine(),
    ]);

    const gr =
      grRes.status === "fulfilled" ? grRes.value : { text: "Last Read: —", link: null };
    const lb =
      lbRes.status === "fulfilled" ? lbRes.value : { text: "Last Watched: —", link: null };
    const lf =
      lfRes.status === "fulfilled" ? lfRes.value : { text: "Last Listened To: —", link: null };

    const svg = renderSvg([gr, lb, lf]);
    fs.writeFileSync("now-playing.svg", svg, "utf8");
    console.log("Wrote now-playing.svg");
  } catch (err) {
    console.error("Failed to generate SVG:", err);
    process.exit(1);
  }
})();
