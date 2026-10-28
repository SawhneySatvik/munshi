import type { ReactNode } from "react";
import type { Offer, Plan, Product, Service, Site } from "./types.ts";

export type Lang = "en" | "hi";
export type Text = Record<Lang, string>;
/** A site path without the language prefix (components add it), or an outside link per language. */
export type Link = { label: Text; href: string | Text };

export type Category = { id: string; label: Text; blurb: Text };

/** The site's own copy and settings. Figures never live here: they come from the data module (the books, later). */
export type Profile = {
  slug: string;
  kind: "salon" | "apparel";
  fullName: string;
  /** The wordmark: `lead` in ink, `accent` in the second colour. `short` replaces the accent on a phone header. */
  name: Record<Lang, { lead: string; accent: string; short: string }>;
  /** A placeholder name stays visible: "(name pending)". */
  pending?: Text;
  pill: Text;
  sub: Text;
  cta: { primary: Link; secondary: Link };
  headerCta: Link;
  nav: Link[];
  categories: Category[];
  marquee: Text[];
  /** Headings and lines that differ by business. */
  copy: Record<string, Text>;
  story: {
    pill: Text;
    title: Record<Lang, { lead: string; accent: string }>;
    body: Text[];
    promises: { icon: string; title: Text; body: Text }[];
    close: { icon: string; title: Text; body: Text; cta: Link };
  };
  /** Catalogue ids the home page shows first (apparel). */
  featured?: string[];
  /** The shop's WhatsApp number in international digits, once it arrives. */
  whatsapp: string | null;
};

export type Data = { site: Site; services: Service[]; packages: Plan[]; offers: Offer[]; catalogue: Product[] };

export type Art = {
  Logo: () => ReactNode;
  Hero: () => ReactNode;
  Story: () => ReactNode;
  Icon: (props: { id: string }) => ReactNode;
  /** A drawing that stands in for a product photo; colours come from CSS variables so a swatch can recolour it. */
  Product: (props: { category: string }) => ReactNode;
  /** The trim colour a product drawing pairs with a fabric swatch. */
  trimFor: (swatch: string) => string;
};

export type Business = { profile: Profile; data: Data; art: Art; fontClass: string };
