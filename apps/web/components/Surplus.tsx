"use client";

import { useActionState } from "react";
import { addRecipientAction } from "../app/app/surplus/actions";
import { fill } from "../lib/i18n";
import { SURPLUS } from "../lib/i18n-surplus";
import type { SurplusPage } from "../lib/server/surplus";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import { PageHead } from "./PageHead";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import { Sticker } from "./Sticker";
import { SurplusTally } from "./SurplusTally";
import "./Ops.css";

const KINDS = ["food_bank", "shelter", "community_kitchen", "animal_shelter", "other"] as const;

/**
 * Surplus for good (W2-B), an owner's or a manager's: the impact tally, each figure a cell, and the shop's recipients,
 * every one labelled simulated, with a form to list another. Giving stock happens on Home, as "Offer it" on an expiry
 * finding, and waits for an approval there.
 */
export function Surplus({ data }: { data: SurplusPage }) {
  const { lang } = useLang();
  const t = SURPLUS[lang];
  const [state, add, adding] = useActionState(addRecipientAction, null);
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={null}>
      <main className="wrap ops surplus">
        <PageHead id="surplus-h" kicker={fill(t.kicker, { shop: <span data-name="">{data.shop}</span> })} title={t.title} lede={t.lede} />
        <p className="field-note">
          <Sticker tone="yellow">{t.simulated}</Sticker> {t.simulatedNote}
        </p>
        <SurplusTally tally={data.impact} />
        <section className="ops-sec" aria-labelledby="recipients-h">
          <h2 id="recipients-h" className="ops-h">
            {t.recipientsHeading}
          </h2>
          {data.recipients.length ? (
            <ul className="surplus-recipients">
              {data.recipients.map((r) => (
                <li key={r.id} data-recipient="">
                  <span data-name="">{r.name}</span> <Sticker tone="yellow">{t.simulated}</Sticker>
                  <span className="field-note">
                    {" · "}
                    {KINDS.includes(r.kind as (typeof KINDS)[number]) ? t[`kind_${r.kind as (typeof KINDS)[number]}`] : r.kind}
                    {" · "}
                    <span data-name="">{r.area}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-line">{t.recipientsNone}</p>
          )}
        </section>
        <section className="ops-sec" aria-labelledby="add-recipient-h">
          <h2 id="add-recipient-h" className="ops-h">
            {t.addHeading}
          </h2>
          <form action={add} className="surplus-add">
            <label>
              {t.name} <input name="name" className="input" required maxLength={80} autoComplete="off" />
            </label>
            <label>
              {t.kind}{" "}
              <select name="kind" className="input" defaultValue="food_bank">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t[`kind_${k}`]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.area} <input name="area" className="input" required maxLength={80} autoComplete="off" />
            </label>
            <Button type="submit" variant="primary" disabled={adding}>
              {adding ? t.adding : t.add}
            </Button>
            <p className="field-note">
              <Sticker tone="yellow">{t.simulated}</Sticker> {t.simulatedNote}
            </p>
          </form>
          <div role="status">{state && <p className={state.ok ? "find-note" : "find-note is-no"}>{t[state.note]}</p>}</div>
        </section>
        <SourceDrawer />
      </main>
    </SourcesProvider>
  );
}
