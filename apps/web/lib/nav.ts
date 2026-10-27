import type { OpsDict } from "./i18n-ops";
import type { Member } from "./types";

// The app's sections by role. Counter staff work the counter, the credit book and stock; the owner and a manager (who
// decides drafts too) have every section. /bills, /suppliers and /reports are MS-9b's pages.
export type Section = "home" | "counter" | "credit" | "stock" | "bills" | "suppliers" | "reports";

export const SECTIONS: Record<Member["role"], Section[]> = {
  owner: ["home", "counter", "credit", "stock", "bills", "suppliers", "reports"],
  manager: ["home", "counter", "credit", "stock", "bills", "suppliers", "reports"],
  staff: ["counter", "credit", "stock"],
};

export const HREF: Record<Section, string> = {
  home: "/",
  counter: "/counter",
  credit: "/credit",
  stock: "/stock",
  bills: "/bills",
  suppliers: "/suppliers",
  reports: "/reports",
};

export const LABEL: Record<Section, keyof OpsDict> = {
  home: "navHome",
  counter: "navCounter",
  credit: "navCredit",
  stock: "navStock",
  bills: "navBills",
  suppliers: "navSuppliers",
  reports: "navReports",
};

/** Where a person lands after signing in: the first section of their role. */
export const landing = (role: Member["role"]) => HREF[SECTIONS[role][0] as Section];

/** The phone's bottom bar holds this many sections; more than that, and the rest sit behind "More". */
export const PHONE_SLOTS = 5;
