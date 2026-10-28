// Commands for packages. Empty until its lane fills it; commands.ts spreads it into COMMANDS (type-only import: it is still
// being evaluated when this module loads).
import type { Def } from './commands.ts';

export const PACKAGE_COMMANDS: [string, Def][] = [];
