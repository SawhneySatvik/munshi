// Named reads for invoices and the GST summary. Empty until its lane fills it; queries.ts spreads it into QUERIES (type-only import: it is still
// being evaluated when this module loads).
import type { NamedQuery } from './queries.ts';

export const INVOICE_QUERIES: [string, NamedQuery][] = [];
