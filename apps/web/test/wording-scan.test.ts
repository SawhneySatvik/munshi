// No screen speaks of keys, fallbacks or recording modes: every string of every lib/i18n-*.ts dictionary, in both
// languages, is walked and held to the list below. "Recorded in the books" is an accounting word and stays; "Arrow keys"
// is a keyboard. What stands in for those words must still say on screen that it is a demo (simulated means labelled).
import { readdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { APP } from "../lib/i18n-app";
import { HERO } from "../lib/i18n-hero";
import { PAYPAL } from "../lib/i18n-paypal";
import { ROUTER } from "../lib/i18n-router";
import { SPEAK } from "../lib/i18n-speak";

const BANNED = [
  /(?<!arrow )\bkeys?\b/i,
  /keys? not set/i,
  /चाबी|कुंजी|keys नहीं/,
  /credential/i,
  /fall ?backs?|falls back|फ़ॉलबैक/i,
  /recorded (mode|demo|response|voice)/i,
  /recording mode|live mode\b|लाइव मोड/i,
  /· recorded|recorded, not sent|recorded: nothing/i,
  /replay/i,
  /रिकॉर्डेड/,
];

const strings = (v: unknown, at: string): [string, string][] => {
  if (typeof v === "string") return [[at, v]];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => strings(x, `${at}.${k}`));
  return [];
};

test("no dictionary string mentions keys, fallbacks or recording modes, in either language", async () => {
  const dir = path.join(import.meta.dirname, "..", "lib");
  const files = readdirSync(dir).filter((f) => /^i18n-.*\.ts$/.test(f));
  expect(files.length).toBeGreaterThan(10);
  const all: [string, string][] = [];
  for (const f of files) all.push(...strings(await import(/* @vite-ignore */ path.join(dir, f)), f));
  expect(all.length).toBeGreaterThan(1000);
  const found = all.filter(([, s]) => BANNED.some((b) => b.test(s)));
  expect(found).toEqual([]);
});

test("the words that replaced them still say on screen that this is a demo, in both languages", () => {
  for (const lang of ["en", "hi"] as const) {
    const p = PAYPAL[lang];
    const a = APP[lang];
    const h = HERO[lang];
    const said = [
      p.recordedLabel,
      p.recordedNote,
      p.sentRecorded,
      p.paidRecorded,
      p.msg_drafted_recorded,
      p.trayNoteRecorded,
      a.inboxRecorded,
      a.channelRecorded,
      a.channelNotConnectedDemo,
      h.recordedMode,
      h.recordedNote,
      h.recordedResponse,
      SPEAK[lang].recorded,
      ROUTER[lang].spendRecorded,
    ];
    for (const s of said) expect(s, lang).toMatch(/demo|डेमो/i);
  }
  for (const lang of ["en", "hi"] as const) expect(PAYPAL[lang].recordedLabel, lang).toContain("PayPal sandbox");
});
