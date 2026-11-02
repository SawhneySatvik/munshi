"use client";

import { PWA } from "../../lib/i18n-pwa";
import { useLang } from "../LangProvider";
import "./pwa.css";

/** The credit Muse Spark Open's licence asks for (the platform design §7): on the AI staff page and the site's foot. */
export function MuseCredit({ className = "muse-credit" }: { className?: string }) {
  const { lang } = useLang();
  return (
    <p className={className} lang={lang}>
      {PWA[lang].builtWithMuse}
    </p>
  );
}
