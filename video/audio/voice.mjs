// The narration, one WAV per line of the clock, spoken by the local Kokoro-82M voice through `hyperframes tts` (the same
// voice approach as the Munim launch film: Kokoro on this machine, no service, no key). kokoro-onnx lives in this
// project's git-ignored .venv: uv venv .venv && uv pip install --python .venv/bin/python kokoro-onnx soundfile.
// Prints each line's length against its window and exits non-zero when a line overruns it.
// Usage: node audio/voice.mjs [--ids 2.1,2.2] [--voice bf_emma] [--speed 1]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { hyperframes } from "../tools/hf.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const m = /^--(ids|voice|speed)(?:=(.*))?$/.exec(argv[i]);
  if (!m) throw new Error(`unknown argument ${argv[i]} (known: --ids --voice --speed)`);
  args[m[1]] = m[2] ?? argv[++i];
}
await import("../assets/js/clock.js");
const C = globalThis.CLOCK;
const voice = args.voice ?? C.voice;
const speed = Number(args.speed ?? 1);
if (!(speed >= 0.7 && speed <= 1.3)) throw new Error(`--speed ${args.speed} is out of range`);
const want = args.ids ? args.ids.split(",") : null;
const python = join(ROOT, ".venv/bin/python");
if (!existsSync(python)) throw new Error("no .venv: uv venv .venv && uv pip install --python .venv/bin/python kokoro-onnx soundfile");

const out = join(ROOT, "assets/voice");
mkdirSync(out, { recursive: true });
let over = 0;
for (const [i, [id, , , text]] of C.lines.entries()) {
  if (want && !want.includes(id)) continue;
  const file = join(out, `${id}.wav`);
  hyperframes(["tts", text, "--voice", voice, "--speed", String(speed), "--output", file], { HYPERFRAMES_PYTHON: python });
  const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());
  const win = C.windowOf(i);
  if (dur > win - 0.15) over++;
  console.log(`${id}\t${dur.toFixed(2)} s\twindow ${win.toFixed(2)} s\t${dur > win - 0.15 ? "OVERRUNS its window" : "fits"}`);
}
if (over) {
  console.error(`${over} line(s) overrun their windows`);
  process.exitCode = 1;
}
