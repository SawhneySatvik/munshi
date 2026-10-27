// The narration track: every recorded line (assets/voice/<id>.wav) placed at its clock time on one 175 s track, then
// one gain step to -14 LUFS integrated with a limiter at -2 dBFS (see below).
// Draft 1 has no music and no effects. Usage: node audio/mix.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
await import("../assets/js/clock.js");
const C = globalThis.CLOCK;
const out = join(ROOT, "assets/audio/narration.wav");
const pre = join(ROOT, "assets/audio/narration.premix.wav");
mkdirSync(dirname(out), { recursive: true });

const inputs = [];
const parts = [];
C.lines.forEach(([id, at], i) => {
  const f = join(ROOT, "assets/voice", `${id}.wav`);
  if (!existsSync(f)) throw new Error(`no recording for line ${id}: run node audio/voice.mjs`);
  inputs.push("-i", f);
  const ms = Math.round(at * 1000);
  parts.push(`[${i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${ms}|${ms}[v${i}]`);
});
const n = C.lines.length;
const graph = `${parts.join(";")};${C.lines.map((_, i) => `[v${i}]`).join("")}amix=inputs=${n}:normalize=0:dropout_transition=0,apad=whole_dur=${C.duration},atrim=0:${C.duration}[mix]`;
execFileSync("ffmpeg", ["-v", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[mix]", "-ar", "48000", "-c:a", "pcm_s16le", pre]);

// Loudness in one gain step: measure the placed track (EBU R128), move it to -14 LUFS, and let a limiter hold the
// sample peaks at -2 dBFS, so true peak stays near -1.5 dBTP after the AAC encode.
const TARGET_LUFS = -14;
const CEILING_DB = -2;
function loudness(file) {
  const log = spawnSync("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-filter:a", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const summary = log.split("Summary:").pop();
  const read = (label) => Number(new RegExp(`${label}\\s+(-?[\\d.]+)`).exec(summary)[1]);
  return { lufs: read("I:"), peak: read("Peak:") };
}
const gainDb = TARGET_LUFS - loudness(pre).lufs;
const ceiling = Math.pow(10, CEILING_DB / 20).toFixed(4);
execFileSync("ffmpeg", ["-v", "error", "-y", "-i", pre, "-af", `volume=${gainDb.toFixed(2)}dB,alimiter=limit=${ceiling}:attack=1:release=50:level=0`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out]);
unlinkSync(pre);
const result = loudness(out);
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out]).toString());
console.log(`assets/audio/narration.wav: ${dur.toFixed(2)} s, ${n} lines, ${result.lufs} LUFS, true peak ${result.peak} dBFS (gain ${gainDb.toFixed(2)} dB)`);
