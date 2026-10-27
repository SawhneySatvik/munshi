"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { DICT, type Dict, LANG_COOKIE } from "../lib/i18n";
import type { Lang } from "../lib/types";

type LangState = { lang: Lang; t: Dict; setLang: (next: Lang) => void };

const LangContext = createContext<LangState | null>(null);

/** Holds the EN/हिंदी choice. The server reads the same cookie, so a reload renders in the chosen language. */
export function LangProvider({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState(initial);
  const setLang = (next: Lang) => {
    setLangState(next);
    document.documentElement.lang = next;
    // biome-ignore lint/suspicious/noDocumentCookie: one non-secret preference; the Cookie Store API is not in every browser the shop uses.
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  };
  return <LangContext value={{ lang, t: DICT[lang], setLang }}>{children}</LangContext>;
}

export function useLang(): LangState {
  const state = useContext(LangContext);
  if (!state) throw new Error("useLang needs a LangProvider above it");
  return state;
}
