// generate-svg.cjs
// Generates now-playing.svg with 3 lines: Last Read, Last Watched, Now/Last Listened
// Right-aligned to match Bruges theme sidebar

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE (EDIT HERE) ---------
// If you want bigger letters WITHOUT breaking the frame, change fontSize + lineGap together.
const STYLE = {
  width: 360,

  // Padding inside the SVG
  paddingTop: 10,
  paddingRight: 6,
  paddingBottom: 10,

  // Typography
  fontFamily: "Times New Roman, Times, serif",
  fontSize: 13,        // try 13–15
  lineGap: 20,         // should be fontSize + ~7

  // Colors (match your theme vibe)
  labelColor: "#613d12",
  valueColor: "#613d12",
  opacity: 1,

  // Letter spacing (subtle, clean)
  labelLetterSpacing: "0.3px",
  valueLetterSpacing: "0.3px",
};

// Safer XML parsing
const parser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: true,
  parseAttributeValue: false,
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

function asString(v) {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  // fast-xml-parser can sometimes give objects like { "#text": "..." }
  if (typeof v === "object" && typeof v["#text"] === "string") return v["#text"].trim();
  return String(v).trim();
}

function cleanAuthor(authorRaw) {
  let a = asString(authorRaw);
  // Goodreads sometimes includes extra labels or weird spacing
  a = a.replace(/\s+/g, " ").trim();
  a = a.replace(/\(Goodreads Author\)/gi, "").trim();
  // Prevent "—" or "__" style placeholders
  if (!a || a === "_" || a === "__") return "";
  return a;
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

  const track = asString(item.name);
  const artist = asString(item.artist?.["#text"] || item.artist?.name);
  const link = asString(item.url) || null;

  const nowPlaying = Boolean(item?.["@attr"]?.nowplaying);
  const label = nowPlaying ? "Now Listening To" : "Last Listened To";
  const value = [track, artist].filter(Boolean).join(" — ").trim();

  return { text: `${label}: ${value || "—"}`, link };
}

// ---------- Letterboxd ----------
function parseLetterboxdTitle(rawTitle = "") {
  const t = asString(rawTitle);
  if (!t) return "—";

  // Many Letterboxd RSS titles look like: "★★★★★ Film Title, 2025 - ...".
  const noRating = t.split(" - ")[0].trim();

  // Convert "Title, 2025" -> "Title (2025)"
  const m = noRating.match(/^(.+?),\s*(\d{4})(?:\b|$)/);
  if (m) return `${m[1].trim()} (${m[2].trim()})`;

  // Or already "Title (2025)"
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

  const movie = parseLetterboxdTitle(item.title);
  const link = asString(item.link) || null;

  return { text: `Last Watched: ${movie || "—"}`, link };
}

// ---------- Goodreads ----------
async function getGoodreadsLatest() {
  if (!GOODREADS_RSS) return { text: "Last Read: —", link: null };

  const xml = await fetchText(GOODREADS_RSS);
  const parsed = parser.parse(xml);
  const item = pickFirstItem(parsed);
  if (!item) return { text: "Last Read: —", link: null };

  const rawTitle = asString(item.title);
  const link = asString(item.link) || null;

  // Goodreads RSS usually includes <author_name>, sometimes <dc:creator>
  const authorCandidates = [
    item.author_name,
    item.author,
    item["dc:creator"],
    item.creator,
  ]
    .map(cleanAuthor)
    .filter(Boolean);

  let author = authorCandidates[0] || "";

  // Fallback: "Title by Author" in the RSS title
  let title = rawTitle;
  if (/ by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    title = parts[0].trim();
    if (!author) author = cleanAuthor(parts.slice(1).join(" by ").trim());
  }

  if (!title) return { text: "Last Read: —", link };

  const authorText = author ? ` — ${author}` : "";
  return { text: `Last Read: ${title}${authorText}`, link };
}

// ---------- SVG rendering ----------
function splitLabelValue(lineText) {
  const idx = lineText.indexOf(":");
  if (idx === -1) return { label: lineText, value: "" };
  return { label: lineText.slice(0, idx + 1), value: lineText.slice(idx + 1).trimStart() };
}

function renderSvg(lines) {
  const {
    width,
    paddingTop,
    paddingRight,
    paddingBottom,
    fontSize,
    lineGap,
  } = STYLE;

  // Baseline-safe layout:
  // first line baseline at paddingTop + fontSize
  const contentHeight = fontSize + (lines.length - 1) * lineGap;
  const height = paddingTop + contentHeight + paddingBottom;

  const xRight = width - paddingRight;

  const rendered = lines
    .map((line, i) => {
      const y = paddingTop + fontSize + i * lineGap; // baseline-safe
      const { label, value } = splitLabelValue(line.text);

      const safeLabel = escapeXml(label);
      const safeValue = escapeXml(value);

      const textNode = `
  <text x="${xRight}" y="${y}" class="line" text-anchor="end">
    <tspan class="label">${safeLabel}</tspan>
    <tspan class="value">${safeValue ? " " + safeValue : " —"}</tspan>
  </text>`;

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
      font-family: ${STYLE.fontFamily};
      font-size: ${STYLE.fontSize}px;
      font-weight: ${STYLE.fontWeight || 400};
      opacity: ${STYLE.opacity};
    }
    .label {
      fill: ${STYLE.labelColor};
      letter-spacing: ${STYLE.labelLetterSpacing};
    }
    .value {
      fill: ${STYLE.valueColor};
      letter-spacing: ${STYLE.valueLetterSpacing};
    }
    a { text-decoration: none; }
  </style>

  <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"/>
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
