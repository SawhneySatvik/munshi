"use client";

import { useActionState } from "react";
import { dismissAction, fixAction, snoozeAction, whyAction } from "../app/app/findings/actions";
import type { AgentState } from "../lib/agent-types";
import type { AskTurn } from "../lib/hero-types";
import { AGENTS } from "../lib/i18n-agents";
import { ReplyBody } from "./AskView";
import { Button } from "./Button";
import { useLang } from "./LangProvider";
import { useLentSnapshots } from "./Sources";
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
 * back is an answer or a fixed note, never model text outside a checked answer.
 */
export function FindingMoves({ ids, card, why, fix, quiet }: { ids: string[]; card?: string | undefined; why: boolean; fix: boolean; quiet: boolean }) {
  const { lang } = useLang();
  const a = AGENTS[lang];
  const [asked, askWhy, asking] = useActionState(whyAction, null);
  const [fixed, draftFix, drafting] = useActionState(fixAction, null);
  const [snoozed, snooze, snoozing] = useActionState(snoozeAction, null);
  const [dismissed, dismiss, dismissing] = useActionState(dismissAction, null);
  const named = card ? <input type="hidden" name="card" value={card} /> : ids.map((id) => <input key={id} type="hidden" name="finding" value={id} />);
  const moves: [string, AgentState][] = [["fix", fixed], ["snooze", snoozed], ["dismiss", dismissed], ["why", asked]];
  const notes = moves.flatMap(([move, s]) => (s && "note" in s ? [{ move, ...s }] : []));
  return (
    <div className="find-moves">
      <div className="find-moves-row">
        {why && (
          <form action={askWhy}>
            {named}
            <Button type="submit" disabled={asking}>
              {asking ? a.working : a.why}
            </Button>
          </form>
        )}
        {fix && (
          <form action={draftFix}>
            {named}
            <Button type="submit" variant="primary" disabled={drafting}>
              {drafting ? a.working : a.fix}
            </Button>
          </form>
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
