// generate-svg.js
// Creates/updates now-playing.svg in the repo root.
// Uses LASTFM_API_KEY + LASTFM_USER from GitHub Actions secrets.

import fs from "node:fs";

const LASTFM_API_KEY = process.env.LASTFM_API_KEY;
const LASTFM_USER = process.env.LASTFM_USER;

// --- theme-ish styling (we can fine-tune later to match Tumblr exactly)
const STYLE = {
  width: 300,
  padding: 14,
  bg: "#ffffff",
  border: "#ededed",
  titleColor: "#613d12",
  textColor: "#000000",
  muted: "#666666",
  font: "Times New Roman, Times, serif",
  titleSize: 13,
  textSize: 11,
  // approximate your glenplayer vibe
  titleLetterSpacing: "0.3px",
  textLetterSpacing: "0.2px"
};

function escapeXml(s = "") {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function qs(params) {
  const u = new URLSearchParams(params);
  return u.toString();
}

async function lastfm(method, params = {}) {
  if (!LASTFM_API_KEY || !LASTFM_USER) {
    throw new Error("Missing LASTFM_API_KEY or LASTFM_USER env vars.");
  }

  const url =
    "https://ws.audioscrobbler.com/2.0/?" +
    qs({
      method,
      api_key: LASTFM_API_KEY,
      format: "json",
      ...params
    });

  const res = await fetch(url, { headers: { "User-Agent": "eneremit-widget/1.0" } });
  if (!res.ok) throw new Error(`Last.fm request failed: ${res.status}`);
  const data = await res.json();

  // Last.fm sometimes returns { error, message }
  if (data?.error) throw new Error(`Last.fm error: ${data.message || data.error}`);
  return data;
}

function pickImage(images, preferredSize = "medium") {
  // images is an array like [{#text, size}, ...]
  if (!Array.isArray(images)) return "";
  const match = images.find((im) => im?.size === preferredSize)?.["#text"];
  return match || images.at(-1)?.["#text"] || "";
}

function buildSvg({ nowPlaying, topTracks }) {
  const { width, padding } = STYLE;

  // Layout: header + 1 now playing row + 3 top tracks
  const rowH = 52;
  const headerH = 26;
  const sectionGap = 10;

  const rowsCount = 1 + (topTracks?.length || 0);
  const height = padding * 2 + headerH + sectionGap + rowsCount * rowH;

  const title = nowPlaying?.isNowPlaying ? "Now Playing" : "Last Played";
  const npLine = nowPlaying?.track
    ? `${nowPlaying.track} — ${nowPlaying.artist}`
    : "No recent track found.";

  const npCover = nowPlaying?.image || "";

  // Build rows for top tracks
  const topRows = (topTracks || [])
    .slice(0, 3)
    .map((t, idx) => {
      const y = padding + headerH + sectionGap + rowH * (1 + idx);
      const cover = t.image || "";
      const line = `${t.track} — ${t.artist}`;
      return `
        <g transform="translate(${padding}, ${y})">
          <rect x="0" y="0" width="${rowH - 6}" height="${rowH - 6}" rx="8" fill="${escapeXml(STYLE.border)}" opacity="0.35"/>
          ${
            cover
              ? `<image href="${escapeXml(cover)}" x="0" y="0" width="${rowH - 6}" height="${rowH - 6}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip)"/>`
              : ""
          }
          <text x="${rowH + 4}" y="22" font-family="${escapeXml(STYLE.font)}" font-size="${STYLE.textSize}" fill="${escapeXml(STYLE.textColor)}" letter-spacing="${STYLE.textLetterSpacing}">
            ${escapeXml(line)}
          </text>
          <text x="${rowH + 4}" y="40" font-family="${escapeXml(STYLE.font)}" font-size="${STYLE.textSize}" fill="${escapeXml(STYLE.muted)}" opacity="0.85">
            Top track this week
          </text>
        </g>
      `;
    })
    .join("");

  // Now playing row
  const npY = padding + headerH + sectionGap;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <clipPath id="clip">
      <rect x="0" y="0" width="${rowH - 6}" height="${rowH - 6}" rx="8"/>
    </clipPath>
  </defs>

  <rect x="0" y="0" width="${width}" height="${height}" rx="16" fill="${escapeXml(STYLE.bg)}"/>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="16" fill="none" stroke="${escapeXml(STYLE.border)}"/>

  <text x="${padding}" y="${padding + 16}"
        font-family="${escapeXml(STYLE.font)}"
        font-size="${STYLE.titleSize}"
        fill="${escapeXml(STYLE.titleColor)}"
        letter-spacing="${STYLE.titleLetterSpacing}">
    ${escapeXml(title)}
  </text>

  <g transform="translate(${padding}, ${npY})">
    <rect x="0" y="0" width="${rowH - 6}" height="${rowH - 6}" rx="8" fill="${escapeXml(STYLE.border)}" opacity="0.35"/>
    ${
      npCover
        ? `<image href="${escapeXml(npCover)}" x="0" y="0" width="${rowH - 6}" height="${rowH - 6}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip)"/>`
        : ""
    }
    <text x="${rowH + 4}" y="22"
          font-family="${escapeXml(STYLE.font)}"
          font-size="${STYLE.textSize}"
          fill="${escapeXml(STYLE.textColor)}"
          letter-spacing="${STYLE.textLetterSpacing}">
      ${escapeXml(npLine)}
    </text>
    <text x="${rowH + 4}" y="40"
          font-family="${escapeXml(STYLE.font)}"
          font-size="${STYLE.textSize}"
          fill="${escapeXml(STYLE.muted)}"
          opacity="0.85">
      ${escapeXml(nowPlaying?.isNowPlaying ? "Live from Last.fm" : "Most recent scrobble")}
    </text>
  </g>

  ${topRows}
</svg>
`;

  return svg;
}

async function main() {
  // Defaults so we ALWAYS output valid SVG even on failure.
  let nowPlaying = {
    isNowPlaying: false,
    track: "",
    artist: "",
    image: ""
  };
  let topTracks = [];

  try {
    const recent = await lastfm("user.getrecenttracks", {
      user: LASTFM_USER,
      limit: "1"
    });

    const item = recent?.recenttracks?.track?.[0];
    if (item) {
      const isNP = Boolean(item?.["@attr"]?.nowplaying);
      nowPlaying.isNowPlaying = isNP;
      nowPlaying.track = item?.name || "";
      nowPlaying.artist = item?.artist?.["#text"] || item?.artist?.name || "";
      nowPlaying.image = pickImage(item?.image, "medium");
    }

    const top = await lastfm("user.gettoptracks", {
      user: LASTFM_USER,
      limit: "3",
      period: "7day"
    });

    const arr = top?.toptracks?.track || [];
    topTracks = arr.slice(0, 3).map((t) => ({
      track: t?.name || "",
      artist: t?.artist?.name || "",
      image: pickImage(t?.image, "medium")
    }));
  } catch (err) {
    console.error("Build error:", err?.message || err);
    // Keep going: we will still output an SVG with fallback text.
    nowPlaying = { isNowPlaying: false, track: "Widget error", artist: "Check Actions logs", image: "" };
    topTracks = [];
  }

  const svg = buildSvg({ nowPlaying, topTracks });
  fs.writeFileSync("now-playing.svg", svg, "utf8");
  console.log("Wrote now-playing.svg");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
