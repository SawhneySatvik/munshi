// Named reads for people. Empty for now; queries.ts spreads it into QUERIES (type-only import: it is still
// being evaluated when this module loads).
import type { NamedQuery } from './queries.ts';

export const PEOPLE_QUERIES: [string, NamedQuery][] = [];
