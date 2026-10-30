import type { OpsDict } from "./i18n-ops";
import type { Member } from "./types";

// The app's sections by role. Counter staff work the counter, the credit book and stock; the owner and a manager (who
// decides drafts too) have every section. /bills, /suppliers and /reports are the books pages.
export type Base = "home" | "counter" | "credit" | "stock" | "bills" | "suppliers" | "reports";
// The capability screens (BP-APP-1..4): each is in the navigation only while the shop can use its capability (core's
// can(), asked in the layout's transaction) and for the roles that work it; its page answers 404 otherwise.
export type Extra =
  | "orders"
  | "customers"
  | "offers"
  | "packages"
  | "loyalty"
  | "invoices"
  | "calendar"
  | "requests"
  | "staff"
  | "salary"
  | "office"
  | "inbox"
  | "campaigns"
  | "settings";
export type Section = Base | Extra;

export const SECTIONS: Record<Member["role"], Base[]> = {
  owner: ["home", "counter", "credit", "stock", "bills", "suppliers", "reports"],
  manager: ["home", "counter", "credit", "stock", "bills", "suppliers", "reports"],
  staff: ["counter", "credit", "stock"],
};

// Which capability opens each extra section (null: none needed), and who works it. Inbox is keyed by the messaging
// switch (core's switchedOn): a demo shop has no channel grant, and its inbox shows what was recorded.
export const EXTRA: Record<Extra, { cap: string | null; roles: Member["role"][] }> = {
  orders: { cap: "orders", roles: ["owner", "manager", "staff"] },
  customers: { cap: "counter", roles: ["owner", "manager", "staff"] },
  offers: { cap: "offers", roles: ["owner", "manager"] },
  packages: { cap: "packages", roles: ["owner", "manager", "staff"] },
  loyalty: { cap: "loyalty", roles: ["owner", "manager"] },
  invoices: { cap: "gst", roles: ["owner", "manager"] },
  calendar: { cap: "bookings", roles: ["owner", "manager", "staff"] },
  requests: { cap: "bookings", roles: ["owner", "manager"] },
  staff: { cap: "staff", roles: ["owner", "manager"] },
  salary: { cap: "salary", roles: ["owner"] },
  office: { cap: null, roles: ["owner", "manager"] },
  inbox: { cap: "messaging", roles: ["owner", "manager"] },
  campaigns: { cap: "campaigns", roles: ["owner"] },
  settings: { cap: null, roles: ["owner"] },
};

export const HREF: Record<Section, string> = {
  home: "/app",
  counter: "/app/counter",
  credit: "/app/credit",
  stock: "/app/stock",
  bills: "/app/bills",
  suppliers: "/app/suppliers",
  reports: "/app/reports",
  orders: "/app/orders",
  customers: "/app/customers",
  offers: "/app/offers",
  packages: "/app/packages",
  loyalty: "/app/loyalty",
  invoices: "/app/invoices",
  calendar: "/app/calendar",
  requests: "/app/requests",
  staff: "/app/staff",
  salary: "/app/staff/salary",
  office: "/app/office",
  inbox: "/app/inbox",
  campaigns: "/app/campaigns",
  settings: "/app/settings",
};

export const LABEL: Record<Section, keyof OpsDict> = {
  home: "navHome",
  counter: "navCounter",
  credit: "navCredit",
  stock: "navStock",
  bills: "navBills",
  suppliers: "navSuppliers",
  reports: "navReports",
  orders: "navOrders",
  customers: "navCustomers",
  offers: "navOffers",
  packages: "navPackages",
  loyalty: "navLoyalty",
  invoices: "navInvoices",
  calendar: "navCalendar",
  requests: "navRequests",
  staff: "navStaff",
  salary: "navSalary",
  office: "navOffice",
  inbox: "navInbox",
  campaigns: "navCampaigns",
  settings: "navSettings",
};

/** The extra sections a role sees, given the capabilities the shop can use, in the navigation's order. */
export const extrasFor = (role: Member["role"], on: ReadonlySet<string>): Extra[] =>
  (Object.keys(EXTRA) as Extra[]).filter((s) => EXTRA[s].roles.includes(role) && (EXTRA[s].cap === null || on.has(EXTRA[s].cap as string)));

/** Where a person lands after signing in: the first section of their role. */
export const landing = (role: Member["role"]) => HREF[SECTIONS[role][0] as Section];

/** The phone's bottom bar holds this many slots beside the raised mic in its middle: more sections than that,
 *  and the last ones sit behind "More" (the owner's bar reads Home · Counter · Mic · Credit · More). */
export const PHONE_SLOTS = 4;

/** How many of the bar's slots come before the mic: the middle, rounded up. */
export const beforeMic = (slots: number) => Math.ceil(slots / 2);
