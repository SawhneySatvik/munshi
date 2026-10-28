// What `@business` resolves to for the type checker. The build points the alias at one businesses/<slug>/index.ts
// (next.config.ts); each of those is typed as Business, so the app type-checks against every business at once.
import type { Business } from "./business.ts";

declare const business: Business;
export default business;
