/* generate-svg.cjs
   Outputs: now-playing.svg
   Reads:
     - LASTFM_API_KEY, LASTFM_USER
     - LETTERBOXD_RSS or LETTERBOXD_RSS_URL
     - GOODREADS_RSS or GOODREADS_RSS_URL
*/

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

// ---------- EDIT THESE TO MATCH YOUR TUMBLR LOOK ----------
const STYLE = {
  width: 360,
  paddingX: 0,
  paddingY: 0,
  lineGap: 18,

  // Try to match your blog
  fontFamily: "Times New Roman, Times, serif",
  fontSize: 13,         // <-- make bigger/smaller here
  fontWeight: 400,
  fill: "#613d12",      // <-- your brown
  opacity: 1,
};

// Labels (edit wording here whenever you want)
const LABELS = {
  read: "Last Read:",
  watched: "Last Watched:",
  listeningNow: "Now Listening To:",
  listeningLast: "Last Listened To:",
};

// Optional: make each line clickable to your profiles
const LINKS = {
  goodreadsProfile: "https://www.goodreads.com/user/show/138343303",
  letterboxdProfile: "https://letterboxd.com/eneremit/",
  lastfmProfile: "https://www.last.fm/user/eneremit",
};
// ---------------------------------------------------------

function envAny(...keys) {
  for (const k of keys) {
    if (process.env[k] && String(process.env[k]).trim()) return String(process.env[k]).trim();
  }
  return "";
}

async function fetchText(url) {
  if (!url) return "";
  const res = await fetch(url, { headers: { "User-Agent": "eneremit-widget/1.0 (+github actions)" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": "eneremit-widget/1.0 (+github actions)" } });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

function escapeXml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function firstItem(x) {
  if (!x) return null;
  if (Array.isArray(x)) return x[0] ?? null;
  return x;
}

function normalizeMovieTitle(rawTitle) {
  // Common Letterboxd RSS patterns:
  // "Hamnet, 2025" -> "Hamnet (2025)"
  // "Hamnet (2025)" stays the same
  const t = String(rawTitle || "").trim();
  if (!t) return "—";

  // If it already has "(YYYY)", keep it.
  if (/\(\d{4}\)\s*$/.test(t)) return t;

  // If it has ", YYYY" at end, convert to "(YYYY)"
  const m = t.match(/^(.*?),\s*(\d{4})\s*$/);
  if (m) return `${m[1].trim()} (${m[2]})`;

  return t;
}

function parseGoodreadsTitleAndAuthor(item) {
  // Goodreads RSS varies; try multiple places.
  // 1) dc:creator (often exists)
  // 2) title often looks like "Book Title by Author"
  const titleRaw = String(item?.title ?? "").trim();

  let author =
    String(item?.["dc:creator"] ?? item?.creator ?? item?.author_name ?? "").trim();

  let title = titleRaw;

  if (!author && titleRaw.includes(" by ")) {
    const parts = titleRaw.split(" by ");
    title = parts[0]?.trim() || titleRaw;
    author = parts.slice(1).join(" by ").trim();
  }

  if (!title) title = "—";
  if (!author) author = "—";

  return { title, author };
}

async function getLastReadLine() {
  try {
    const goodreadsRss = envAny("GOODREADS_RSS_URL", "GOODREADS_RSS");
    if (!goodreadsRss) return { text: `${LABELS.read} —`, href: LINKS.goodreadsProfile };

    const xml = await fetchText(goodreadsRss);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      // keep namespace keys like "dc:creator"
      removeNSPrefix: false,
    });

    const data = parser.parse(xml);
    const item = firstItem(data?.rss?.channel?.item);
    if (!item) return { text: `${LABELS.read} —`, href: LINKS.goodreadsProfile };

    const { title, author } = parseGoodreadsTitleAndAuthor(item);
    return { text: `${LABELS.read} ${title} — ${author}`, href: LINKS.goodreadsProfile };
  } catch (e) {
    return { text: `${LABELS.read} —`, href: LINKS.goodreadsProfile };
  }
}

async function getLastWatchedLine() {
  try {
    const letterboxdRss = envAny("LETTERBOXD_RSS", "LETTERBOXD_RSS_URL");
    if (!letterboxdRss) return { text: `${LABELS.watched} —`, href: LINKS.letterboxdProfile };

    const xml = await fetchText(letterboxdRss);

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: false,
    });

    const data = parser.parse(xml);
    const item = firstItem(data?.rss?.channel?.item);
    if (!item) return { text: `${LABELS.watched} —`, href: LINKS.letterboxdProfile };

    const movie = normalizeMovieTitle(item?.title);
    return { text: `${LABELS.watched} ${movie}`, href: LINKS.letterboxdProfile };
  } catch (e) {
    return { text: `${LABELS.watched} —`, href: LINKS.letterboxdProfile };
  }
}

async function getListeningLine() {
  try {
    const apiKey = envAny("LASTFM_API_KEY");
    const user = envAny("LASTFM_USER");
    if (!apiKey || !user) {
      return { text: `${LABELS.listeningLast} —`, href: LINKS.lastfmProfile };
    }

    const url =
      "https://ws.audioscrobbler.com/2.0/?" +
      new URLSearchParams({
        method: "user.getrecenttracks",
        user,
        api_key: apiKey,
        format: "json",
        limit: "1",
      });

    const data = await fetchJson(url);
    const track = data?.recenttracks?.track?.[0];
    if (!track) return { text: `${LABELS.listeningLast} —`, href: LINKS.lastfmProfile };

    const name = String(track?.name ?? "").trim() || "—";
    const artist = String(track?.artist?.["#text"] ?? "").trim() || "—";
    const nowPlaying = !!track?.["@attr"]?.nowplaying;

    const label = nowPlaying ? LABELS.listeningNow : LABELS.listeningLast;
    return { text: `${label} ${name} — ${artist}`, href: LINKS.lastfmProfile };
  } catch (e) {
    return { text: `${LABELS.listeningLast} —`, href: LINKS.lastfmProfile };
  }
}

function makeSvg(lines) {
  const height = STYLE.paddingY * 2 + STYLE.lineGap * lines.length;

  const textSpans = lines
    .map((line, i) => {
      const y = STYLE.paddingY + STYLE.lineGap * (i + 1);

      // clickable via <a> wrapping <text>
      return `
  <a xlink:href="${escapeXml(line.href || "")}" target="_blank">
    <text x="${STYLE.paddingX}" y="${y}"
      font-family="${escapeXml(STYLE.fontFamily)}"
      font-size="${STYLE.fontSize}"
      font-weight="${STYLE.fontWeight}"
      fill="${escapeXml(STYLE.fill)}"
      fill-opacity="${STYLE.opacity}">
      ${escapeXml(line.text)}
    </text>
  </a>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${STYLE.width}" height="${height}" viewBox="0 0 ${STYLE.width} ${height}">
  <rect width="100%" height="100%" fill="transparent"/>
${textSpans}
</svg>`;
}

(async () => {
  const [read, watched, listening] = await Promise.all([
    getLastReadLine(),
    getLastWatchedLine(),
    getListeningLine(),
  ]);

  const svg = makeSvg([read, watched, listening]);
  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
})();
