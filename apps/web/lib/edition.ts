// MUNSHI_EDITION picks the token overrides (styles/editions/*.css, keyed by <html data-edition>). Unset means meta;
// any other value is refused rather than silently falling back.
export const EDITIONS = ["meta", "paytm"] as const;
export type Edition = (typeof EDITIONS)[number];

export function readEdition(value: string | undefined = process.env.MUNSHI_EDITION): Edition {
  if (value === undefined || value === "") return "meta";
  const found = EDITIONS.find((e) => e === value);
  if (!found) throw new Error(`MUNSHI_EDITION must be one of ${EDITIONS.join(", ")}; got "${value}"`);
  return found;
}

/** The browser chrome colour, matching each edition's --ground token (styles/tokens.css, styles/editions/*.css). */
export const THEME_COLOR: Record<Edition, string> = { meta: "#f3ead7", paytm: "#f2f2ef" };
