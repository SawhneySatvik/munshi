"use client";

// The order being put together: piece id → whole units, kept in this browser only (a per-viewer convenience; an
// empty or refused store is an empty order). The order itself is stored only when the API answers its POST.
import { useCallback, useSyncExternalStore } from "react";

const KEY = "site.order";
const EVENT = "site-order-change";
export const MAX_UNITS = 9;
export const MAX_LINES = 20;

export type Cart = Record<string, number>;

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

function parse(text: string): Cart {
  try {
    const v = JSON.parse(text) as unknown;
    if (!v || typeof v !== "object") return {};
    return Object.fromEntries(Object.entries(v).filter(([k, n]) => /^[0-9a-f-]{36}$/.test(k) && Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_UNITS)) as Cart;
  } catch {
    return {};
  }
}

function write(cart: Cart): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cart));
  } catch {
    // not kept past this page
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(on: () => void): () => void {
  window.addEventListener(EVENT, on);
  window.addEventListener("storage", on);
  return () => {
    window.removeEventListener(EVENT, on);
    window.removeEventListener("storage", on);
  };
}

export function useCart(): { cart: Cart; set: (id: string, units: number) => void; clear: () => void } {
  const text = useSyncExternalStore(subscribe, read, () => "{}");
  const cart = parse(text);
  const set = useCallback((id: string, units: number) => {
    const next = parse(read());
    if (units <= 0) delete next[id];
    else if (Object.keys(next).length < MAX_LINES || id in next) next[id] = Math.min(units, MAX_UNITS);
    write(next);
  }, []);
  const clear = useCallback(() => write({}), []);
  return { cart, set, clear };
}
