"use client";

import type { CustomCellRendererProps } from "ag-grid-react";
import { createContext, useContext } from "react";
import { fill, fillText } from "../../lib/i18n";
import { PAYPAL } from "../../lib/i18n-paypal";
import { PAYPAL_DESK } from "../../lib/i18n-paypal-desk";
import type { DeskRow } from "../../lib/paypal-desk";
import { dayAndTime } from "../../lib/time";
import type { SourceRef } from "../../lib/types";
import { Button } from "../Button";
import { CannotVerify } from "../CannotVerify";
import { useLang } from "../LangProvider";
import { Figure } from "../shell/Figure";
import { Sticker } from "../Sticker";

export type DeskMove = "link" | "decide" | "record" | "message" | "remind";

/** What every cell shares: the page's idempotency key, the PayPal mode, and the one runner every row action goes through. */
export type DeskCtx = {
  formKey: string;
  mode: "sandbox" | "recorded";
  /** the member may start PayPal moves (paypal.request): a made link's message too */
  canSend: boolean;
  /** the member may record a payment PayPal reported (payment.record, and PayPal's notices are theirs to read) */
  canRecord: boolean;
  pending: boolean;
  run: (move: DeskMove, form: FormData) => void;
};
export const DeskContext = createContext<DeskCtx | null>(null);

function useDesk(): DeskCtx {
  const ctx = useContext(DeskContext);
  if (!ctx) throw new Error("a desk cell needs the desk around it");
  return ctx;
}

type Cell = CustomCellRendererProps<DeskRow>;

/** A figure from its stored cell, or nothing when the row has none of this kind. */
export function FigureCell({ cell }: { cell: SourceRef | null }) {
  return cell ? <Figure cell={cell} table /> : null;
}

export function NameCell({ data }: Cell) {
  if (!data) return null;
  return (
    <span className="pd-name" data-name="">
      {data.customer.name}
    </span>
  );
}

/** What they owe, and under it how much of that is past due: two cells of the same credit book row. */
export function OwesCell({ data }: Cell) {
  const d = PAYPAL_DESK[useLang().lang];
  if (!data) return null;
  if (!data.balance) return <span className="pd-quiet">{d.owesNothing}</span>;
  return (
    <span className="pd-owes">
      <FigureCell cell={data.balance} />
      <span className="pd-sub">{data.late ? fill(d.overdueSub, { amount: <FigureCell cell={data.overdue} /> }) : d.notLate}</span>
    </span>
  );
}

/** Days late is the overdue finding's own cell. A late row the morning check did not flag shows the date it fell due
 *  (its credit book cell); a late row with neither cannot be verified. */
export function DaysCell({ data }: Cell) {
  const d = PAYPAL_DESK[useLang().lang];
  if (!data?.late) return null;
  return (
    <span className="pd-days">
      {data.days ? <FigureCell cell={data.days} /> : data.since ? fill(d.sinceDate, { date: <FigureCell cell={data.since} /> }) : <CannotVerify />}
      <span className="pd-sub">{d[`bucket_${data.bucket}`]}</span>
    </span>
  );
}

export function ReminderCell({ data }: Cell) {
  const { lang } = useLang();
  const d = PAYPAL_DESK[lang];
  if (!data) return null;
  const r = data.reminder;
  if (!r) return <span className="pd-quiet">{d.reminderNone}</span>;
  if (r.status === "waiting") return <span>{d.reminderWaiting}</span>;
  return <span>{r.at ? fill(d.reminderSent, { time: <time dateTime={r.at}>{dayAndTime(r.at, lang)}</time> }) : fillText(d.reminderSent, { time: "" })}</span>;
}

/** The link's state as a pill, with the PayPal label every PayPal surface carries (sandbox, or its demo). */
export function StatePill({ data }: Cell) {
  const { lang } = useLang();
  const { mode } = useDesk();
  if (!data) return null;
  return <Pill state={data.state} mode={mode} lang={lang} />;
}

