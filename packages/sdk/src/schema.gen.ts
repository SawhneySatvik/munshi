// Generated from packages/contracts/openapi.json by packages/contracts/src/build.ts (pnpm contracts). Do not edit:
// change the zod schemas in packages/contracts/src/v1/ and regenerate. Types only; the SDK has no runtime dependency.

export type BookingBody = {
  holdId: Id;
  holdToken: HoldToken;
  name: PersonName;
  phone: Phone;
  note?: Note | undefined;
  whatsappUpdates: boolean;
  noticeVersion: Version;
  consentVersion: Version;
  botToken: BotToken;
  website: Honeypot;
};

export type BookingRequestBody = {
  shopId: Id;
  name: PersonName;
  phone: Phone;
  serviceIds: Id[];
  preferredOn: IsoDate;
  timeWindow: TimeWindow;
  note?: Note | undefined;
  whatsappUpdates: boolean;
  noticeVersion: Version;
  consentVersion: Version;
  botToken: BotToken;
  website: Honeypot;
};

export type BotToken = string;

export type CatalogueItem = {
  id: Id;
  name: string;
  category: string | null;
  variants: Variant[];
};

export type CataloguePage = {
  data: CatalogueItem[];
  next: Cursor | null;
};

export type CatalogueQuery = {
  cursor?: Cursor | undefined;
  limit?: Limit | undefined;
  category?: string | undefined;
};

export type Currency = string;

export type Cursor = string;

export type DateCell = {
  date: IsoDate;
  ref: Ref;
};

export type DerivedMoney = {
  minor: number;
  currency: Currency;
  from: Ref[];
};

export type DeviceToken = string;

export type Draft = {
  id: Id;
  command: string;
  status: "proposed" | "executed" | "rejected" | "stale" | "failed" | "superseded";
  source: "member" | "run";
  desk: string | null;
  findingId: Id | null;
  basedOn: Ref[];
  createdAt: Timestamp;
};

export type DraftProposal = {
  command: string;
  payload: Record<string, Id | string | boolean | null | {
    ref: Ref;
  }>;
  basedOn: Ref[];
  findingId?: Id | undefined;
};

export type DraftProposed = {
  id: Id;
  status: "proposed";
};

export type DraftsPage = {
  data: Draft[];
  next: Cursor | null;
};

export type DraftsQuery = {
  cursor?: Cursor | undefined;
  limit?: Limit | undefined;
  status?: "proposed" | "executed" | "rejected" | "stale" | "failed" | "superseded" | undefined;
};

export type EnquiryBody = {
  shopId: Id;
  name: PersonName;
  phone: Phone;
  itemId?: Id | undefined;
  message: string;
  whatsappUpdates: boolean;
  noticeVersion: Version;
  consentVersion: Version;
  botToken: BotToken;
  website: Honeypot;
};

export type ErrorBody = {
  error: ErrorDetail;
};

export type ErrorCode = "invalid" | "idempotency_key_required" | "stale_notice" | "bot_check" | "unauthenticated" | "not_found" | "slot_taken" | "idempotency_mismatch" | "gone" | "payload_too_large" | "unsupported_media_type" | "rate_limited" | "hold_limit" | "intake_paused" | "internal";

export type ErrorDetail = {
  code: "invalid";
  message: "The request does not match its contract.";
  fields: string[];
  requestId: string;
} | {
  code: "idempotency_key_required";
  message: "Send an Idempotency-Key header with every POST and DELETE.";
  fields: string[];
  requestId: string;
} | {
  code: "stale_notice";
  message: "The notice or consent version is not the site's current one. Fetch the site and try again.";
  fields: string[];
  requestId: string;
} | {
  code: "bot_check";
  message: "The bot check did not pass.";
  fields: string[];
  requestId: string;
} | {
  code: "unauthenticated";
  message: "The signature does not match.";
  fields: string[];
  requestId: string;
} | {
  code: "not_found";
  message: "Not found.";
  fields: string[];
  requestId: string;
} | {
  code: "slot_taken";
  message: "That time was just taken. Pick another.";
  fields: string[];
  requestId: string;
} | {
  code: "idempotency_mismatch";
  message: "This Idempotency-Key was sent before with a different request.";
  fields: string[];
  requestId: string;
} | {
  code: "gone";
  message: "This route is retired.";
  fields: string[];
  requestId: string;
} | {
  code: "payload_too_large";
  message: "The body is over 4 KB.";
  fields: string[];
  requestId: string;
} | {
  code: "unsupported_media_type";
  message: "Send the body as JSON.";
  fields: string[];
  requestId: string;
} | {
  code: "rate_limited";
  message: "Too many requests. Try again after the Retry-After header.";
  fields: string[];
  requestId: string;
} | {
  code: "hold_limit";
  message: "Finish or release your other hold first.";
  fields: string[];
  requestId: string;
} | {
  code: "intake_paused";
  message: "The shop is not taking requests just now.";
  fields: string[];
  requestId: string;
} | {
  code: "internal";
  message: "Something went wrong on our side.";
  fields: string[];
  requestId: string;
};

