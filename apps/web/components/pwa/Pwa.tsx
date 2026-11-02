import { PwaClient } from "./PwaClient";

/** The service worker's version: the build's id (next.config.ts compiles it in). None under `next dev`: no worker. */
export const swVersion = (): string | null => (process.env.NODE_ENV === "production" && process.env.MUNSHI_BUILD_ID) || null;

/** The installable app's root piece: the worker's registration, the install offer and the offline banner. */
export function Pwa() {
  return <PwaClient version={swVersion()} />;
}
