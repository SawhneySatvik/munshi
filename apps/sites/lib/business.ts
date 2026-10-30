import type { ReactNode } from "react";

export type Lang = "en" | "hi";
export type Text = Record<Lang, string>;

/** A nav entry: a site path without the language prefix. `cap` hides it when the release has that capability off. */
export type NavLink = { label: Text; href: string; cap?: string };

/** The business's own copy and settings. No figure lives here: every price, duration and count comes from the API. */
export type Profile = {
  slug: string;
  kind: "salon" | "apparel";
  /** The wordmark in each script. */
  wordmark: { en: string; hi: string; sub: Text };
  nav: NavLink[];
  /** Section and category copy, keyed by the API's category code (a category the profile does not name shows as sent). */
  categories: Record<string, { label: Text; blurb: Text }>;
  /** Headings and lines that differ by business. */
  copy: Record<string, Text>;
  /** Colour names the catalogue uses, with the swatch each is drawn in (apparel). */
  swatches?: Record<string, string>;
  /** The site offers a light and a dark mode (a toggle in the header); without it the look has one mode. */
  modes?: boolean;
  /** The shop's WhatsApp number in international digits, once it arrives (with the shop's permission). */
  whatsapp: string | null;
};

export type Art = {
  /** The small mark beside the wordmark. */
  Mark: () => ReactNode;
  Hero: () => ReactNode;
  /** A drawing that stands in for a photograph until the shop sends its own; `kind` is the API category code. */
  Plate: (props: { kind: string; tone?: number }) => ReactNode;
};

export type Business = { profile: Profile; art: Art; fontClass: string };
