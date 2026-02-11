/* generate-svg.cjs */
const fs = require("fs");

const { XMLParser } = require("fast-xml-parser");

// Node 20 has fetch built-in
async function fetchText(url) {
  if (!url) return null;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "eneremit-widget/1.0 (+github actions)"
    }
  });
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return await res.text();
}

function escapeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function cleanText(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

// --- RSS parsing helpers
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
});

function firstItemFromRss(xml) {
  if (!xml) return null;
  const data = parser.parse(xml);
  const channel = data?.rss?.channel;
  const item = channel?.item;
  if (!item) return null;
  return Array.isArray(item) ? item[0] : item;
}

function stripHtml(html) {
  return cleanText(String(html ?? "").replace(/<[^>]*>/g, " "));
}

// --- Goodreads: try to extract "Title by Author" from RSS item title
function parseGoodreads(item) {
  // Goodreads "read" shelf RSS usually puts "Title" in item.title
  // Author can appear in item.authorName-like fields depending on feed.
  // We’ll try a few patterns robustly.

  if (!item) return { book: "—", author: "—" };

  const rawTitle = cleanText(item.title || "");
  // Sometimes Goodreads titles look like: "The Little Prince by Antoine de Saint-Exupéry"
  const byMatch = rawTitle.match(/^(.*?)\s+by\s+(.*)$/i);

  if (byMatch) {
    return { book: cleanText(byMatch[1]), author: cleanText(byMatch[2]) };
  }

  // Sometimes author is in dc:creator or author field
  const creator = cleanText(item["dc:creator"] || item.creator || item.author || "");
  if (creator) return { book: rawTitle || "—", author: creator };

  return { book: rawTitle || "—", author: "—" };
}

// --- Letterboxd: extract Movie + Year
function parseLetterboxd(item) {
  if (!item) return { movie: "—", year: "—" };

  // Letterboxd item.title often includes year like: "Hamnet, 2025" OR "Hamnet (2025)" depending
  const rawTitle = cleanText(item.title || "");

  // Prefer pattern with comma year
  const commaYear = rawTitle.match(/^(.*?),\s*(\d{4})$/);
  if (commaYear) return { movie: cleanText(commaYear[1]), year: commaYear[2] };

  // Or parenthesis year
  const parenYear = rawTitle.match(/^(.*?)\s*\((\d{4})\)\s*$/);
  if (parenYear) return { movie: cleanText(parenYear[1]), year: parenYear[2] };

  // Fallback: no year
  return { movie: rawTitle || "—", year: "—" };
}

// --- Last.fm
function urlencode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function lastfmRequest(method, params) {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) throw new Error("Missing LASTFM_API_KEY secret");

  const url =
    "https://ws.audioscrobbler.com/2.0/?" +
    urlencode({ method, ...params, api_key: apiKey, format: "json" });

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Last.fm request failed (${res.status})`);
  return await res.json();
}

async function getLastfmLine() {
  const user = process.env.LASTFM_USER;
  if (!user) throw new Error("Missing LASTFM_USER secret");

  const data = await lastfmRequest("user.getrecenttracks", { user, limit: 1 });
  const item = data?.recenttracks?.track?.[0];
  if (!item) return { label: "Last Listened To:", text: "—", url: `https://www.last.fm/user/${user}` };

  const track = cleanText(item.name);
  const artist = cleanText(item.artist?.["#text"] || item.artist?.name || "");
  const lineText = track && artist ? `${track} — ${artist}` : (track || "—");

  const nowPlaying = !!item?.["@attr"]?.nowplaying;
  return {
    label: nowPlaying ? "Now Listening To:" : "Last Listened To:",
    text: lineText,
    url: item.url || `https://www.last.fm/user/${user}`,
  };
}

function buildSvg({ goodreads, letterboxd, lastfm, links }) {
  // You said your lettering looks good already—so I’m keeping this minimal, clean,
  // and easy to tweak: font family, size, color, opacity.
  //
  // If you want it to match your Tumblr *exactly*, tell me the exact CSS values
  // you’re using (font-family, font-size, color) and I’ll mirror them 1:1.

  const width = 600;
  const height = 110;

  const fontFamily = "Times New Roman, Times, serif";
  const fontSize = 16;
  const fill = "#613d12";
  const opacity = 1;

  const line1 = `Last Read: ${goodreads.book} — ${goodreads.author}`;
  const line2 = letterboxd.year !== "—"
    ? `Last Watched: ${letterboxd.movie} (${letterboxd.year})`
    : `Last Watched: ${letterboxd.movie}`;
  const line3 = `${lastfm.label} ${lastfm.text}`;

  // Make each line clickable: wrap <text> with <a>
  // Note: works when SVG is embedded as <object> or opened directly.
  // If you embed as <img>, browsers usually do NOT allow clicking inside the SVG.
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <style>
    text {
      font-family: ${fontFamily};
      font-size: ${fontSize}px;
      fill: ${fill};
      opacity: ${opacity};
    }
    a:hover text { text-decoration: underline; }
  </style>

  <a href="${escapeXml(links.goodreads)}" target="_blank" rel="noopener noreferrer">
    <text x="0" y="30">${escapeXml(line1)}</text>
  </a>

  <a href="${escapeXml(links.letterboxd)}" target="_blank" rel="noopener noreferrer">
    <text x="0" y="60">${escapeXml(line2)}</text>
  </a>

  <a href="${escapeXml(lastfm.url)}" target="_blank" rel="noopener noreferrer">
    <text x="0" y="90">${escapeXml(line3)}</text>
  </a>
</svg>
`;

  return svg;
}

async function main() {
  const goodreadsRss = process.env.GOODREADS_RSS;
  const letterboxdRss = process.env.LETTERBOXD_RSS;

  // Links for click targets
  const links = {
    goodreads: "https://www.goodreads.com/",
    letterboxd: "https://letterboxd.com/",
  };

  // Fetch RSS in parallel
  const [grXml, lbXml, lastfm] = await Promise.all([
    fetchText(goodreadsRss).catch(() => null),
    fetchText(letterboxdRss).catch(() => null),
    getLastfmLine(),
  ]);

  const grItem = firstItemFromRss(grXml);
  const lbItem = firstItemFromRss(lbXml);

  const goodreads = parseGoodreads(grItem);
  const letterboxd = parseLetterboxd(lbItem);

  // If you want the clickable line to go to YOUR profiles, set those URLs:
  if (goodreadsRss) links.goodreads = "https://www.goodreads.com/user/show/138343303";
  if (letterboxdRss) links.letterboxd = "https://letterboxd.com/eneremit/";

  const svg = buildSvg({ goodreads, letterboxd, lastfm, links });

  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
