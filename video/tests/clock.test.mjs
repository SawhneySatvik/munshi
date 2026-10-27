// The clock holds together: eleven contiguous beat windows from 0 to the film's end, under 3:00; every narration line
// inside a beat and in order; every recorded line shorter than its window; the root's and each host's timing match it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
await import("../assets/js/clock.js");
const C = globalThis.CLOCK;

test("the beats are contiguous, start at 0 and end under 180 s", () => {
  assert.equal(C.beats.length, 11);
  assert.equal(C.beats[0][1], 0);
  for (let i = 1; i < C.beats.length; i++) assert.equal(C.beats[i][1], C.beats[i - 1][2], `gap before ${C.beats[i][0]}`);
  assert.equal(C.duration, C.beats.at(-1)[2]);
  assert.ok(C.duration < 180, `${C.duration} s is not under 180 s`);
});

test("every line sits inside a beat, in order, and its recording fits its window", () => {
  let last = -1;
  for (const [i, [id, at]] of C.lines.entries()) {
    assert.ok(at > last, `line ${id} is out of order`);
    last = at;
    assert.ok(C.beats.some(([, a, b]) => at >= a && at < b), `line ${id} at ${at} s is in no beat`);
    const wav = join(ROOT, "assets/voice", `${id}.wav`);
    assert.ok(existsSync(wav), `no recording for line ${id}`);
    const said = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", wav]).toString());
    assert.ok(said < C.windowOf(i), `line ${id} runs ${said.toFixed(2)} s in a ${C.windowOf(i).toFixed(2)} s window`);
  }
});

test("index.html mounts each beat at its clock window, and the root lasts the film", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const root = /data-composition-id="main"[^>]*data-duration="([\d.]+)"/.exec(html);
  assert.equal(Number(root[1]), C.duration);
  for (const [id, a, b] of C.beats) {
    const host = new RegExp(`<div id="${id}"[^>]*data-start="([\\d.]+)" data-duration="([\\d.]+)"`).exec(html);
    assert.ok(host, `no host for ${id}`);
    assert.equal(Number(host[1]), a, `${id} starts at ${host[1]}, the clock says ${a}`);
    assert.equal(Number(host[2]), b - a, `${id} lasts ${host[2]}, the clock says ${b - a}`);
  }
});
