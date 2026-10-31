"use client";

import { type FormEvent, startTransition, useActionState } from "react";
import { type SettleState, settleAction } from "../app/app/settlements/actions";
import { fill } from "../lib/i18n";
import { SETTLE, type SettleDict } from "../lib/i18n-settle";
import type { DayRow, SettlementsPage, StatementRow } from "../lib/server/settlements";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import { PageHead } from "./PageHead";
import { Figure } from "./shell/Figure";
import { SourceDrawer } from "./SourceDrawer";
import { SourcesProvider } from "./Sources";
import { Sticker } from "./Sticker";
import "./Ops.css";

/**
 * Settlements (P-4): the last 30 days' receipts against the payouts the books hold, every figure a cell; and a
 * statement imported from a file, previewed line by line against the books and recorded, by the owner or a manager, as
 * one command under their name. The statement's own amounts are the file's, labelled with their line. Payouts are
 * recorded, never processed.
 */
export function Settlements({ data }: { data: SettlementsPage }) {
  const { lang } = useLang();
  const t = SETTLE[lang];
  const [state, action, pending] = useActionState<SettleState, FormData>(settleAction, null);
  const preview = state && "preview" in state ? state.preview : null;
  const feed = preview?.source === "feed";
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const intent = ((e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)?.value ?? "preview";
    form.set("intent", intent);
    startTransition(() => action(form));
  };
  return (
    <SourcesProvider snapshots={[...data.snapshots, ...(preview?.snapshots ?? [])]} deskRef={null}>
      <main className="wrap ops settlements">
        <PageHead id="settle-h" kicker={fill(t.kicker, { shop: <span data-name="">{data.shop}</span> })} title={t.title} lede={t.lede} />
        <section className="ops-sec" aria-labelledby="import-h">
          <h2 id="import-h" className="ops-h">
            {t.importHeading} <Sticker tone="yellow">{t.sample}</Sticker>
          </h2>
          <p className="field-note">{t.sampleNote}</p>
          <p className="field-note">
            <Sticker tone="yellow">{t.feedLabel}</Sticker> {t.feedNote}
          </p>
          <form className="sheet" onSubmit={submit}>
            <label className="field">
              <span className="kicker field-label">{t.file}</span>
              <input className="input" type="file" name="statement" accept=".csv,.xlsx" required />
            </label>
            <div className="row">
              <Button type="submit" value="preview" disabled={pending}>
                {t.preview}
              </Button>
              <Button type="submit" value="feed" formNoValidate disabled={pending}>
                {t.feedFetch}
              </Button>
              <Button type="submit" variant="primary" value={feed ? "record-feed" : "record"} formNoValidate={feed} disabled={pending || !preview?.canRecord}>
                {t.record}
              </Button>
            </div>
          </form>
          {state && "error" in state && (
            <div className="ops-error" role="alert">
              <p>{problem(t, state.error)}</p>
              {"lines" in state && (
                <ul>
                  {state.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {preview && (
            <>
              {feed && (
                <p className="field-note">
                  <Sticker tone="yellow">{t.feedLabel}</Sticker> {t.feedPreviewing}
                </p>
              )}
              {state && "recorded" in state && state.recorded && <p className="recorded">{t.recorded}</p>}
              {preview.alreadyImported && <p className="field-note">{t.alreadyImported}</p>}
              {preview.errors.length > 0 && (
                <div className="ops-error" role="alert">
                  <p>{t.refusedLines}</p>
                  <ul>
                    {preview.errors.map((e) => (
                      <li key={`${e.line} ${e.field}`}>{fill(t.lineField, { n: String(e.line), field: e.field })}</li>
                    ))}
                  </ul>
                </div>
              )}
              <table className="settle-lines">
                <thead>
                  <tr>
                    <th scope="col">{t.colLine}</th>
                    <th scope="col">{t.colDay}</th>
                    <th scope="col">{t.colChannel}</th>
                    <th scope="col">{t.colStatement}</th>
                    <th scope="col">{t.colReceipts}</th>
                    <th scope="col">{t.colVerdict}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((l) => (
                    <LineRow key={l.line} l={l} t={t} feed={feed} />
                  ))}
                </tbody>
              </table>
              {preview.missing.length > 0 && (
                <>
                  <h3 className="ops-h">{t.missingHeading}</h3>
                  <ul>
                    {preview.missing.map((m) => (
                      <li key={`${m.day.row}`}>
                        <Figure cell={m.day} /> · {t[m.channel === "card" ? "card" : "upi"]} · <Figure cell={m.receipts} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
        <section className="ops-sec" aria-labelledby="days-h">
          <h2 id="days-h" className="ops-h">
            {t.daysHeading}
          </h2>
          {data.days.length ? (
            <table className="settle-days">
              <thead>
                <tr>
                  <th scope="col">{t.colDay}</th>
                  <th scope="col">{t.colChannel}</th>
                  <th scope="col">{t.colReceipts}</th>
                  <th scope="col">{t.colSettled}</th>
                  <th scope="col">{t.colDifference}</th>
                  <th scope="col">{t.colVerdict}</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <DayLine key={`${d.day.row}`} d={d} t={t} />
                ))}
              </tbody>
            </table>
          ) : (
            <p className="empty-line">{t.noDays}</p>
          )}
        </section>
        <SourceDrawer />
      </main>
    </SourcesProvider>
  );
}

const VERDICTS = ["matched", "short", "over", "missing", "already_recorded"] as const;
const verdictOf = (t: SettleDict, v: string) => ((VERDICTS as readonly string[]).includes(v) ? t[v as (typeof VERDICTS)[number]] : v);

function LineRow({ l, t, feed }: { l: StatementRow; t: SettleDict; feed: boolean }) {
  return (
    <tr>
      <td>{l.line}</td>
      <td>{l.txnDate}</td>
      <td>{t[l.channel]}</td>
      <td title={fill(feed ? t.feedLine : t.statementLine, { n: String(l.line) }).join("")}>{l.net}</td>
      <td>{l.receipts ? <Figure cell={l.receipts} table /> : "—"}</td>
      <td>
        <Sticker tone={l.verdict === "matched" || l.verdict === "already_recorded" ? "ink" : "flag"}>{verdictOf(t, l.verdict)}</Sticker>
        {l.status === "ON_HOLD" && <Sticker tone="yellow">{t.onHold}</Sticker>}
      </td>
    </tr>
  );
}

function DayLine({ d, t }: { d: DayRow; t: SettleDict }) {
  return (
    <tr>
      <td>
        <Figure cell={d.day} table />
      </td>
      <td>{t[d.channel === "card" ? "card" : "upi"]}</td>
      <td>
        <Figure cell={d.receipts} table />
      </td>
      <td>{d.settled ? <Figure cell={d.settled} table /> : "—"}</td>
      <td>
        <Figure cell={d.difference} table />
      </td>
      <td>
        <Sticker tone={d.verdict === "matched" ? "ink" : "flag"}>{verdictOf(t, d.verdict)}</Sticker>
      </td>
    </tr>
  );
}

function problem(t: SettleDict, e: string): string {
  const by: Record<string, string> = {
    missing: t.errMissing,
    big: t.errBig,
    long: t.errLong,
    type: t.errType,
    unreadable: t.errUnreadable,
    refused: t.errRefused,
    signed_out: t.errSignedOut,
    invalid: t.refusedLines,
    feed_empty: t.errFeedEmpty,
  };
  return by[e] ?? t.errOther;
}
