// The render gate: a film file is under the Meta limit (3:00) and in the film's format. Exits non-zero on any miss.
// Usage: node tools/check-duration.mjs renders/<file>.mp4 [--max 180]
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const m = /^--max(?:=(.+))?$/.exec(argv.find((a) => a.startsWith("--max")) ?? "");
const max = m ? Number(m[1] ?? argv[argv.indexOf("--max") + 1]) : 180;
if (!file) throw new Error("usage: node tools/check-duration.mjs <file.mp4> [--max 180]");
const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", file]).toString());
const video = probe.streams.find((s) => s.codec_type === "video");
const audio = probe.streams.find((s) => s.codec_type === "audio");
const seconds = Number(probe.format.duration);
const misses = [
  seconds < max ? "" : `${seconds.toFixed(2)} s is not under ${max} s`,
  video && video.width === 1920 && video.height === 1080 ? "" : `picture ${video?.width}x${video?.height}, not 1920x1080`,
  video?.r_frame_rate === "30/1" ? "" : `frame rate ${video?.r_frame_rate}, not 30/1`,
  audio?.codec_name === "aac" ? "" : `audio ${audio?.codec_name ?? "missing"}, not AAC`,
].filter(Boolean);
const mmss = `${Math.floor(seconds / 60)}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
console.log(`${file}: ${seconds.toFixed(2)} s (${mmss}) · ${video?.width}x${video?.height} · ${video?.r_frame_rate} fps · ${audio?.codec_name ?? "no audio"}: ${misses.length ? `FAIL (${misses.join("; ")})` : "pass"}`);
if (misses.length) process.exitCode = 1;
