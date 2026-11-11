import type { OpsDict } from "./i18n-ops";
import type { Member } from "./types";

// The app's sections by role. Counter staff work the counter, the credit book and stock; the owner and a manager (who
// decides drafts too) have every section. /bills, /suppliers and /reports are the books pages.
export type Base = "home" | "counter" | "credit" | "stock" | "bills" | "suppliers" | "reports";
// The capability screens: each is in the navigation only while the shop can use its capability (core's
// can(), asked in the layout's transaction) and for the roles that work it; its page answers 404 otherwise.
export type Extra =
  | "paypal"
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
  | "settlements"
  | "growth"
  | "settings";
export type Section = Base | Extra;

export const SECTIONS: Record<Member["role"], Base[]> = {
  owner: ["home", "counter", "credit", "stock", "bills", "suppliers", "reports"],
  manager: ["home", "counter", "credit", "stock", "bills", "suppliers", "reports"],
  staff: ["counter", "credit", "stock"],
};

// Which capability opens each extra section (null: none needed), and who works it. Inbox is keyed by the messaging
// switch (core's switchedOn): a demo shop has no channel grant, and its inbox shows what was recorded. Every extra
// section is the office's: counter staff work the counter, the credit book and stock only, and each of these
// pages answers them 404 by core's map (packages/core/src/read-roles.ts).
export const EXTRA: Record<Extra, { cap: string | null; roles: Member["role"][] }> = {
  // Collections and PayPal links: the office's, as every PayPal surface is (counter staff see none).
  paypal: { cap: "credit", roles: ["owner", "manager"] },
  orders: { cap: "orders", roles: ["owner", "manager"] },
  customers: { cap: "counter", roles: ["owner", "manager"] },
  offers: { cap: "offers", roles: ["owner", "manager"] },
  packages: { cap: "packages", roles: ["owner", "manager"] },
  loyalty: { cap: "loyalty", roles: ["owner", "manager"] },
  invoices: { cap: "gst", roles: ["owner", "manager"] },
  calendar: { cap: "bookings", roles: ["owner", "manager"] },
  requests: { cap: "bookings", roles: ["owner", "manager"] },
  staff: { cap: "staff", roles: ["owner", "manager"] },
  salary: { cap: "salary", roles: ["owner"] },
  office: { cap: null, roles: ["owner", "manager"] },
  inbox: { cap: "messaging", roles: ["owner", "manager"] },
  campaigns: { cap: "campaigns", roles: ["owner"] },
  settlements: { cap: "counter", roles: ["owner", "manager"] },
  growth: { cap: "counter", roles: ["owner", "manager"] },
  settings: { cap: null, roles: ["owner"] },
};

export const HREF: Record<Section, string> = {
  home: "/app",
  counter: "/app/counter",
  credit: "/app/credit",
  paypal: "/app/paypal",
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
  settlements: "/app/settlements",
  growth: "/app/growth",
  settings: "/app/settings",
};

export const LABEL: Record<Section, keyof OpsDict> = {
  home: "navHome",
  counter: "navCounter",
  credit: "navCredit",
  paypal: "navPaypal",
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
  settlements: "navSettlements",
  growth: "navGrowth",
  settings: "navSettings",
};

/** The extra sections a role sees, given the capabilities the shop can use, in the navigation's order. */
export const extrasFor = (role: Member["role"], on: ReadonlySet<string>): Extra[] =>
  (Object.keys(EXTRA) as Extra[]).filter((s) => EXTRA[s].roles.includes(role) && (EXTRA[s].cap === null || on.has(EXTRA[s].cap as string)));

/** Where a person lands after signing in: the first section of their role. */
export const landing = (role: Member["role"]) => HREF[SECTIONS[role][0] as Section];

/** The rail's five hubs on a desk, each holding its sections in order; settings sits at the rail's foot. A hub with none
 *  of the member's sections does not show. */
export const HUBS: { label: keyof OpsDict; sections: Section[] }[] = [
  { label: "hubToday", sections: ["home", "office", "inbox"] },
  { label: "hubSell", sections: ["counter", "orders", "invoices", "offers", "packages", "calendar", "requests"] },
  { label: "hubStock", sections: ["stock", "bills", "suppliers"] },
  { label: "hubMoney", sections: ["credit", "paypal", "settlements", "reports", "growth"] },
  { label: "hubPeople", sections: ["customers", "staff", "salary", "loyalty", "campaigns"] },
];

/** A phone's bar: the first three of these the member has, two before the raised mic and one after, then "More". */
const PHONE_FIRST: Section[] = ["home", "counter", "stock", "credit"];
export const phoneBar = (sections: readonly Section[]) => PHONE_FIRST.filter((s) => sections.includes(s)).slice(0, 3);

/** Other words a section answers to in the jump-to search, beside its label in either language. */
export const ALSO: Partial<Record<Section, string[]>> = {
  counter: ["sale", "billing", "pos"],
  credit: ["udhaar", "dues", "khata"],
  paypal: ["collections", "payment link"],
  stock: ["shelf", "inventory", "count"],
  bills: ["purchase"],
  settlements: ["upi", "payout"],
  growth: ["insights", "trend"],
  office: ["brief", "agents"],
};
