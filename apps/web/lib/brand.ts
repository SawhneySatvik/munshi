// A shop's brand in the app: the colour tokens of its latest ops.site_look, set on the shell so every
// screen under it themes from them. The look's shape is held by the database (ops.look_check: the fixed names, colours
// #rrggbb); this holds it again, because the value reaches a style attribute, and holds the result to the system's text
// pairs: a look that would put any pair under WCAG AA is not applied (the system's look stays), never half-applied.
//
// The seam: the app has no read of ops.site_look yet (core's views do not return it), so app/app/layout.tsx passes
// null. When a core view returns the latest look's `tokens`, the layout passes them here.
import type { CSSProperties } from "react";
import { AA, PAIRS, ratio } from "./contrast";

/** The base colours of styles/tokens.css (the contrast test holds the two equal). */
export const BASE_COLOURS: Record<string, string> = {
  "--ground": "#f3ead7",
  "--surface": "#fbf6ea",
  "--wash": "#e9dfca",
  "--ink": "#1b1611",
  "--ink-muted": "#5b4d40",
  "--hairline": "#d9ccb2",
  "--accent": "#ff7f61",
  "--accent-ink": "#1c0f0b",
  "--signal": "#a63a1f",
  "--ok": "#2f6a43",
  "--warn": "#7a4e0e",
  "--warn-wash": "#f5e1b8",
  "--danger": "#a12a22",
  "--shell": "#151312",
  "--shell-surface": "#1d1a18",
  "--shell-text": "#f2ece6",
  "--shell-muted": "#a69c93",
};

/** The colour names a look may set (ops.look_check's list); its other names (space, radius, type) stay the system's. */
export const LOOK_COLOURS = ["--ground", "--surface", "--ink", "--ink-muted", "--hairline", "--accent", "--accent-ink", "--signal", "--ok", "--warn", "--danger"];

const HEX = /^#[0-9a-f]{6}$/;

/** The style the shell carries for a look's tokens, or null for the system's look (no look, a bad shape, or a pair
 *  under AA). A look with a light and a dark set themes from its light set: the app has no dark mode yet. */
export function brandStyle(tokens: unknown): CSSProperties | null {
  if (!tokens || typeof tokens !== "object" || Array.isArray(tokens)) return null;
  const set: unknown = "light" in tokens || "dark" in tokens ? (tokens as Record<string, unknown>).light : tokens;
  if (!set || typeof set !== "object" || Array.isArray(set)) return null;
  const style: Record<string, string> = {};
  for (const [name, value] of Object.entries(set)) {
    if (!LOOK_COLOURS.includes(name)) continue;
    if (typeof value !== "string" || !HEX.test(value)) return null;
    style[name] = value;
  }
  if (Object.keys(style).length === 0) return null;
  const colours = { ...BASE_COLOURS, ...style };
  for (const p of PAIRS) if (ratio(colours[p.text] as string, colours[p.on] as string) < AA[p.size]) return null;
  return style as CSSProperties;
}