export function Pill({ state, mode, lang }: { state: DeskRow["state"]; mode: "sandbox" | "recorded"; lang: "en" | "hi" }) {
  const p = PAYPAL[lang];
  return (
    <span className={`pd-pill pd-pill-${state}`} data-state={state}>
      <span className="pd-dot" aria-hidden="true" />
      <span>{PAYPAL_DESK[lang][`state_${state}`]}</span>
      {state !== "none" && <Sticker tone="ink">{mode === "sandbox" ? p.label : p.recordedLabel}</Sticker>}
    </span>
  );
}

export function LinkAmountCell({ data }: Cell) {
  if (!data || data.state === "none") return null;
  return <FigureCell cell={data.linkAmount} />;
}

function Move({ move, fields, label, name, primary = false }: { move: DeskMove; fields: Record<string, string>; label: string; name?: string; primary?: boolean }) {
  const { formKey, pending, run } = useDesk();
  return (
    <form className="pd-move" action={(form) => run(move, form)}>
      <input type="hidden" name="key" value={formKey} />
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={pending} aria-label={name}>
        {label}
      </Button>
    </form>
  );
}

/**
 * The row's next move, each through the credit book's or the brief's own action: a draft for a person to approve, or
 * Approve / Reject on a PayPal draft for a member whose role may decide it. Nothing here writes a book row.
 */
export function NextCell({ data }: Cell) {
  const { lang } = useLang();
  const { formKey, canSend, canRecord, pending, run } = useDesk();
  const d = PAYPAL_DESK[lang];
  const p = PAYPAL[lang];
  if (!data) return null;
  const name = data.customer.name;
  const moves = [];
  for (const draft of data.drafts) {
    if (!draft.canDecide) {
      moves.push(
        <span key={draft.id} className="pd-quiet">
          {d.waitingApproval}
        </span>,
      );
      continue;
    }
    moves.push(
      <form key={draft.id} className="pd-move" action={(form) => run("decide", form)}>
        <input type="hidden" name="key" value={formKey} />
        <input type="hidden" name="draft" value={draft.id} />
        <Button type="submit" variant="primary" name="verdict" value="approved" disabled={pending} aria-label={fillText(d.approveFor, { name })}>
          {p.approve}
        </Button>
        <Button type="submit" name="verdict" value="rejected" disabled={pending} aria-label={fillText(d.rejectFor, { name })}>
          {p.reject}
        </Button>
      </form>,
    );
  }
  const link = data.link;
  if (data.unrecorded && data.state === "paid") {
    // One "record this payment" draft at a time: while one waits, its Approve stands in for the button.
    if (canRecord && !data.drafts.some((x) => x.command === "payment.record"))
      moves.push(<Move key="record" move="record" fields={{ event: data.unrecorded }} label={p.recordPayment} primary />);
  } else if (data.state === "live" && link) {
    if (canSend && link.status === "sent" && !link.messaged && !link.messageWaiting) {
      moves.push(<Move key="message" move="message" fields={{ link: link.id }} label={p.sendMessage} />);
    } else {
      moves.push(
        <span key="wait" className="pd-quiet">
          {link.messageWaiting ? d.messageWaiting : d.waitingPayment}
        </span>,
      );
    }
  }
  if (data.canLink) moves.push(<Move key="link" move="link" fields={{ customer: data.customer.id }} label={d.draftLink} name={fillText(d.draftLinkFor, { name })} primary={data.late} />);
  if (data.canRemind && data.findingId)
    moves.push(<Move key="remind" move="remind" fields={{ finding: data.findingId }} label={d.draftReminder} name={fillText(d.draftReminderFor, { name })} />);
  if (!moves.length)
    moves.push(
      <span key="none" className="pd-quiet">
        {d.nothingToDo}
      </span>,
    );
  return <div className="pd-moves">{moves}</div>;
}

/** The phone's one column: the name, what they owe and the link's state, stacked. */
export function StackCell(props: Cell) {
  const { lang } = useLang();
  const { mode } = useDesk();
  const { data } = props;
  if (!data) return null;
  return (
    <div className="pd-stack">
      <NameCell {...props} />
      <span>
        <OwesCell {...props} />
      </span>
      <Pill state={data.state} mode={mode} lang={lang} />
    </div>
  );
}
