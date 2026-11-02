"use client";

import { useSyncExternalStore } from "react";

// The browser's install offer (beforeinstallprompt), caught once by PwaClient at the root (it fires at load, before Home
// may have mounted) and held here for the install prompt on Home.
export type InstallOffer = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let offer: InstallOffer | null = null;
const listeners = new Set<() => void>();

export function setOffer(next: InstallOffer | null) {
  offer = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export const useOffer = () =>
  useSyncExternalStore(
    subscribe,
    () => offer,
    () => null,
  );
