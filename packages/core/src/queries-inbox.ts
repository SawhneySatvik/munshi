// Named reads for the inbox. Empty until its lane fills it; queries.ts spreads it into QUERIES (type-only import: it is still
// being evaluated when this module loads).
import type { NamedQuery } from './queries.ts';

export const INBOX_QUERIES: [string, NamedQuery][] = [];