export type Finding = {
  id: Id;
  shopId: Id | null;
  desk: string;
  kind: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "open" | "snoozed" | "dismissed" | "resolved";
  impact: MoneyFigure | null;
  firstSeenAt: Timestamp;
  lastSeenAt: Timestamp;
};

export type FindingsPage = {
  data: Finding[];
  next: Cursor | null;
};

export type FindingsQuery = {
  cursor?: Cursor | undefined;
  limit?: Limit | undefined;
  status?: "open" | "snoozed" | "dismissed" | "resolved" | undefined;
};

export type HoldBody = {
  shopId: Id;
  stylistId: Id;
  serviceId: Id;
  start: Timestamp;
  shiftRel: ShiftRel;
  shiftId: Id;
  botToken: BotToken;
};

export type HoldCreated = {
  holdId: Id;
  holdToken: HoldToken;
  expiresAt: Timestamp;
};

export type HoldHeaders = {
  "Idempotency-Key": IdempotencyKey;
  "X-Munshi-Device": DeviceToken;
};

export type HoldParams = {
  slug: Slug;
  id: Id;
};

export type HoldReleased = {
  holdId: Id;
  released: true;
};

export type HoldToken = string;

export type Honeypot = string;

export type Hours = {
  day: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  closed: boolean;
  opens: string | null;
  closes: string | null;
};

export type Id = string;

export type IdempotencyKey = string;

export type IntFigure = {
  value: number;
  ref: Ref;
};

export type IsoDate = string;

export type Limit = number;

export type ListQuery = {
  cursor?: Cursor | undefined;
  limit?: Limit | undefined;
};

export type LocalText = Record<string, string>;

export type Look = {
  tokens: Tokens;
  fontPair: string;
  profile: Profile;
  art: Record<string, MediaPath>;
};

export type MediaParams = {
  slug: Slug;
  id: Id;
};

export type MediaPath = string;

export type MoneyFigure = {
  minor: number;
  currency: Currency;
  ref: Ref;
};

export type Note = string;

export type Offer = {
  id: Id;
  name: string;
  scope: "all" | "category" | "items";
  category: string | null;
  itemIds: Id[];
  minSpend: MoneyFigure | null;
  code: OfferCode | null;
  startsAt: Timestamp;
  endsAt: Timestamp;
  kind: "percent_off";
  percentBp: IntFigure;
} | {
  id: Id;
  name: string;
  scope: "all" | "category" | "items";
  category: string | null;
  itemIds: Id[];
  minSpend: MoneyFigure | null;
  code: OfferCode | null;
  startsAt: Timestamp;
  endsAt: Timestamp;
  kind: "amount_off";
  amountOff: MoneyFigure;
};

export type OfferCode = string;

export type OffersPage = {
  data: Offer[];
  next: Cursor | null;
};

export type OrderBody = {
  shopId: Id;
  channel: "site" | "widget";
  lines: OrderLineInput[];
  offerCode?: OfferCode | undefined;
};

export type OrderCode = string;

export type OrderCreated = {
  code: OrderCode;
  lines: OrderLine[];
  total: DerivedMoney;
  offerCode: OfferCode | null;
  message: string;
  waLink: string | null;
};

export type OrderLine = {
  itemId: Id;
  qty: RequestedQty;
  price: MoneyFigure;
  amount: DerivedMoney;
};

export type OrderLineInput = {
  itemId: Id;
  qtyMilli: number;
};

export type OrderStatus = {
  code: OrderCode;
  request: "received" | "confirmed" | "declined" | "expired";
  current: OrderStep | null;
  steps: {
    step: OrderStep;
    at: Timestamp;
  }[];
};

export type OrderStatusParams = {
  slug: Slug;
  code: OrderCode;
};

export type OrderStep = "confirmed" | "packed" | "cutting" | "stitching" | "trial" | "ready" | "out_for_delivery" | "delivered" | "cancelled" | "rescheduled";

export type PackageLine = {
  serviceId: Id;
  name: string;
  sessions: IntFigure;
};

export type PackagePlan = {
  id: Id;
  itemId: Id;
  name: string;
  kind: "sessions" | "value";
  price: MoneyFigure;
  value: MoneyFigure | null;
  validityDays: IntFigure;
  lines: PackageLine[];
};

