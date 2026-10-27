// Downloads the app's three faces (SIL Open Font License, Google Fonts) into assets/fonts and writes assets/css/fonts.css,
// so a render never fetches a font. Latin and Latin Extended subsets only: the film's own words are English.
// Usage: node tools/fonts.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAMILIES = ["Bricolage+Grotesque:opsz,wght@12..96,400..800", "Atkinson+Hyperlegible:wght@400;700", "IBM+Plex+Mono:wght@400;600"];
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
mkdirSync(join(ROOT, "assets/fonts"), { recursive: true });
let css = "/* Written by tools/fonts.mjs from Google Fonts (SIL Open Font License 1.1). */\n";
for (const fam of FAMILIES) {
  const sheet = await fetch(`https://fonts.googleapis.com/css2?family=${fam}&display=block`, { headers: { "user-agent": UA } }).then((r) => r.text());
  for (const [, subset, block] of sheet.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face \{[^}]+\})/g)) {
    if (subset !== "latin" && subset !== "latin-ext") continue;
    const family = /font-family: '([^']+)'/.exec(block)[1];
    const weight = /font-weight: ([\d ]+);/.exec(block)[1].trim();
    const url = /url\((https:[^)]+\.woff2)\)/.exec(block)[1];
    const file = `${family.replace(/ /g, "")}-${weight.replace(" ", "-")}-${subset}.woff2`;
    writeFileSync(join(ROOT, "assets/fonts", file), Buffer.from(await fetch(url).then((r) => r.arrayBuffer())));
    css += block.replace(url, `../fonts/${file}`) + "\n";
    console.log(file);
  }
}
writeFileSync(join(ROOT, "assets/css/fonts.css"), css);
