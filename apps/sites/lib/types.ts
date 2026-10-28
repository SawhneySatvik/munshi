// The shapes the developer kit's routes return (docs/MERCHANTS-DESIGN.md §5.2). The fixtures in each business folder are
// written in these shapes so MS-29 swaps lib/source.ts for @munshi/sdk and nothing else.

/** Money from the books. `ref` names the snapshot cell it was read from; sample data has none, so it is null. */
export type Money = { minor: number; currency: "INR"; ref: string | null; source: string | null };
/** A whole number from the books (a duration in minutes, a session count). */
export type Count = { value: number; ref: string | null };

/** The shop's own Hindi label for a row. Not in v1's routes yet: a proposed additive field. */
export type HindiLabel = { name: string; description?: string };

export type Shop = { id: string; name: string; area: string; hi?: { name: string; area: string } };

/** GET /api/v1/site */
export type Site = {
  name: string;
  businessType: "salon" | "apparel";
  privacyNoticeUrl: string;
  privacyVersion: string;
  consentText: string;
  consentVersion: string;
  intake: "open" | "paused";
  releaseId: string;
  publishedAt: string;
  shops: Shop[];
  /** True while the figures come from the illustrative fixture, not a published release. */
  sample: boolean;
};

/** GET /api/v1/services */
export type Service = {
  id: string;
  category: string;
  name: string;
  description: string;
  duration: Count;
  price: Money;
  /** "From ₹…": the price starts here and depends on length or product. */
  from?: boolean;
  hi?: HindiLabel;
};

/** GET /api/v1/packages */
export type PlanLine = { label: string; sessions: Count; hi?: string };
export type Plan = {
  id: string;
  kind: "package" | "membership";
  name: string;
  description: string;
  lines: PlanLine[];
  validityDays: Count;
  price: Money;
  hi?: HindiLabel;
};

/** GET /api/v1/offers */
export type Offer = {
  id: string;
  title: string;
  detail: string;
  until: string;
  /** Catalogue categories the offer is shown beside. Not in v1's routes yet: a proposed additive field. */
  appliesTo?: string[];
  hi?: { title: string; detail: string; until: string };
};

/** GET /api/v1/catalogue: a parent with its variants. */
export type Variant = { id: string; attrs: { colour: string; swatch: string; size?: string }; price: Money };
export type Product = {
  id: string;
  category: string;
  name: string;
  description: string;
  fabric: string;
  variants: Variant[];
  hi?: HindiLabel & { fabric?: string };
};

/** POST /api/v1/booking-requests (the honeypot and bot token are added by the SDK). */
export type BookingRequest = {
  shopId: string;
  name: string;
  phone: string;
  serviceIds: string[];
  preferredOn: string;
  timeWindow: "morning" | "afternoon" | "evening";
  note?: string;
  whatsappUpdates: boolean;
  consentVersion: string;
  noticeVersion: string;
};
