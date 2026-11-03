import "../../styles/base.css";
import business from "@business";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { body, bodyHindi } from "../../lib/fonts.ts";
import { href, LANGS } from "../../lib/i18n.ts";
import { copy, langOf, wordmarkSub } from "../../lib/page.ts";
import { live } from "../../lib/variant.ts";

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const lang = await langOf(params);
  const { wordmark } = business.profile;
  const name = `${wordmark.en} · ${wordmarkSub(lang)}`;
  return {
    title: { default: name, template: `%s · ${wordmark.en}` },
    description: copy("heroLine", lang),
    // Under the site's base path: the site shares its domain with the web app.
    alternates: { languages: { "en-IN": href("en", "/"), "hi-IN": href("hi", "/") } },
    // The live site is for search engines; a copy built as a sample is not.
    robots: live ? { index: true, follow: true } : { index: false, follow: false },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return (
    <html lang={lang === "hi" ? "hi-IN" : "en-IN"} data-kind={business.profile.kind} className={`${body.variable} ${bodyHindi.variable} ${business.fontClass}`}>
      <body>{children}</body>
    </html>
  );
}
