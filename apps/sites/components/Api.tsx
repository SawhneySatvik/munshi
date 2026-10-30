"use client";

// The browser's API settings (base, publishable key, slug), handed down from the server once per page, and the SDK
// client made from them. The key is a publishable key: made to sit in a public page.
import { type Client, createClient } from "@munshi/sdk";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { BrowserApi } from "../lib/api.ts";

const ApiContext = createContext<BrowserApi | null>(null);

export function ApiProvider({ api, children }: { api: BrowserApi; children: ReactNode }) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

export function useApi(): { slug: string; client: Client; writable: boolean } {
  const api = useContext(ApiContext);
  if (!api) throw new Error("apps/sites: a component that calls the API sits outside ApiProvider");
  return useMemo(
    () => ({ slug: api.slug, client: createClient({ baseUrl: api.base, ...(api.key ? { key: api.key } : {}) }), writable: api.key !== null }),
    [api],
  );
}
