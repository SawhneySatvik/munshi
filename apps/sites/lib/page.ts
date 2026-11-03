import business from "@business";
import { notFound } from "next/navigation";
import type { Lang } from "./business.ts";
import { isLang, ui } from "./i18n.ts";
import { live } from "./variant.ts";

export async function langOf(params: Promise<{ lang: string }>): Promise<Lang> {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return lang;
}

/** A line of the business's copy in the page's language ("" when the profile has none). */
export const copy = (key: string, lang: Lang): string => business.profile.copy[key]?.[lang] ?? "";

/** A category's label from the profile, or the API's own code when the profile does not name it. */
export const categoryLabel = (code: string | null, lang: Lang): string => (code ? (business.profile.categories[code]?.label[lang] ?? code) : "");

/** The line under the wordmark; a copy built as a sample (lib/variant.ts) adds "· sample site". */
export const wordmarkSub = (lang: Lang): string => {
  const sub = business.profile.wordmark.sub[lang];
  return live ? sub : `${sub} · ${ui.sampleSite[lang]}`;
};

/**
 * The catalogue's pieces are plain goods named "Piece, Colour[, Size] (sample)" (no variant grid yet), so the
 * site groups them by the name before the colour (a name the profile's swatches know): one product page per group, its
 * colours and sizes as choices. A name with no known colour is its own product.
 */
export function splitName(name: string, colours: Set<string>): { base: string; options: string[]; sample: boolean } {
  const sample = / \(sample\)$/.test(name);
  const parts = name.replace(/ \(sample\)$/, "").split(", ");
  const at = parts.findIndex((p, i) => i > 0 && colours.has(p));
  if (at < 0) return { base: parts.join(", "), options: [], sample };
  return { base: parts.slice(0, at).join(", "), options: parts.slice(at), sample };
}
