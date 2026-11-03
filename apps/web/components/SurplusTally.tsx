"use client";

import Link from "next/link";
import { fill } from "../lib/i18n";
import { SURPLUS } from "../lib/i18n-surplus";
import type { SourceRef } from "../lib/types";
import type { ImpactTally } from "../lib/server/surplus";
import { CannotVerify } from "./CannotVerify";
import { useLang } from "./LangProvider";
import { Figure } from "./shell/Figure";

const fig = (cell: SourceRef | null) => (cell ? <Figure cell={cell} /> : <CannotVerify />);

/**
 * The impact tally: gifts, items and their value at cost, each a Figure on a cell of the surplus.impact snapshot
 * the page minted (the page's SourcesProvider holds it). When some gift is in another currency no cell counts them all:
 * every figure is "Cannot verify" and a line says why. `manage`: where the tally sits outside the surplus page (the
 * office), a link to the recipients and the note that they are simulated.
 */
export function SurplusTally({ tally, manage = false }: { tally: ImpactTally | null; manage?: boolean }) {
  const { lang } = useLang();
  const t = SURPLUS[lang];
  return (
    <section className="ops-sec surplus-tally" aria-labelledby="surplus-tally-h">
      <h2 id="surplus-tally-h" className="ops-h">
        {t.tallyHeading}
      </h2>
      {tally ? (
        <p className="l-row">{fill(t.tallyLine, { gifts: fig(tally.gifts), items: fig(tally.items), value: fig(tally.value) })}</p>
      ) : (
        <p className="empty-line">{t.tallyNone}</p>
      )}
      {tally?.mixed && <p className="field-note">{t.tallyMixed}</p>}
      <p className="field-note">{t.tallyNote}</p>
      {manage && (
        <p className="field-note">
          {t.recipientsSimulated} <Link href="/app/surplus">{t.manage}</Link>
        </p>
      )}
    </section>
  );
}
