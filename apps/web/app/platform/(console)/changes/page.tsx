import { type ConsoleChange, consoleLog, withOperator } from "@munshi/core";
import Link from "next/link";
import { cookies } from "next/headers";
import { ChainLine, ConsoleHead, changeHref, KIND_LABEL, when } from "../../../../components/platform/Console";
import { operatorOr404 } from "../../../../lib/server/platform-session";

function Row({ ch }: { ch: ConsoleChange }) {
  return (
    <div className="l-row">
      <div>
        <Link href={changeHref(ch.id)}>{KIND_LABEL[ch.kind] ?? ch.kind}</Link> · {ch.slug ?? (ch.tenantId ? ch.tenantId : "global")}
        <div className="l-sub">
          proposed by {ch.proposer}, {when(ch.proposedAt)}
          {ch.decider ? ` · ${ch.verdict} by ${ch.decider}` : ""}
        </div>
        <span className="pc-ref">
          change <span className="pc-id">{ch.id}</span>
        </span>
      </div>
      <span className="pc-row-v">{ch.verdict ? ch.verdict.charAt(0).toUpperCase() + ch.verdict.slice(1) : "Pending"}</span>
    </div>
  );
}

// The platform change log, newest first, pending ones on top, and whether the platform chain verifies.
export default async function ConsoleChangesPage() {
  const { session, pool } = await operatorOr404(await cookies());
  const log = await withOperator(pool, session, (c) => consoleLog(c));
  const pending = log.changes.filter((c) => c.verdict === null);
  const decided = log.changes.filter((c) => c.verdict !== null);
  return (
    <>
      <ConsoleHead id="pc-changes-h" kicker="The platform change log" title="Changes" lede="Every proposal and its decision. A pending change applies only when you approve it on its own page." />
      <ChainLine brokenAt={log.chainBrokenAt} />
      <section className="pc-section" aria-labelledby="pc-pending-h">
        <h2 id="pc-pending-h" className="pc-h2">
          Waiting for a decision
        </h2>
        <div className="l-card">
          {pending.length ? (
            pending.map((ch) => <Row key={ch.id} ch={ch} />)
          ) : (
            <div className="l-row">
              <span className="pc-meta">Nothing is waiting.</span>
            </div>
          )}
        </div>
      </section>
      <section className="pc-section" aria-labelledby="pc-decided-h">
        <h2 id="pc-decided-h" className="pc-h2">
          Decided
        </h2>
        <div className="l-card">
          {decided.length ? decided.map((ch) => <Row key={ch.id} ch={ch} />) : <div className="l-row"><span className="pc-meta">No change has been decided yet.</span></div>}
        </div>
      </section>
    </>
  );
}
