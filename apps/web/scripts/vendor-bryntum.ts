// Copies Bryntum Scheduler's prebuilt browser build from its npm package into public/vendor/bryntum, where the schedule
// board loads it as a plain script (components/schedule/BryntumBoard.tsx). The bundler never reads it: the trial build
// is one 4.6 MB obfuscated file that Turbopack cannot process within a build's memory. The copy is ignored by git, so
// nothing of Bryntum's is committed; `next build` and `pnpm dev` run this first.
// Run: node scripts/vendor-bryntum.ts
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const from = fileURLToPath(new URL("../node_modules/@bryntum/scheduler/", import.meta.url));
const to = fileURLToPath(new URL("../public/vendor/bryntum/", import.meta.url));
const FILES = ["scheduler.umd.js", "scheduler.css", "stockholm-light.css", "fontawesome", "fonts"];

if (!existsSync(`${from}scheduler.umd.js`)) {
  console.error("vendor-bryntum: @bryntum/scheduler is not installed; run pnpm install");
  process.exit(1);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const name of FILES) cpSync(`${from}${name}`, `${to}${name}`, { recursive: true });
console.log(`vendor-bryntum: ${FILES.length} entries copied to public/vendor/bryntum`);
