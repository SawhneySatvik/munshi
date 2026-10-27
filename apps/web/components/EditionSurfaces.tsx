"use client";

import { HERO } from "../lib/i18n-hero";
import { useLang } from "./LangProvider";
import { Sticker } from "./Sticker";
import "./EditionSurfaces.css";

const SURFACES = [
  ["edSettlement", "edSettlementBody"],
  ["edVoice", "edVoiceBody"],
  ["edCredit", "edCreditBody"],
  ["edGrowth", "edGrowthBody"],
] as const;

/**
 * The second edition's own screens (MUNSHI_EDITION=paytm), as placeholders: named, described, not built, carrying no
 * figure. Deliberately no company's name, logo, wordmark or colour: the edition is a config switch over the same books.
 */
export function EditionSurfaces() {
  const { lang } = useLang();
  const h = HERO[lang];
  return (
    <section className="edition" aria-labelledby="edition-h">
      <div className="edition-top">
        <h2 id="edition-h">{h.editionHeading}</h2>
        <Sticker tone="ink">{h.editionTag}</Sticker>
      </div>
      <p className="edition-note">{h.editionNote}</p>
      <ul>
        {SURFACES.map(([title, body]) => (
          <li key={title}>
            <h3>{h[title]}</h3>
            <p>{h[body]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
