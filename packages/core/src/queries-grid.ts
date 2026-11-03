// Named reads for grid. Empty for now; queries.ts spreads it into QUERIES (type-only import: it is still
// being evaluated when this module loads).
import type { NamedQuery } from './queries.ts';

export const GRID_QUERIES: [string, NamedQuery][] = [];
