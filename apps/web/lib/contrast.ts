// WCAG 2 contrast, computed from #rrggbb colours, and the text pairs the design system defines (styles/tokens.css). The
// contrast test checks every pair in every brand; a shop's brand (lib/brand.ts) is held to the same pairs.

/** The WCAG thresholds: body text 4.5:1, large text (24px, or 18.66px bold) 3:1. */
export const AA = { body: 4.5, large: 3 } as const;

/** A text token on a background token, and the size it is set at. */
export type Pair = { text: string; on: string; size: keyof typeof AA; where: string };

export const PAIRS: Pair[] = [
  { text: "--ink", on: "--ground", size: "body", where: "text on the page" },
  { text: "--ink", on: "--surface", size: "body", where: "text in a ledger card" },
  { text: "--ink", on: "--wash", size: "body", where: "a decided row, the chosen item in a list" },
  { text: "--ink-muted", on: "--ground", size: "body", where: "second lines on the page" },
  { text: "--ink-muted", on: "--surface", size: "body", where: "second lines in a card, the bar's other tabs" },
  { text: "--ink-muted", on: "--wash", size: "body", where: "a decided row's receipt line" },
  { text: "--accent-ink", on: "--accent", size: "body", where: "the header, the rail, the Approve button" },
  { text: "--accent", on: "--accent-ink", size: "body", where: "the mark and the desk's mic pill" },
  { text: "--accent", on: "--surface", size: "body", where: "an approved stamp, a link in a card" },
  { text: "--accent", on: "--ground", size: "body", where: "a link on the page" },
  { text: "--signal", on: "--surface", size: "body", where: "needs you" },
  { text: "--ok", on: "--surface", size: "body", where: "done" },
  { text: "--warn", on: "--warn-wash", size: "body", where: "Cannot verify, the simulated labels" },
  { text: "--warn", on: "--surface", size: "body", where: "a warning line in a card" },
  { text: "--danger", on: "--surface", size: "body", where: "an error in a card" },
  { text: "--danger", on: "--ground", size: "body", where: "an error on the page" },
];

/** Colour tokens that are never text nor a text background: rules, the scrim. */
export const NOT_TEXT = ["--hairline", "--scrim"];

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of #rrggbb (or #rgb). Throws on anything else: a token the test cannot read must not pass. */
export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const h = (m[1] as string).length === 3 ? [...(m[1] as string)].map((c) => c + c).join("") : (m[1] as string);
  const [r, g, b] = [0, 2, 4].map((i) => channel(Number.parseInt(h.slice(i, i + 2), 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

export function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
