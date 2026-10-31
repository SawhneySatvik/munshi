"use client";

import Link from "next/link";
import { HERO } from "../lib/i18n-hero";
import { useLang } from "./LangProvider";
import { Sticker } from "./Sticker";
import "./EditionSurfaces.css";

// Linked only when its page exists: next.config.ts lists the built routes at build time, so no link is a 404.
const SURFACES = [
  ["/app/settlements", "edSettlement", "edSettlementBody"],
  ["/app/teammate", "edTeammate", "edTeammateBody"],
  ["/app/growth", "edGrowth", "edGrowthBody"],
] as const;

/**
 * The second edition's own screens (MUNSHI_EDITION=paytm), each linked once its route is built, carrying no figure. Deliberately no company's name, logo, wordmark or colour: the edition is a config switch over the same books.
 */
export function EditionSurfaces() {
  const built: string[] = JSON.parse(process.env.MUNSHI_EDITION_ROUTES ?? "[]");
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
        {SURFACES.filter(([href]) => built.includes(href)).map(([href, title, body]) => (
          <li key={title}>
            <h3>
              <Link href={href}>{h[title]}</Link>
            </h3>
            <p>{h[body]}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
