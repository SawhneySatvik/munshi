"use client";

// The BP-APP screens' shared parts in Neem Ledger (styles/base.css's .l-group/.l-card/.l-row/.l-amt): the page frame
// (the ledger strip's head, the record on the left, forms and the source panel on the right, the footer), a group of
// ruled rows, a form that runs one server action with its own idempotency key, and the small marks a row carries. A
// figure is always a <Figure cell={ref}>; a code, a name or a time from the books is marked as such (data-name, <time>).
import { type ReactNode, useActionState } from "react";
import type { ActState, Frame } from "../../lib/app-types";
import { APP } from "../../lib/i18n-app";
import { calendarDate, dayAndTime } from "../../lib/time";
import { Button } from "../Button";
import { Foot } from "../Foot";
import { useLang } from "../LangProvider";
import { OpsError } from "../OpsError";
import { PageHead } from "../PageHead";
import { SourceDrawer } from "../SourceDrawer";
import { SourcesProvider } from "../Sources";
import "../Ops.css";
import "./app.css";

export function Screen(props: { frame: Frame; id: string; kicker: ReactNode; title: ReactNode; lede: ReactNode; children: ReactNode; aside?: ReactNode }) {
  const { frame } = props;
  return (
    <SourcesProvider snapshots={frame.snapshots} deskRef={null}>
      <main className="wrap ops app-screen">
        <div className="ops-a">
          <PageHead id={props.id} kicker={props.kicker} title={props.title} lede={props.lede} />
          {props.children}
        </div>
        <div className="ops-b">
          {props.aside}
          <SourceDrawer />
        </div>
      </main>
      <Foot shop={frame.shop} member={frame.member} />
    </SourcesProvider>
  );
}

/** A titled group of ruled rows on one surface card; `empty` stands in for no rows. */
export function Group({ id, title, note, children, empty }: { id: string; title: ReactNode; note?: ReactNode; children?: ReactNode; empty?: ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean).length > 0 : Boolean(children);
  return (
    <section className="l-group app-group" aria-labelledby={id}>
      <h2 id={id} className="l-head">
        {title}
      </h2>
      {note && <p className="app-note">{note}</p>}
      <div className="l-card">{rows ? children : <p className="l-row app-empty">{empty}</p>}</div>
    </section>
  );
}

/** One ledger row: its words on the left (a title and a quieter line under it), its figure on the rail. */
export function Row({ title, sub, amt, children, lead, href }: { title: ReactNode; sub?: ReactNode; amt?: ReactNode; children?: ReactNode; lead?: boolean; href?: string }) {
  const words = (
    <div className="app-words">
      <p className="app-title">{href ? <a href={href}>{title}</a> : title}</p>
      {sub && <p className="l-sub">{sub}</p>}
      {children}
    </div>
  );
  return (
    <div className={`l-row${lead ? " l-lead" : ""}`}>
      {words}
      <div className="l-amt">{amt}</div>
    </div>
  );
}

/** A code or a name the books hold (an offer code, an invoice series, a GSTIN): an identifier, never a figure. */
export const Name = ({ children }: { children: ReactNode }) => (
  <span data-name="" className="app-name">
    {children}
  </span>
);

/** A moment the books stamped, in the shop's zone. */
export function When({ at, day = false }: { at: string; day?: boolean }) {
  const { lang } = useLang();
  return <time dateTime={at}>{day ? calendarDate(at.slice(0, 10), lang) : dayAndTime(at, lang)}</time>;
}

/** A tag on a row: a state, a kind ("In effect", "Ended", "Stitching"). */
export const Tag = ({ tone = "ink", children }: { tone?: "ink" | "ok" | "warn"; children: ReactNode }) => <span className={`app-tag app-tag-${tone}`}>{children}</span>;

type Action = (prev: ActState, form: FormData) => Promise<ActState>;

/**
 * A form that runs one server action. It carries its own idempotency key, the page's render key with `tag` (so two
 * forms on one page never share one); the action refuses a form without it. `inline` sits in a row; otherwise it is
 * the paper sheet. The outcome shows under it in the screen's words; the page itself re-renders from the books.
 */
export function ActForm(props: {
  action: Action;
  formKey: string;
  tag: string;
  submit: ReactNode;
  children?: ReactNode;
  title?: ReactNode;
  inline?: boolean;
  primary?: boolean;
  label?: string;
  disabled?: boolean;
}) {
  const { lang } = useLang();
  const [state, run, pending] = useActionState(props.action, null);
  return (
    <form action={run} className={props.inline ? "act act-inline" : "sheet act"} aria-label={props.label}>
      <input type="hidden" name="key" value={`${props.formKey}-${props.tag}`} />
      {props.title && <h2 className="act-title">{props.title}</h2>}
      {props.children}
      <Button type="submit" variant={props.primary ? "primary" : "secondary"} disabled={pending || props.disabled}>
        {props.submit}
      </Button>
      <div role="status" className="act-status">
        {state && "error" in state && <OpsError code={state.error} />}
        {state && "done" in state && <p className="act-done">{APP[lang].done}</p>}
      </div>
    </form>
  );
}

/** A labelled field around an input or a select. */
export function Field({ label, children, note }: { label: ReactNode; children: ReactNode; note?: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: the control is the child passed in (an input or a select)
    <label className="field">
      <span className="kicker field-label">{label}</span>
      {children}
      {note && <span className="field-note">{note}</span>}
    </label>
  );
}

/** "Switched off" and "Recorded · nothing is sent": labels that are part of the feature (BLUEPRINT §9.5). */
export const Label = ({ children }: { children: ReactNode }) => <span className="sticker sticker-yellow">{children}</span>;

/** The section links a screen opens beside its own (a branch, a month, a day). */
export function Tabs({ items, label }: { items: { href: string; text: ReactNode; on: boolean }[]; label: string }) {
  return (
    <nav className="app-tabs" aria-label={label}>
      {items.map((i) => (
        <a key={i.href} href={i.href} aria-current={i.on ? "page" : undefined} className={i.on ? "is-on" : undefined}>
          {i.text}
        </a>
      ))}
    </nav>
  );
}
