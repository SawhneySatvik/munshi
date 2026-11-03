"use client";

import { fill } from "../../lib/i18n";
import { useLang } from "../LangProvider";
import { impactExampleIn } from "./example";
import { SITE_WORDS } from "./words";

/**
 * The sample shop's surplus tally: what it gave away before expiry instead of wasting it. Static sample figures,
 * marked data-example and labelled on screen as sample data with simulated recipients; nothing here reads or writes.
 */
export function ImpactExample() {
  const { lang } = useLang();
  const w = SITE_WORDS[lang];
  const ex = impactExampleIn(lang);
  return (
    <section className="s-example s-impact" aria-labelledby="impact-k" data-example="">
      <p className="s-kicker" id="impact-k">
        {w.impactKicker}
      </p>
      <p className="s-example-note">{w.impactNote}</p>
      <p className="s-a-text">
        {fill(w.impactLine, {
          gifts: <b>{ex.gifts}</b>,
          items: <b>{ex.items}</b>,
          value: <b>{ex.value}</b>,
          recipient: <span>{ex.recipient}</span>,
        })}
      </p>
      <p className="s-a-src">{w.impactBy}</p>
    </section>
  );
}
