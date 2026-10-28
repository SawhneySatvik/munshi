"use client";

import { useSyncExternalStore } from "react";

export const NARROW_QUERY = "(max-width: 599.98px)";

/** Under 600 px the table is a card list. The server and first paint answer no (the table); a phone switches at hydration. */
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const q = window.matchMedia(NARROW_QUERY);
      q.addEventListener("change", notify);
      return () => q.removeEventListener("change", notify);
    },
    () => window.matchMedia(NARROW_QUERY).matches,
    () => false,
  );
}