export type PackagesPage = {
  data: PackagePlan[];
  next: Cursor | null;
};

export type PersonName = string;

export type Phone = string;

export type Profile = {
  tagline?: LocalText | undefined;
  story?: LocalText[] | undefined;
  sections?: string[] | undefined;
  faq?: {
    q: LocalText;
    a: LocalText;
  }[] | undefined;
  hoursNote?: LocalText | undefined;
};

export type PublishedCell = MoneyFigure | IntFigure | TextCell | DateCell | TimestampCell;

export type Received = {
  id: Id;
  received: true;
};

export type Ref = string;

export type RefAnswer = {
  verified: true;
  cell: PublishedCell;
  source: RefSource;
  publishedAt: Timestamp;
} | {
  verified: false;
  label: "Cannot verify";
};

export type RefParams = {
  slug: Slug;
  snapshot: Id;
  row: number;
  col: string;
};

export type RefSource = {
  table: string;
  id: Id;
};

export type ReleaseHoldHeaders = {
  "Idempotency-Key": IdempotencyKey;
  "X-Hold-Token": HoldToken;
};

export type RequestedQty = {
  qtyMilli: number;
  source: "request";
};

export type ReservationBody = {
  itemId: Id;
  qtyMilli: number;
  name: PersonName;
  phone: Phone;
  note?: Note | undefined;
  noticeVersion: Version;
  consentVersion: Version;
  botToken: BotToken;
  website: Honeypot;
};

export type Service = {
  id: Id;
  name: string;
  category: string | null;
  duration: IntFigure;
  price: MoneyFigure;
  shopIds: Id[];
};

export type ServicesPage = {
  data: Service[];
  next: Cursor | null;
};

export type ShiftRel = "books.shift_pattern" | "books.shift_change";

export type Shop = {
  id: Id;
  name: string;
  area: string | null;
  hours: Hours[];
};

export type Site = {
  slug: Slug;
  name: string;
  businessType: string;
  dataClass: "synthetic" | "showcase" | "live";
  label: "Sample site" | null;
  shops: Shop[];
  bookingMode: "none" | "request" | "slots";
  intake: "open" | "paused";
  noticeVersion: Version;
  consentVersion: Version;
  look: Look;
  release: SiteRelease;
};

export type SiteRelease = {
  id: Id;
  publishedAt: Timestamp;
};

export type Slot = {
  stylistId: Id;
  start: Timestamp;
  shiftRel: ShiftRel;
  shiftId: Id;
};

export type Slots = {
  date: IsoDate;
  shopId: Id;
  serviceId: Id;
  slots: Slot[];
};

export type SlotsQuery = {
  shop: Id;
  service: Id;
  date: IsoDate;
  stylist?: Id | undefined;
};

export type Slug = string;

export type SlugParams = {
  slug: Slug;
};

export type Stylist = {
  id: Id;
  shopId: Id;
  displayName: string;
  blurb: string | null;
  artUrl: MediaPath | null;
};

export type StylistsPage = {
  data: Stylist[];
  next: Cursor | null;
};

export type StylistsQuery = {
  cursor?: Cursor | undefined;
  limit?: Limit | undefined;
  shop?: Id | undefined;
};

export type TextCell = {
  text: string;
  ref: Ref;
};

export type TimeWindow = "morning" | "afternoon" | "evening";

export type Timestamp = string;

export type TimestampCell = {
  at: Timestamp;
  ref: Ref;
};

export type TokenSet = {
  "--ground"?: string | undefined;
  "--surface"?: string | undefined;
  "--ink"?: string | undefined;
  "--ink-muted"?: string | undefined;
  "--hairline"?: string | undefined;
  "--accent"?: string | undefined;
  "--accent-ink"?: string | undefined;
  "--signal"?: string | undefined;
  "--ok"?: string | undefined;
  "--warn"?: string | undefined;
  "--danger"?: string | undefined;
  "--radius-card"?: string | undefined;
  "--radius-chip"?: string | undefined;
  "--space-1"?: string | undefined;
  "--space-2"?: string | undefined;
  "--space-3"?: string | undefined;
  "--space-4"?: string | undefined;
  "--space-5"?: string | undefined;
  "--space-6"?: string | undefined;
  "--space-7"?: string | undefined;
  "--space-8"?: string | undefined;
  "--figure-xl"?: string | undefined;
  "--figure-l"?: string | undefined;
  "--figure-m"?: string | undefined;
  "--font-display"?: string | undefined;
  "--font-text"?: string | undefined;
  "--font-figures"?: string | undefined;
  "--font-deva-display"?: string | undefined;
  "--font-deva-text"?: string | undefined;
  "--motion-quick"?: string | undefined;
  "--motion-sheet"?: string | undefined;
};

