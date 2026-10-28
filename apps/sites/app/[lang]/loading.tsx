"use client";

import { useParams } from "next/navigation";
import { isLang, ui } from "../../lib/i18n.ts";

export default function Loading() {
  const { lang } = useParams<{ lang?: string }>();
  return (
    <main aria-busy="true">
      <p className="visually-hidden">{ui.loadingPage[lang && isLang(lang) ? lang : "en"]}</p>
    </main>
  );
}
