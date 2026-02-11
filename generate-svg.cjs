// generate-svg.cjs
// Auto-width SVG so text never clips (even in <img> rendering)
// Wrap values at 42 chars
// Labels #222222, Values #613d12
// Left-aligned, Tumblr-friendly

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || "";
const LASTFM_USER = process.env.LASTFM_USER || "";
const GOODREADS_RSS = process.env.GOODREADS_RSS || "";
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS || "";

// --------- STYLE ---------
const STYLE = {
  // width is computed dynamically; this is just a floor
  minWidth: 760,
  maxWidth: 1400, // prevents going insane-wide; long stuff will wrap anyway

  paddingLeft: 12,
  paddingTop: 30,
  paddingBottom: 26,

  fontFamily: "Times New Roman, Times, serif",
  fontSize: 26,

  lineGap: 40,
  wrapGap: 30,

  labelColor: "#222222",
  valueColor: "#613d12",

  labelLetterSpacing: "0.3px",
  valueLetterSpacing: "0.3px",

  approxCharsPerLine: 42,

  // crude-but-effective font metrics for Times @ this size
  // (avg glyph width ≈ 0.62em; a little extra for safety)
  avgCharPx: 0.66,
  extraRightPad: 80, // big “just in case” buffer
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
    label: lineText.slice(0, idx + 1).trim(),
    value: lineText.slice(idx + 1).trim(),
  };
}

function wrapValue(value, maxChars) {
  const v = (value || "").trim();
  if (!v) return ["—"];
  if (v.length <= maxChars) return [v];

  // prefer wrapping at “ — ” so Track stays with itself
  const dash = " — ";
  const dashIdx = v.indexOf(dash);
  if (dashIdx !== -1) {
    const left = v.slice(0, dashIdx).trim();
    const right = v.slice(dashIdx + dash.length).trim();
    if (left && right && left.length <= maxChars) {
      return [left, `— ${right}`];
    }
  }

  // otherwise wrap at last space before limit
  const cut = v.lastIndexOf(" ", maxChars);
  if (cut > 10) return [v.slice(0, cut).trim(), v.slice(cut + 1).trim()];

  return [v.slice(0, maxChars).trim(), v.slice(maxChars).trim()];
}

function estimateNeededWidthPx(renderPlan) {
  // longest rendered line is: "<label> <valueLine>"
  let maxChars = 0;

  for (const row of renderPlan) {
    const labelChars = (row.label || "").length;
    for (const vLine of row.valueLines) {
      // value line has leading space in rendering (except wrapped line starts at x too)
      const lineChars = labelChars + 1 + (vLine || "").length;
      if (lineChars > maxChars) maxChars = lineChars;
    }
  }

  const approxPx =
    STYLE.paddingLeft +
    Math.ceil(maxChars * STYLE.fontSize * STYLE.avgCharPx) +
    STYLE.extraRightPad;

  return Math.min(Math.max(approxPx, STYLE.minWidth), STYLE.maxWidth);
}

// ---------- Last.fm ----------
async function getLastfmLine() {
  if (!LASTFM_API_KEY || !LASTFM_USER)
    return { text: "Last Listened To: —", link: null };

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

  // fall back to “Title by Author” parsing
  if (!author && / by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    if (parts.length >= 2) author = parts.slice(1).join(" by ").trim();
  }

  let title = rawTitle;
  if (/ by /i.test(rawTitle)) title = rawTitle.split(/ by /i)[0].trim();

  if (!title) return { text: "Last Read: —", link };

  // if author missing, keep the “— —” placeholder you liked
  const authorText = author ? ` — ${author}` : " — —";
  return { text: `Last Read: ${title}${authorText}`, link };
}

// ---------- Build render plan (also used to estimate width) ----------
function buildRenderPlan(lines) {
  return lines.map((line) => {
    const { label, value } = splitLabelValue(line.text);
    const valueLines = wrapValue(value, STYLE.approxCharsPerLine);
    return { label, valueLines, link: line.link || null };
  });
}

// ---------- SVG ----------
function renderSvg(renderPlan, widthPx) {
  let y = STYLE.paddingTop;
  const nodes = [];

  for (const row of renderPlan) {
    const safeLabel = escapeXml(row.label || "");
    const safeV1 = escapeXml(row.valueLines[0] || "—");
    const safeV2 = row.valueLines[1] ? escapeXml(row.valueLines[1]) : "";

    const textParts = [
      `<tspan class="label">${safeLabel}</tspan>`,
      `<tspan class="value">${" " + safeV1}</tspan>`,
    ];

    if (safeV2) {
      textParts.push(
        `<tspan x="${STYLE.paddingLeft}" dy="${STYLE.wrapGap}" class="value">${safeV2}</tspan>`
      );
    }

    const textNode = `
  <text x="${STYLE.paddingLeft}" y="${y}" class="line" text-anchor="start">
    ${textParts.join("")}
  </text>`;

    const wrapped = row.link
      ? `
  <a href="${escapeXml(row.link)}" target="_blank" rel="noopener noreferrer">
    ${textNode}
  </a>`
      : textNode;

    nodes.push(wrapped);
    y += STYLE.lineGap + (safeV2 ? STYLE.wrapGap : 0);
  }

  const height = y + STYLE.paddingBottom;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     width="${widthPx}" height="${height}"
     viewBox="0 0 ${widthPx} ${height}">
  <style>
    .line {
      font-family: ${STYLE.fontFamily};
      font-size: ${STYLE.fontSize}px;
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

  <rect width="100%" height="100%" fill="transparent"/>
${nodes.join("\n")}
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

    const renderPlan = buildRenderPlan([gr, lb, lf]);
    const widthPx = estimateNeededWidthPx(renderPlan);

    const svg = renderSvg(renderPlan, widthPx);
    fs.writeFileSync("now-playing.svg", svg, "utf8");
    console.log("Wrote now-playing.svg");
  } catch (err) {
    console.error("Failed to generate SVG:", err);
    process.exit(1);
  }
})();
