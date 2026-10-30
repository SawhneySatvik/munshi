// Screen reads, moved into core from apps/web/lib/server (BP-CORE-2's read half, done in W2's spine): one named view
// per screen, run in the page's one transaction (withPage). Each view file joins here.
export { ERASED, namesOf, type Party } from './people.ts';
export * from './views-bills.ts';
// The shared helpers a server file may call beside a view; the raw read and mint stay inside core.
export {
  type BookRow,
  customerList,
  signedInMember,
  stampOf,
  type StoredSnapshot,
  storedSnapshots,
  supplierList,
  type Viewer,
  withPage,
} from './views-common.ts';
export * from './views-counter.ts';
export * from './views-credit.ts';
export * from './views-hero.ts';
export * from './views-home.ts';
export * from './views-report.ts';
export * from './views-signin.ts';
export * from './views-stock.ts';
export * from './views-sell.ts';
export * from './views-orders.ts';
export * from './views-people.ts';
export * from './views-office.ts';
