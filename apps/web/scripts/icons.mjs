// The installable app's icons, drawn from the site's mark (components/site/Mark.tsx) in the app's ink on its ground
// (styles/tokens.css): 192 and 512 for the manifest, a maskable 512 whose mark sits inside the safe circle, and the
// 180 apple-touch icon (opaque; iOS ignores a manifest's icons). The outputs are committed; run again after the mark or
// the tokens change. Usage: node scripts/icons.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const web = path.join(import.meta.dirname, "..");
// sharp comes with next (its image optimiser); no dependency of our own.
const sharp = createRequire(createRequire(import.meta.url).resolve("next"))("sharp");

const mark = readFileSync(path.join(web, "components/site/Mark.tsx"), "utf8");
const svg = mark.slice(mark.indexOf('<svg className="s-mark-i"'), mark.indexOf("</svg>"));
const d = svg.match(/<path d="([^"]+)"/)?.[1];
const dot = svg.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/);
if (!d || !dot) throw new Error("icons: Mark.tsx no longer has the mark's path and dot");

const tokens = readFileSync(path.join(web, "styles/tokens.css"), "utf8");
const token = (name) => {
  const v = tokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`))?.[1];
  if (!v) throw new Error(`icons: --${name} is not a #rrggbb in tokens.css`);
  return v;
};
const [ground, ink] = [token("ground"), token("ink")];

// `inset`: the share of the side the mark's 20-unit box takes, centred.
const draw = (size, inset) => {
  const box = size * inset;
  const at = (size - box) / 2;
  const k = box / 20;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="${ground}"/>` +
      `<g transform="translate(${at} ${at}) scale(${k})">` +
      `<path d="${d}" fill="none" stroke="${ink}" stroke-width="1.8" stroke-linejoin="round"/>` +
      `<circle cx="${dot[1]}" cy="${dot[2]}" r="${dot[3]}" fill="${ink}"/>` +
      "</g></svg>",
  );
};

// A maskable icon's safe zone is the centre circle of 80% of the side; the mark's box at 56% stays inside it.
const OUT = [
  ["public/icons/icon-192.png", 192, 0.72],
  ["public/icons/icon-512.png", 512, 0.72],
  ["public/icons/maskable-512.png", 512, 0.56],
  ["public/icons/apple-touch-icon.png", 180, 0.66],
];
for (const [file, size, inset] of OUT) {
  writeFileSync(path.join(web, file), await sharp(draw(size, inset)).flatten({ background: ground }).png().toBuffer());
  console.log(`${file} ${size}x${size}`);
}