export type Tokens = TokenSet | {
  light: TokenSet;
  dark: TokenSet;
};

export type Variant = {
  id: Id;
  name: string;
  attrs: Record<string, string>;
  unit: "piece" | "pack" | "kg" | "g" | "l" | "ml" | "m";
  price: MoneyFigure;
  held: boolean;
};

export type Version = string;

export type WriteHeaders = {
  "Idempotency-Key": IdempotencyKey;
};

export interface Schemas {
  BookingBody: BookingBody;
  BookingRequestBody: BookingRequestBody;
  BotToken: BotToken;
  CatalogueItem: CatalogueItem;
  CataloguePage: CataloguePage;
  CatalogueQuery: CatalogueQuery;
  Currency: Currency;
  Cursor: Cursor;
  DateCell: DateCell;
  DerivedMoney: DerivedMoney;
  DeviceToken: DeviceToken;
  Draft: Draft;
  DraftProposal: DraftProposal;
  DraftProposed: DraftProposed;
  DraftsPage: DraftsPage;
  DraftsQuery: DraftsQuery;
  EnquiryBody: EnquiryBody;
  ErrorBody: ErrorBody;
  ErrorCode: ErrorCode;
  ErrorDetail: ErrorDetail;
  Finding: Finding;
  FindingsPage: FindingsPage;
  FindingsQuery: FindingsQuery;
  HoldBody: HoldBody;
  HoldCreated: HoldCreated;
  HoldHeaders: HoldHeaders;
  HoldParams: HoldParams;
  HoldReleased: HoldReleased;
  HoldToken: HoldToken;
  Honeypot: Honeypot;
  Hours: Hours;
  Id: Id;
  IdempotencyKey: IdempotencyKey;
  IntFigure: IntFigure;
  IsoDate: IsoDate;
  Limit: Limit;
  ListQuery: ListQuery;
  LocalText: LocalText;
  Look: Look;
  MediaParams: MediaParams;
  MediaPath: MediaPath;
  MoneyFigure: MoneyFigure;
  Note: Note;
  Offer: Offer;
  OfferCode: OfferCode;
  OffersPage: OffersPage;
  OrderBody: OrderBody;
  OrderCode: OrderCode;
  OrderCreated: OrderCreated;
  OrderLine: OrderLine;
  OrderLineInput: OrderLineInput;
  OrderStatus: OrderStatus;
  OrderStatusParams: OrderStatusParams;
  OrderStep: OrderStep;
  PackageLine: PackageLine;
  PackagePlan: PackagePlan;
  PackagesPage: PackagesPage;
  PersonName: PersonName;
  Phone: Phone;
  Profile: Profile;
  PublishedCell: PublishedCell;
  Received: Received;
  Ref: Ref;
  RefAnswer: RefAnswer;
  RefParams: RefParams;
  RefSource: RefSource;
  ReleaseHoldHeaders: ReleaseHoldHeaders;
  RequestedQty: RequestedQty;
  ReservationBody: ReservationBody;
  Service: Service;
  ServicesPage: ServicesPage;
  ShiftRel: ShiftRel;
  Shop: Shop;
  Site: Site;
  SiteRelease: SiteRelease;
  Slot: Slot;
  Slots: Slots;
  SlotsQuery: SlotsQuery;
  Slug: Slug;
  SlugParams: SlugParams;
  Stylist: Stylist;
  StylistsPage: StylistsPage;
  StylistsQuery: StylistsQuery;
  TextCell: TextCell;
  TimeWindow: TimeWindow;
  Timestamp: Timestamp;
  TimestampCell: TimestampCell;
  TokenSet: TokenSet;
  Tokens: Tokens;
  Variant: Variant;
  Version: Version;
  WriteHeaders: WriteHeaders;
}

