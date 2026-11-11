"use client";

import { type ReactNode, useState, useTransition } from "react";
import { deskDecideAction, deskLinkAction, deskMessageAction, deskRecordAction, deskRemindAction } from "../../app/app/paypal/actions";
import type { PaypalActState } from "../../app/app/credit/paypal-actions";
import type { AgentState } from "../../lib/agent-types";
import { fill } from "../../lib/i18n";
import { PAYPAL } from "../../lib/i18n-paypal";
import { PAYPAL_DESK } from "../../lib/i18n-paypal-desk";
import type { PaypalDesk as Desk } from "../../lib/paypal-desk";
import { Button } from "../Button";
import { Foot } from "../Foot";
import { useNarrow } from "../grid/useNarrow";
import { useLang } from "../LangProvider";
import { OpsError } from "../OpsError";
import { PageHead } from "../PageHead";
import { messageNote } from "../PayPalLink";
import { PayPalSticker } from "../PayPalSticker";
import { Figure } from "../shell/Figure";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import { Stamp } from "../Stamp";
import { DeskContext, type DeskMove } from "./cells";
import { DeskCharts } from "./DeskCharts";
import { DeskGrid, type DeskPick } from "./DeskGrid";
import "../Ops.css";
import "./paypal-desk.css";

const PAYPAL_MOVES = { link: deskLinkAction, decide: deskDecideAction, record: deskRecordAction, message: deskMessageAction } as const;

type Outcome = { move: "remind"; state: AgentState } | { move: Exclude<DeskMove, "remind">; state: PaypalActState };

/**
 * The PayPal desk: collections on AG Grid. Who owes the shop, how late, the last reminder and where each PayPal link
 * stands, a row per customer, every figure a source chip from its stored cell (tap it: the drawer shows the row it came
 * from). The charts above stack each customer's own balance cell by age and by link state; a tap on a bar filters the
 * grid. Each row's next move is the credit book's or the brief's own action, and each one only drafts, or decides a
 * PayPal draft as a member whose role may. Payments are recorded, never processed: PayPal holds and moves the money.
 */
// formKey: this render's idempotency key (lib/server/form-key.ts), posted with every row action.
export function PaypalDesk({ data, formKey }: { data: Desk; formKey: string }) {
  const { lang, t } = useLang();
  const d = PAYPAL_DESK[lang];
  const p = PAYPAL[lang];
  const narrow = useNarrow();
  const [quick, setQuick] = useState("");
  const [pick, setPick] = useState<DeskPick>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [pending, start] = useTransition();

  const run = (move: DeskMove, form: FormData) =>
    start(async () => {
      setOutcome(move === "remind" ? { move, state: await deskRemindAction(null, form) } : { move, state: await PAYPAL_MOVES[move](null, form) });
    });

  const said = (o: Outcome | null): ReactNode => {
    if (!o?.state) return null;
    if (o.move === "remind") return "note" in o.state ? <p className="field-note">{o.state.ok ? d.reminderDrafted : d.reminderRefused}</p> : null;
    const s = o.state;
    if ("error" in s) return <OpsError code={s.error} />;
    if ("drafted" in s) return <p className="field-note">{d.linkDrafted}</p>;
    if ("decided" in s)
      return (
        <div className="done">
          <Stamp tone={s.decided === "executed" ? "approved" : "rejected"}>{t[s.decided === "executed" ? "approved" : s.decided]}</Stamp>
          <p className="field-note">{s.decided === "stale" ? p.stale : p.decided}</p>
          {s.message && <p className="field-note">{messageNote(p, s.message, data.mode)}</p>}
        </div>
      );
    return <p className="field-note">{messageNote(p, s.message, data.mode)}</p>;
  };

  const picked = pick && (pick.by === "bucket" ? d[`bucket_${pick.value}`] : d[`state_${pick.value}`]);
  return (
    <SourcesProvider snapshots={data.snapshots} deskRef={null}>
      <main className="wrap ops pd" aria-labelledby="pd-h">
        <PageHead id="pd-h" kicker={fill(d.kicker, { shop: <span data-name="">{data.shop}</span> })} title={d.title} lede={d.lede} />
        <p className="field-note pd-label">
          <PayPalSticker mode={data.mode} /> {p.neverMoves} {p.never}
        </p>
        <div className="pd-layout">
          <div className="pd-main">
            {data.total && <p className="pd-total">{fill(d.totalLine, { overdue: <Figure cell={data.total.overdue} />, customers: <Figure cell={data.total.customers} /> })}</p>}
            {data.rows.length > 0 && <DeskCharts rows={data.rows} onPick={setPick} />}
            <div className="pd-tools">
              <label className="field pd-search">
                <span className="kicker field-label">{d.search}</span>
                <input type="search" className="input" placeholder={d.searchHint} value={quick} onChange={(e) => setQuick(e.target.value)} />
              </label>
              {picked && (
                <p className="pd-picked">
                  {fill(d.showing, { what: <strong>{picked}</strong> })}{" "}
                  <Button onClick={() => setPick(null)}>{d.showAll}</Button>
                </p>
              )}
            </div>
            <div role="status" className="pd-note">
              {said(outcome)}
            </div>
            <DeskContext value={{ formKey, mode: data.mode, canSend: data.canSend, canRecord: data.canRecord, pending, run }}>
              <DeskGrid rows={data.rows} quick={quick} pick={pick} narrow={narrow} />
            </DeskContext>
            {data.more && <p className="field-note">{p.more}</p>}
          </div>
          <aside className="pd-side">
            <SourceDrawer />
          </aside>
        </div>
      </main>
      <Foot shop={data.shop} member={data.member} />
    </SourcesProvider>
  );
}
