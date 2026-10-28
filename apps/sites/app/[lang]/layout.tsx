import "../../styles/site.css";
import business from "@business";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { body, bodyHindi } from "../../lib/fonts.ts";
import { LANGS } from "../../lib/i18n.ts";
import { langOf } from "../../lib/page.ts";

export const dynamicParams = false;

export function generateStaticParams() {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const lang = await langOf(params);
  const { profile } = business;
  return {
    title: { default: profile.fullName, template: `%s · ${profile.fullName}` },
    description: profile.sub[lang],
    alternates: { languages: { "en-IN": "/", "hi-IN": "/hi" } },
  };
}

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function Layout({ children, params }: { children: ReactNode; params: Promise<{ lang: string }> }) {
  const lang = await langOf(params);
  return (
    <html
      lang={lang === "hi" ? "hi-IN" : "en-IN"}
      data-site={business.profile.slug}
      className={`${body.variable} ${bodyHindi.variable} ${business.fontClass}`}
    >
      <body>{children}</body>
    </html>
  );
}
