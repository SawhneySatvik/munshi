// A shop's brand on the shell (lib/brand.ts, BLUEPRINT §9.1): the colour tokens of its look, held to the same shape as
// ops.look_check and to the system's text pairs. A look that fails either is not applied at all.
import { describe, expect, test } from "vitest";
import { brandStyle } from "../lib/brand";

describe("brandStyle", () => {
  test("a look's accent (and its ink) becomes the shell's style; space, radius and type names stay the system's", () => {
    expect(brandStyle({ "--accent": "#5b2a86", "--accent-ink": "#ffffff", "--radius-card": "2px", "--font-text": "Inter" })).toEqual({
      "--accent": "#5b2a86",
      "--accent-ink": "#ffffff",
    });
  });

  test("a look with a light and a dark set themes the app from its light set", () => {
    expect(brandStyle({ light: { "--accent": "#7a3b12" }, dark: { "--accent": "#f0c9a6" } })).toEqual({ "--accent": "#7a3b12" });
  });

  test("an accent its text cannot be read on (under 4.5:1) leaves the system's look", () => {
    expect(brandStyle({ "--accent": "#e8d9a8" })).toBeNull();
    expect(brandStyle({ "--accent": "#e8d9a8", "--accent-ink": "#ffffff" })).toBeNull();
    // Paper the ink cannot be read on fails the same way.
    expect(brandStyle({ "--ground": "#2b2b2b" })).toBeNull();
  });

  test("anything but #rrggbb in a colour is refused whole: no CSS reaches the style attribute", () => {
    expect(brandStyle({ "--accent": "red" })).toBeNull();
    expect(brandStyle({ "--accent": "#5b2a86; background: url(x)" })).toBeNull();
    expect(brandStyle({ "--accent": "#5B2A86" })).toBeNull();
  });

  test("no look, an empty look or one that is not an object is the system's look", () => {
    for (const t of [null, undefined, {}, [], "x", 3, { light: "x" }, { "--space-1": "4px" }]) expect(brandStyle(t)).toBeNull();
  });
});
