// The desks: one agent with seven desks, keyed by ref.capability. A shop sees a desk while
// the capability that opens it is on, and within it only the parts whose capability is on. Every capability is either
// some desk's part or listed in NO_DESK, so a new capability with neither fails the totality test. A watcher's finding
// names its desk (packages/core/src/watchers.ts). The Ask router still sends questions to the tool desks of tools.ts —
// stock, sales and credit, the last being the Sales & Money desk's udhaar part; the other desks have no tools yet.

export type DeskEntry = { title: string; opens: string; parts: readonly (readonly [part: string, capability: string])[] };

export const DESK_REGISTRY = {
  stock: {
    title: "Stock",
    opens: "stock",
    parts: [
      ["on_hand", "stock"],
      ["counts", "stock"],
      ["expiry", "stock"],
      ["dead_stock", "stock"],
      ["bills", "buying"],
      ["reorders", "buying"],
      ["variants", "variants"],
      ["holds", "holds"],
    ],
  },
  sales: {
    title: "Sales & Money",
    opens: "counter",
    parts: [
      ["sales", "counter"],
      ["settlements", "counter"],
      ["udhaar", "credit"],
      ["offer_codes", "offers"],
      ["gst", "gst"],
    ],
  },
  orders: {
    title: "Orders",
    opens: "orders",
    parts: [
      ["requests", "orders"],
      ["board", "orders"],
      ["late_orders", "orders"],
      ["advances", "orders"],
      ["measurements", "stitching"],
    ],
  },
  bookings: {
    title: "Bookings",
    opens: "bookings",
    parts: [
      ["calendar", "bookings"],
      ["idle_chairs", "bookings"],
      ["no_shows", "bookings"],
      ["unbilled", "bookings"],
      ["hold_pressure", "bookings"],
    ],
  },
  packages: { title: "Packages", opens: "packages", parts: [["holdings", "packages"], ["redemptions", "packages"], ["expiry", "packages"], ["liability", "packages"]] },
  customers: {
    title: "Customers",
    opens: "messaging",
    parts: [
      ["regulars", "messaging"],
      ["consent", "messaging"],
      ["inbox", "messaging"],
      ["campaigns", "campaigns"],
      ["loyalty", "loyalty"],
    ],
  },
  staff: { title: "Staff", opens: "staff", parts: [["roster", "staff"], ["attendance", "staff"], ["leave", "staff"], ["advances", "staff"], ["salary", "salary"]] },
} as const satisfies Record<string, DeskEntry>;

export type DeskCode = keyof typeof DESK_REGISTRY;

/** Capabilities that open no desk part: the site, its cart, the API and the AI switch itself. */
export const NO_DESK = ["cart", "site", "api", "ai"] as const;

/** The desks a shop sees, each with the parts it owns there, from the capabilities on for it. */
export function desksOpen(on: ReadonlySet<string>): { desk: DeskCode; title: string; parts: string[] }[] {
  return (Object.entries(DESK_REGISTRY) as [DeskCode, DeskEntry][])
    .filter(([, d]) => on.has(d.opens))
    .map(([desk, d]) => ({ desk, title: d.title, parts: d.parts.filter(([, cap]) => on.has(cap)).map(([part]) => part) }));
}
