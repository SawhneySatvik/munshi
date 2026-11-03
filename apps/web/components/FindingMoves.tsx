"use client";

import Link from "next/link";
import { useActionState } from "react";
import { dismissAction, fixAction, snoozeAction, whyAction } from "../app/app/findings/actions";
import type { AgentState } from "../lib/agent-types";
import type { AskTurn } from "../lib/hero-types";
import type { PaypalMode, Recipient } from "../lib/types";
import { AGENTS } from "../lib/i18n-agents";
import { PAYPAL } from "../lib/i18n-paypal";
import { ReplyBody } from "./AskView";
import { useFeatureOn } from "./AiFeatures";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import { useLentSnapshots } from "./Sources";
import { PayPalSticker } from "./PayPalSticker";
import "./FindingMoves.css";

const SNOOZE = [
  ["1", "snoozeDay"],
  ["3", "snoozeThree"],
  ["7", "snoozeWeek"],
] as const;
const DISMISS = [
  ["not_relevant", "dismissNotRelevant"],
  ["already_handled", "dismissHandled"],
  ["other", "dismissOther"],
] as const;

/**
 * A finding row's moves: "Why?" (its desk's answer, every figure a chip), "Draft the fix" (a draft for the tray, when the
 * kind has a recipe), and for an owner or a manager (`quiet`) Snooze and Dismiss. Each form names the finding ids, or the
 * card the row is (`card`: every open finding of its kind, read on the server); the person is the session's. What comes
 * back is an answer or a fixed note, never model text outside a checked answer. With `offer` (stock near its expiry) the
 * fix is "Offer it": the person picks one of the shop's recipients, each labelled simulated, or is sent to add one. With
 * `paypal` (overdue udhaar) a second fix sits beside the reminder: "Send a PayPal link", labelled PayPal sandbox,
 * or recorded (sandbox keys not set: nothing is sent to PayPal).
 */
export function FindingMoves({
  ids,
  card,
  why,
  fix,
  quiet,
  offer,
  paypal,
}: {
  ids: string[];
  card?: string | undefined;
  why: boolean;
  fix: boolean;
  quiet: boolean;
  offer?: Recipient[] | undefined;
  paypal?: PaypalMode | undefined;
}) {
  const { lang } = useLang();
  const a = AGENTS[lang];
  const p = PAYPAL[lang];
  const [asked, askWhy, asking] = useActionState(whyAction, null);
  // Why? is Ask on a finding: switched off with Ask for the shop by the operator, it is not offered.
  const askOn = useFeatureOn("ask");
  const [fixed, draftFix, drafting] = useActionState(fixAction, null);
  const [snoozed, snooze, snoozing] = useActionState(snoozeAction, null);
  const [dismissed, dismiss, dismissing] = useActionState(dismissAction, null);
  const named = card ? <input type="hidden" name="card" value={card} /> : ids.map((id) => <input key={id} type="hidden" name="finding" value={id} />);
  const moves: [string, AgentState][] = [["fix", fixed], ["snooze", snoozed], ["dismiss", dismissed], ["why", asked]];
  const notes = moves.flatMap(([move, s]) => (s && "note" in s ? [{ move, ...s }] : []));
  return (
    <div className="find-moves">
      <div className="find-moves-row">
        {why && askOn && (
          <form action={askWhy}>
            {named}
            <Button type="submit" disabled={asking}>
              {asking ? a.working : a.why}
            </Button>
          </form>
        )}
        {fix && !offer && (
          <form action={draftFix}>
            {named}
            <Button type="submit" variant="primary" disabled={drafting}>
              {drafting ? a.working : a.fix}
            </Button>
          </form>
        )}
        {fix && paypal && (
          <form action={draftFix} className="find-paypal">
            {named}
            <input type="hidden" name="fix" value="paypal" />
            <Button type="submit" disabled={drafting}>
              {drafting ? a.working : p.fixLink}
            </Button>{" "}
            <PayPalSticker mode={paypal} />
          </form>
        )}
        {fix && offer && offer.length > 0 && (
          <form action={draftFix} className="find-offer">
            {named}
            <label>
              {a.offerTo}{" "}
              <select name="recipient" defaultValue={offer[0]?.id}>
                {offer.map((r) => (
                  <option key={r.id} value={r.id}>
                    {`${r.name} · ${a.simulated}`}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="primary" disabled={drafting}>
              {drafting ? a.working : a.offer}
            </Button>
          </form>
        )}
        {fix && offer && offer.length === 0 && (
          <p className="find-note">
            {a.offerNone} <Link href="/app/surplus">{a.offerAdd}</Link>
          </p>
        )}
        {quiet && (
          <>
            <details className="find-more">
              <summary className="press">{a.snooze}</summary>
              <form action={snooze} className="find-more-list">
                {named}
                {SNOOZE.map(([days, key]) => (
                  <Button key={days} type="submit" name="days" value={days} disabled={snoozing}>
                    {a[key]}
                  </Button>
                ))}
              </form>
            </details>
            <details className="find-more">
              <summary className="press">{a.dismiss}</summary>
              <form action={dismiss} className="find-more-list">
                {named}
                {DISMISS.map(([reason, key]) => (
                  <Button key={reason} type="submit" name="reason" value={reason} disabled={dismissing}>
                    {a[key]}
                  </Button>
                ))}
              </form>
            </details>
          </>
        )}
      </div>
      <div role="status" className="find-moves-status">
        {notes.map((n) => (
          <p key={n.move} className={n.ok ? "find-note" : "find-note is-no"}>
            {a[n.note]}
          </p>
        ))}
      </div>
      {asked && "turn" in asked && <Why turn={asked.turn} />}
    </div>
  );
}

/** The desk's answer, its run's snapshots lent to the page's one drawer so each chip opens its row. */
function Why({ turn }: { turn: AskTurn }) {
  const { lang } = useLang();
  useLentSnapshots(`why-${turn.id}`, turn.snapshots);
  return (
    <section className="find-why turn" aria-label={AGENTS[lang].whyHeading}>
      <ReplyBody turn={turn} />
    </section>
  );
}
