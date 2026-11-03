import { listOperators, withOperator } from "@munshi/core";
import Link from "next/link";
import { cookies } from "next/headers";
import { Button } from "../../../../components/Button";
import { ConsoleHead, Control, changeHref, Notice, SetBy, when } from "../../../../components/platform/Console";
import { failureLine } from "../../../../components/platform/failure";
import { UUID_TEXT } from "../../../../lib/parse";
import { operatorOr404 } from "../../../../lib/server/platform-session";
import { proposePlatformChange } from "../../actions";

// The operators: each beside the approved change that added it (the first one is the seed's, which no
// change wrote), the operator changes waiting for a decision, and two proposals: add an identity as an operator, or
// deactivate one. Proposing changes nothing; an addition is approved with `pnpm platform:approve`, a deactivation on
// its change page, each with a fresh code.
export default async function ConsoleOperatorsPage(props: { searchParams: Promise<{ failed?: string | string[]; kind?: string | string[] }> }) {
  const { session, pool } = await operatorOr404(await cookies());
  const q = await props.searchParams;
  const { operators, pending } = await withOperator(pool, session, (c) => listOperators(c));
  const failed = failureLine(q.failed, q.kind);
  return (
    <>
      <ConsoleHead
        id="pc-ops-h"
        kicker="Superadmins"
        title="Operators"
        lede="Who may approve platform changes. An operator's identity is never a shop member, and every addition or removal is an approved change."
      />
      {failed ? <Notice tone="warn">{failed}</Notice> : null}
      <section className="pc-section" aria-labelledby="pc-ops-list-h">
        <h2 id="pc-ops-list-h" className="pc-h2">
          Operators
        </h2>
        <div className="l-card">
          {operators.map((o) => (
            <div className="l-row" key={o.id} data-operator={o.id}>
              <div>
                {o.displayName}
                {o.id === session.operatorId ? " (you)" : ""}
                <div className="l-sub">
                  <span className="pc-id">{o.id}</span> · {o.active ? "Active" : "Deactivated"} · since {when(o.createdAt)}
                </div>
                <SetBy from={o.addedBy ? { changeId: o.addedBy } : null} none="the first operator, seeded from the command line, not by a change." />
              </div>
              {o.active ? (
                <form action={proposePlatformChange} className="pc-form" aria-label={`Propose deactivating ${o.displayName}`}>
                  <input type="hidden" name="kind" value="operator" />
                  <input type="hidden" name="back" value="/platform/operators" />
                  <input type="hidden" name="deactivate" value={o.id} />
                  <Button type="submit">Propose deactivating</Button>
                </form>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="pc-section" aria-labelledby="pc-ops-pending-h">
        <h2 id="pc-ops-pending-h" className="pc-h2">
          Waiting for a decision
        </h2>
        <div className="l-card">
          {pending.length ? (
            pending.map((p) => (
              <div className="l-row" key={p.changeId} data-pending={p.changeId}>
                <div>
                  {p.deactivates ? `Deactivate operator ${p.deactivates}` : `Add ${p.displayName ?? ""} (identity ${p.subject ?? ""})`}
                  <div className="l-sub">Proposed {when(p.proposedAt)}</div>
                </div>
                <Link href={changeHref(p.changeId)} className="pc-id">
                  {p.changeId}
                </Link>
              </div>
            ))
          ) : (
            <div className="l-row">
              <span className="pc-meta">No operator change is waiting.</span>
            </div>
          )}
        </div>
      </section>

      <section className="pc-section" aria-labelledby="pc-ops-add-h">
        <h2 id="pc-ops-add-h" className="pc-h2">
          Propose an operator
        </h2>
        <div className="l-card">
          <div className="l-row">
            <span className="pc-ref">
              The identity comes first, from the command line: <code>pnpm platform:identity</code> makes a password identity and writes its subject to a
              file only you can read. Approve the proposal with <code>pnpm platform:approve</code> and a fresh code: it writes the new operator's
              authenticator URI to a file, once.
            </span>
          </div>
          <form action={proposePlatformChange} className="pc-form" aria-label="Propose an operator">
            <input type="hidden" name="kind" value="operator" />
            <input type="hidden" name="back" value="/platform/operators" />
            <div className="pc-form-grid">
              <Control label="Identity subject" hint="The subject pnpm platform:identity wrote">
                <input
                  name="subject"
                  required
                  className="pc-input"
                  pattern={UUID_TEXT}
                  autoComplete="off"
                />
              </Control>
              <Control label="Display name" hint="1 to 40: letters, digits, spaces or _.:-">
                <input name="display_name" required className="pc-input" maxLength={40} pattern="[A-Za-z0-9 _.:\-]{1,40}" />
              </Control>
            </div>
            <Button type="submit">Propose</Button>
          </form>
        </div>
      </section>
    </>
  );
}