export interface Operations {
  book: {
    method: "POST";
    path: "/sites/{slug}/bookings";
    auth: "publishable";
    params: SlugParams;
    query: undefined;
    headers: WriteHeaders;
    body: BookingBody;
    status: 202;
    response: Received;
    deferred: false;
  };
  catalogue: {
    method: "GET";
    path: "/sites/{slug}/catalogue";
    auth: "none";
    params: SlugParams;
    query: CatalogueQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: CataloguePage;
    deferred: false;
  };
  drafts: {
    method: "GET";
    path: "/drafts";
    auth: "secret";
    params: undefined;
    query: DraftsQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: DraftsPage;
    deferred: true;
  };
  enquire: {
    method: "POST";
    path: "/sites/{slug}/enquiries";
    auth: "publishable";
    params: SlugParams;
    query: undefined;
    headers: WriteHeaders;
    body: EnquiryBody;
    status: 202;
    response: Received;
    deferred: false;
  };
  findings: {
    method: "GET";
    path: "/findings";
    auth: "secret";
    params: undefined;
    query: FindingsQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: FindingsPage;
    deferred: true;
  };
  hold: {
    method: "POST";
    path: "/sites/{slug}/holds";
    auth: "publishable";
    params: SlugParams;
    query: undefined;
    headers: HoldHeaders;
    body: HoldBody;
    status: 201;
    response: HoldCreated;
    deferred: false;
  };
  mediaJpg: {
    method: "GET";
    path: "/sites/{slug}/media/{id}.jpg";
    auth: "none";
    params: MediaParams;
    query: undefined;
    headers: undefined;
    body: undefined;
    status: 200;
    response: ArrayBuffer;
    deferred: false;
  };
  mediaSvg: {
    method: "GET";
    path: "/sites/{slug}/media/{id}.svg";
    auth: "none";
    params: MediaParams;
    query: undefined;
    headers: undefined;
    body: undefined;
    status: 200;
    response: ArrayBuffer;
    deferred: false;
  };
  offers: {
    method: "GET";
    path: "/sites/{slug}/offers";
    auth: "none";
    params: SlugParams;
    query: ListQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: OffersPage;
    deferred: false;
  };
  order: {
    method: "POST";
    path: "/sites/{slug}/orders";
    auth: "publishable";
    params: SlugParams;
    query: undefined;
    headers: WriteHeaders;
    body: OrderBody;
    status: 201;
    response: OrderCreated;
    deferred: false;
  };
  orderStatus: {
    method: "GET";
    path: "/sites/{slug}/orders/{code}";
    auth: "none";
    params: OrderStatusParams;
    query: undefined;
    headers: undefined;
    body: undefined;
    status: 200;
    response: OrderStatus;
    deferred: false;
  };
  packages: {
    method: "GET";
    path: "/sites/{slug}/packages";
    auth: "none";
    params: SlugParams;
    query: ListQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: PackagesPage;
    deferred: false;
  };
  proposeDraft: {
    method: "POST";
    path: "/drafts";
    auth: "secret";
    params: undefined;
    query: undefined;
    headers: WriteHeaders;
    body: DraftProposal;
    status: 202;
    response: DraftProposed;
    deferred: true;
  };
  ref: {
    method: "GET";
    path: "/sites/{slug}/refs/{snapshot}/{row}/{col}";
    auth: "none";
    params: RefParams;
    query: undefined;
    headers: undefined;
    body: undefined;
    status: 200;
    response: RefAnswer;
    deferred: false;
  };
  releaseHold: {
    method: "DELETE";
    path: "/sites/{slug}/holds/{id}";
    auth: "publishable";
    params: HoldParams;
    query: undefined;
    headers: ReleaseHoldHeaders;
    body: undefined;
    status: 200;
    response: HoldReleased;
    deferred: false;
  };
  requestBooking: {
    method: "POST";
    path: "/sites/{slug}/booking-requests";
    auth: "publishable";
    params: SlugParams;
    query: undefined;
    headers: WriteHeaders;
    body: BookingRequestBody;
    status: 202;
    response: Received;
    deferred: false;
  };
  reserve: {
    method: "POST";
    path: "/sites/{slug}/reservations";
    auth: "publishable";
    params: SlugParams;
    query: undefined;
    headers: WriteHeaders;
    body: ReservationBody;
    status: 202;
    response: Received;
    deferred: false;
  };
  services: {
    method: "GET";
    path: "/sites/{slug}/services";
    auth: "none";
    params: SlugParams;
    query: ListQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: ServicesPage;
    deferred: false;
  };
  site: {
    method: "GET";
    path: "/sites/{slug}";
    auth: "none";
    params: SlugParams;
    query: undefined;
    headers: undefined;
    body: undefined;
    status: 200;
    response: Site;
    deferred: false;
  };
  slots: {
    method: "GET";
    path: "/sites/{slug}/slots";
    auth: "none";
    params: SlugParams;
    query: SlotsQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: Slots;
    deferred: false;
  };
  stylists: {
    method: "GET";
    path: "/sites/{slug}/stylists";
    auth: "none";
    params: SlugParams;
    query: StylistsQuery;
    headers: undefined;
    body: undefined;
    status: 200;
    response: StylistsPage;
    deferred: false;
  };
}
