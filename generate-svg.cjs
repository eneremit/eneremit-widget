// generate-svg.cjs
// 3 lines, styled to match your Tumblr theme (Times New Roman, small size, brown labels)

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// --------- REQUIRED ENV VARS ---------
const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER = process.env.LASTFM_USER;

const GOODREADS_RSS = process.env.GOODREADS_RSS;   // e.g. https://www.goodreads.com/review/list_rss/138343303?shelf=read
const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS; // your Letterboxd RSS link

// --------- STYLE: tuned to match your blog/player ---------
const STYLE = {
  width: 320,
  paddingX: 10,
  paddingY: 20,
  lineGap: 18,

  fontFamily: "Times New Roman, Times, serif",

  // Your theme text often reads smaller in practice. 11px usually matches better in SVG.
  fontSize: 11,

  // Your player label color
  labelColor: "#613d12",

  // Your theme text color
  valueColor: "#000000",

  // match "artist-name" feel
  valueLetterSpacing: "0.3px",

  // label spacing: set to "1.3px" if you want that more stylized look
  labelLetterSpacing: "0.3px",

  opacity: 1,
};

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

// --------- Last.fm ---------
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

// --------- Letterboxd ---------
function parseLetterboxdTitle(rawTitle = "") {
  const t = rawTitle.trim();
  const noRating = t.split(" - ")[0].trim();

  const m = noRating.match(/^(.+?),\s*(\d{4})(?:\b|$)/);
  if (m) return `${m[1].trim()} (${m[2].trim()})`;

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

  const movie = parseLetterboxdTitle((item.title || "").trim());
  const link = (item.link || "").trim() || null;
  return { text: `Last Watched: ${movie || "—"}`, link };
}

// --------- Goodreads ---------
async function getGoodreadsLatest() {
  if (!GOODREADS_RSS) return { text: "Last Read: —", link: null };

  const xml = await fetchText(GOODREADS_RSS);
  const parsed = parser.parse(xml);
  const item = pickFirstItem(parsed);
  if (!item) return { text: "Last Read: —", link: null };

  const rawTitle = (item.title || "").trim();
  const link = (item.link || "").trim() || null;

  const authorCandidates = [
    item.author_name,
    item.author,
    item["dc:creator"],
    item.creator,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);

  let author = authorCandidates[0] || "";

  if (!author && / by /i.test(rawTitle)) {
    const parts = rawTitle.split(/ by /i);
    if (parts.length >= 2) author = parts.slice(1).join(" by ").trim();
  }

  let title = rawTitle;
  if (/ by /i.test(rawTitle)) title = rawTitle.split(/ by /i)[0].trim();

  if (!title) return { text: "Last Read: —", link };
  const authorText = author ? ` — ${author}` : "";
  return { text: `Last Read: ${title}${authorText}`, link };
}

// --------- SVG render (label/value styled separately) ---------
function splitLabelValue(lineText) {
  const idx = lineText.indexOf(":");
  if (idx === -1) return { label: lineText, value: "" };
  return {
    label: lineText.slice(0, idx + 1), // keep the colon
    value: lineText.slice(idx + 1).trimStart(),
  };
}

function renderSvg(lines) {
  const { width, paddingX, paddingY, lineGap } = STYLE;
  const height = paddingY + lineGap * lines.length + 10;

  const rendered = lines
    .map((line, i) => {
      const y = paddingY + i * lineGap;
      const { label, value } = splitLabelValue(line.text);

      const safeLabel = escapeXml(label);
      const safeValue = escapeXml(value);

      const textNode = `
  <text x="${paddingX}" y="${y}" class="line">
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
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    .line {
      font-family: ${STYLE.fontFamily};
      font-size: ${STYLE.fontSize}px;
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
  </style>

  <rect x="0" y="0" width="${width}" height="${height}" fill="transparent"/>
${rendered}
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
