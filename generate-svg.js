const fs = require("fs");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="420" height="100">
  <style>
    text {
      font-family: Times New Roman, Times, serif;
      font-size: 13px;
      letter-spacing: 0.3px;
      fill: #613d12;
    }
  </style>

  <text x="0" y="22">Last Read: Placeholder Book — Placeholder Author</text>
  <text x="0" y="52">Last Watched: Placeholder Movie (2024)</text>
  <text x="0" y="82">Last Listened To: Placeholder Track — Placeholder Artist</text>
</svg>
`;

fs.writeFileSync("now-playing.svg", svg);
console.log("Wrote now-playing.svg");
