// The contrast gate (BLUEPRINT §9.1): every text/background token pair the design system defines (lib/contrast.ts PAIRS)
// meets WCAG AA (4.5:1 body, 3:1 large) in every brand: the base look (styles/tokens.css) and each edition's override
// (styles/editions/*.css), computed here from the token values as the files declare them. Every colour token is either
// in a pair or named as never-text, so a new colour cannot slip in unchecked.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BASE_COLOURS } from "../lib/brand";
import { AA, NOT_TEXT, PAIRS, ratio } from "../lib/contrast";
import { EDITIONS, THEME_COLOR } from "../lib/edition";

const STYLES = new URL("../styles/", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, STYLES), "utf8");

/** The custom properties declared directly in the top-level rule whose selector is exactly `selector`. */
function declared(css: string, selector: string): Record<string, string> {
  const flat = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  let depth = 0;
  let start = 0;
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i];
    if (ch === "{") {
      if (depth === 0) {
        const sel = flat.slice(start, i).trim();
        const end = flat.indexOf("}", i);
        if (sel === selector) for (const m of flat.slice(i + 1, end).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1] as string] = (m[2] as string).trim();
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    }
  }
  return out;
}

/** A token's colour, following var() to the token it names. */
function colour(tokens: Record<string, string>, name: string, seen: string[] = []): string {
  const v = tokens[name];
  if (v === undefined) throw new Error(`${name} is not defined`);
  const alias = /^var\((--[a-z0-9-]+)\)$/.exec(v);
  if (!alias) return v;
  if (seen.includes(name)) throw new Error(`${name}: var() loop`);
  return colour(tokens, alias[1] as string, [...seen, name]);
}

const isColour = (v: string) => /^(#|rgb|hsl|color-mix|oklch)/.test(v);

const base = declared(read("tokens.css"), ":root");
const editions = readdirSync(new URL("editions/", STYLES)).filter((f) => f.endsWith(".css"));
const BRANDS: Array<[string, Record<string, string>]> = [
  ["base (meta)", base],
  ...editions.map((f): [string, Record<string, string>] => {
    const name = f.replace(/\.css$/, "");
    return [name, { ...base, ...declared(read(`editions/${f}`), `:root[data-edition="${name}"]`) }];
  }),
];

describe("the token files", () => {
  test("the base declares the system's colours, and every edition file overrides some of them", () => {
    expect(Object.keys(base).filter((k) => isColour(base[k] as string)).length).toBeGreaterThan(8);
    expect(editions).toEqual(EDITIONS.filter((e) => e !== "meta").map((e) => `${e}.css`));
    for (const [name, tokens] of BRANDS.slice(1)) expect(Object.keys(tokens).length, name).toBeGreaterThan(0);
  });

  test("every colour token is in a text pair or named as never text (nothing unchecked)", () => {
    const paired = new Set(PAIRS.flatMap((p) => [p.text, p.on]));
    for (const [name, tokens] of BRANDS) {
      const colours = Object.keys(tokens).filter((k) => isColour(tokens[k] as string));
      expect(
        colours.filter((k) => !paired.has(k) && !NOT_TEXT.includes(k)),
        name,
      ).toEqual([]);
    }
  });

  test("lib/brand.ts's base colours are the ones tokens.css declares, and the browser chrome is each edition's ground", () => {
    const fromCss = Object.fromEntries(Object.keys(BASE_COLOURS).map((k) => [k, colour(base, k)]));
    expect(fromCss).toEqual(BASE_COLOURS);
    for (const [name, tokens] of BRANDS) {
      const edition = name.startsWith("base") ? "meta" : name;
      expect(THEME_COLOR[edition as keyof typeof THEME_COLOR], name).toBe(colour(tokens, "--ground"));
    }
  });
});

describe.each(BRANDS)("WCAG AA in the %s brand", (_name, tokens) => {
  test.each(PAIRS.map((p) => [`${p.text} on ${p.on} (${p.where})`, p] as const))("%s", (_label, p) => {
    const r = ratio(colour(tokens, p.text), colour(tokens, p.on));
    expect(r, `${p.text} ${colour(tokens, p.text)} on ${p.on} ${colour(tokens, p.on)}: ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA[p.size]);
  });
});

describe("the contrast arithmetic", () => {
  test("black on white is 21:1, a colour on itself 1:1, and a value the test cannot read throws", () => {
    expect(ratio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(ratio("#1f5641", "#1f5641")).toBe(1);
    expect(ratio("#777", "#ffffff")).toBeCloseTo(4.48, 2);
    expect(() => ratio("color-mix(in srgb, red, blue)", "#ffffff")).toThrow(/not a #rrggbb/);
  });
});
