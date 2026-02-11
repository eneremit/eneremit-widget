/* eneremit-widget: generate-svg.cjs
   - 3 lines:
     Last Read: Book — Author
     Last Watched: Movie (YEAR)
     Now Listening To / Last Listened To: Track — Artist
*/

const fs = require("fs");
const { XMLParser } = require("fast-xml-parser");

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER = process.env.LASTFM_USER;

const LETTERBOXD_RSS = process.env.LETTERBOXD_RSS; // full URL
const GOODREADS_RSS = process.env.GOODREADS_RSS;   // full URL (list_rss + key + shelf=read)

function esc(s) {
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

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "eneremit-widget/1.0 (+github-actions)",
      ...opts.headers,
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "eneremit-widget/1.0 (+github-actions)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.json();
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true, // turns letterboxd:filmTitle into filmTitle, etc.
  processEntities: true,
});

function normalizeItems(parsed) {
  // RSS: rss.channel.item
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems) return Array.isArray(rssItems) ? rssItems : [rssItems];

  // Atom: feed.entry (just in case)
  const atomItems = parsed?.feed?.entry;
  if (atomItems) return Array.isArray(atomItems) ? atomItems : [atomItems];

  return [];
}

function extractYearAndFormatMovie(rawTitle) {
  // Examples:
  // "Hamnet, 2025" => "Hamnet (2025)"
  // "Hamnet (2025)" => keep
  // "Hamnet — 2025" => "Hamnet (2025)"
  const t = cleanText(rawTitle);

  // Already "(YYYY)"
  const already = t.match(/^(.*)\s*\((\d{4})\)\s*$/);
  if (already) return `${cleanText(already[1])} (${already[2]})`;

  // Ends with ", YYYY" or "— YYYY" or " - YYYY"
  const m = t.match(/^(.*?)[,\s–—-]+(\d{4})\s*$/);
  if (m) return `${cleanText(m[1].replace(/[,\s]+$/g, ""))} (${m[2]})`;

  return t;
}

function extractGoodreadsTitleAuthor(item) {
  // Goodreads RSS item.title is often: "Book Title by Author"
  const titleRaw = cleanText(item?.title);

  if (titleRaw.includes(" by ")) {
    const [bookTitle, author] = titleRaw.split(" by ");
    return {
      bookTitle: cleanText(bookTitle),
      author: cleanText(author),
    };
  }

  // Fallback: parse author from description HTML if present.
  const desc = String(item?.description ?? "");
  // common patterns: "...by <a ...>Author</a>" or "Author: <a ...>Name</a>"
  const byLink = desc.match(/by\s*<a[^>]*>([^<]+)<\/a>/i);
  const authorLink = desc.match(/Author:\s*<a[^>]*>([^<]+)<\/a>/i);

  const author = cleanText((byLink?.[1] || authorLink?.[1] || ""));

  return {
    bookTitle: titleRaw || "—",
    author: author || "—",
  };
}

async function getLastListened() {
  if (!LASTFM_API_KEY || !LASTFM_USER) return { label: "Last Listened To", text: "—", url: "https://www.last.fm/user/" + (LASTFM_USER || "") };

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
  const track = data?.recenttracks?.track?.[0];

  if (!track) {
    return { label: "Last Listened To", text: "—", url: "https://www.last.fm/user/" + LASTFM_USER };
  }

  const isNowPlaying = !!track?.["@attr"]?.nowplaying;
  const label = isNowPlaying ? "Now Listening To" : "Last Listened To";

  const name = cleanText(track?.name) || "—";
  const artist = cleanText(track?.artist?.["#text"]) || "—";
  const text = `${name} — ${artist}`;

  const trackUrl = cleanText(track?.url) || `https://www.last.fm/user/${LASTFM_USER}`;

  return { label, text, url: trackUrl };
}

async function getLastWatched() {
  if (!LETTERBOXD_RSS) return { label: "Last Watched", text: "—", url: "https://letterboxd.com/" };

  const xml = await fetchText(LETTERBOXD_RSS);
  const parsed = xmlParser.parse(xml);
  const items = normalizeItems(parsed);
  const first = items[0];
  if (!first) return { label: "Last Watched", text: "—", url: "https://letterboxd.com/" };

  const rawTitle = cleanText(first?.title) || "—";
  const movie = extractYearAndFormatMovie(rawTitle);

  // Link formats vary between RSS/Atom; handle both
  const link =
    cleanText(first?.link?.href) ||
    cleanText(first?.link) ||
    "https://letterboxd.com/";

  return { label: "Last Watched", text: movie, url: link };
}

async function getLastRead() {
  if (!GOODREADS_RSS) return { label: "Last Read", text: "—", url: "https://www.goodreads.com/" };

  const xml = await fetchText(GOODREADS_RSS);
  const parsed = xmlParser.parse(xml);
  const items = normalizeItems(parsed);
  const first = items[0];
  if (!first) return { label: "Last Read", text: "—", url: "https://www.goodreads.com/" };

  const { bookTitle, author } = extractGoodreadsTitleAuthor(first);
  const text = `${bookTitle} — ${author}`;

  const link = cleanText(first?.link?.href) || cleanText(first?.link) || "https://www.goodreads.com/";

  return { label: "Last Read", text, url: link };
}

function renderSVG(lines) {
  // Match your vibe: Times New Roman, tight spacing, muted brown.
  const W = 720;
  const H = 120;

  const fontFamily = "Times New Roman, Times, serif";
  const fontSize = 18;
  const lineHeight = 30;

  const labelColor = "#000000";
  const valueColor = "#613d12";
  const bg = "transparent";

  // Start positions
  const x = 18;
  let y = 36;

  const lineSvgs = lines
    .map((ln) => {
      const label = esc(ln.label + ":");
      const value = esc(ln.text);

      // Make the *whole line* clickable without messing layouts.
      const group = `
        <a xlink:href="${esc(ln.url || "#")}" target="_blank" rel="noopener noreferrer">
          <text x="${x}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" fill="${labelColor}" opacity="0.85">${label}</text>
          <text x="${x + 150}" y="${y}" font-family="${fontFamily}" font-size="${fontSize}" fill="${valueColor}" opacity="0.95">${value}</text>
        </a>
      `;

      y += lineHeight;
      return group;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="100%" height="100%" fill="${bg}" />
  ${lineSvgs}
</svg>`;
}

(async function main() {
  try {
    const [read, watched, listened] = await Promise.allSettled([
      getLastRead(),
      getLastWatched(),
      getLastListened(),
    ]);

    const safe = (r, fallback) => (r.status === "fulfilled" ? r.value : fallback);

    const lines = [
      safe(read, { label: "Last Read", text: "—", url: "https://www.goodreads.com/" }),
      safe(watched, { label: "Last Watched", text: "—", url: "https://letterboxd.com/" }),
      safe(listened, { label: "Last Listened To", text: "—", url: `https://www.last.fm/user/${LASTFM_USER || ""}` }),
    ];

    const svg = renderSVG(lines);
    fs.writeFileSync("now-playing.svg", svg, "utf8");
    console.log("Wrote now-playing.svg");
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
