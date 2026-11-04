// A decision card's actions stay inside the card at every width. jsdom measures no layout, so this reads the rules that
// guarantee it: the note field takes a whole row of the decide form, so the form must wrap, or Approve and Reject are
// pushed past the card's edge and the page scrolls sideways. A sticker never wraps, so the PayPal one must be short; the
// words that explain recorded mode sit beside it as plain text that wraps.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";
import { PAYPAL } from "../lib/i18n-paypal";
import type { Lang } from "../lib/types";

// Read from disk: vitest hands a test an empty string for any stylesheet it imports, so its red-proof is harness-level
// (the rule's text is broken here, as read).
const css = (file: string) => readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
const DRAFT_CARD_CSS = sabotageIs("web-decide-nowrap-planted") ? css("DraftCard.css").replace("flex-flow: row wrap;", "flex-flow: row nowrap;") : css("DraftCard.css");
const NOTE_CSS = css("NoteField.css");
const STICKER_CSS = css("Sticker.css");

/** Every declaration of the rules whose selector list names `selector`, at any depth (a media query's too). */
function rules(css: string, selector: string): Record<string, string>[] {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string>[] = [];
  for (const m of flat.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (m[1] as string).split(",").map((s) => s.trim());
    if (!selectors.includes(selector)) continue;
    const decl: Record<string, string> = {};
    for (const d of (m[2] as string).matchAll(/([a-z-]+)\s*:\s*([^;]+);/g)) decl[d[1] as string] = (d[2] as string).trim();
    out.push(decl);
  }
  return out;
}

const wraps = (d: Record<string, string>) => {
  const v = d["flex-wrap"] ?? d["flex-flow"] ?? "";
  return /\bwrap\b/.test(v) && !/nowrap/.test(v);
};

test("the note field takes a whole row of the decide form, and the decide form wraps its row (no width overflows)", () => {
  const note = rules(NOTE_CSS, ".decide-note");
  expect(note.some((d) => /\b100%/.test(d.flex ?? d["flex-basis"] ?? ""))).toBe(true);
  const decide = rules(DRAFT_CARD_CSS, ".decide");
  expect(decide.length).toBeGreaterThan(0);
  expect(decide[0]?.display).toBe("flex");
  // The base rule wraps, and no later rule (a wider screen's) turns the wrap off.
  expect(wraps(decide[0] as Record<string, string>)).toBe(true);
  for (const d of decide) if (d["flex-wrap"] || d["flex-flow"]) expect(wraps(d)).toBe(true);
  // Every card with a decide form puts the note field in it: the rule above is the one that holds them.
  for (const card of ["DraftCard", "PhotoDraftCard", "TrayCard"]) {
    const src = readFileSync(new URL(`../components/${card}.tsx`, import.meta.url), "utf8");
    const form = src.slice(src.indexOf('<form className="decide"'), src.indexOf("</form>", src.indexOf('<form className="decide"')));
    expect(form, card).toContain("<NoteField");
  }
});

test("the settlements sheet's buttons wrap in a row of their own, never a ledger row's two columns", () => {
  const actions = rules(css("Ops.css"), ".sheet-actions");
  expect(actions[0]?.display).toBe("flex");
  for (const d of actions) if (d["flex-wrap"] || d["flex-flow"]) expect(wraps(d)).toBe(true);
  expect(actions.some(wraps)).toBe(true);
  const read = readFileSync(new URL("../components/Settlements.tsx", import.meta.url), "utf8");
  // Harness-level red-proof, as above: the buttons back in a ledger row, as read.
  const src = sabotageIs("web-settle-actions-as-row") ? read.replace('<div className="sheet-actions">', '<div className="row">') : read;
  const form = src.slice(src.indexOf('<form className="sheet"'), src.indexOf("</form>", src.indexOf('<form className="sheet"')));
  expect(form).toContain('<div className="sheet-actions">');
  expect(form).not.toContain('className="row"');
});

test("the PayPal sticker is short in both languages, and the recorded note beside it is plain text that wraps", () => {
  const sticker = rules(STICKER_CSS, ".sticker-ink");
  expect(sticker.some((d) => d["white-space"] === "nowrap")).toBe(true); // why the sticker's words must be few
  for (const lang of ["en", "hi"] as Lang[]) {
    const p = PAYPAL[lang];
    for (const label of [p.label, p.recordedLabel]) expect(label.length, `${lang}: ${label}`).toBeLessThanOrEqual(28);
    expect(p.recordedNote.length).toBeGreaterThan(0);
  }
  for (const d of rules(STICKER_CSS, ".sticker-note")) expect(d["white-space"]).toBeUndefined();
});
