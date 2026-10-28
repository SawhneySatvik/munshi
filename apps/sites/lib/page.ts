import { notFound } from "next/navigation";
import type { Lang } from "./business.ts";
import { isLang } from "./i18n.ts";
import type { HindiLabel } from "./types.ts";

export async function langOf(params: Promise<{ lang: string }>): Promise<Lang> {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return lang;
}

/** A row's name in the page's language: the shop's Hindi label when it has one. */
export function nameOf(row: { name: string; hi?: HindiLabel }, lang: Lang): string {
  return lang === "hi" && row.hi ? row.hi.name : row.name;
}

export function descOf(row: { description: string; hi?: HindiLabel }, lang: Lang): string {
  return lang === "hi" && row.hi?.description ? row.hi.description : row.description;
}
