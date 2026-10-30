import { consoleChange, CoreError, type PlatformValue, withOperator } from "@munshi/core";
import Link from "next/link";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "../../../../../components/Button";
import { ConsoleHead, Control, KIND_LABEL, Notice, when } from "../../../../../components/platform/Console";
import { failureLine } from "../../../../../components/platform/failure";
import { operatorOr404 } from "../../../../../lib/server/platform-session";
import { approvePlatformChange, rejectPlatformChange } from "../../../actions";

const shown = (v: PlatformValue) => (v === null ? "none" : v === true ? "true" : v === false ? "false" : String(v));

// One change (BLUEPRINT §6.5, decision 15): exactly what it would write against what is there now, read in this
// request; approving sends that diff's digest back, so core refuses it if anything moved since this page was read. A
// channel grant or an operator change also needs a fresh code from the authenticator app.
export default async function ConsoleChangePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ failed?: string | string[]; done?: string | string[]; proposed?: string | string[] }>;
}) {
  const { session, pool } = await operatorOr404(await cookies());
  const [{ id }, q] = await Promise.all([props.params, props.searchParams]);
  const { change, diff, needsCode } = await withOperator(pool, session, (c) => consoleChange(c, id)).catch((err: unknown) => {
    if (err instanceof CoreError && err.code === "not_found") notFound();
    throw err;
  });
  const failed = failureLine(q.failed);
  const target = change.slug ?? (change.tenantId ? change.tenantId : "the whole platform");
  const from = diff.from ? `${diff.from.table} row ${diff.from.id}${diff.from.changeId ? `, written by change ${diff.from.changeId}` : ""}` : "no row yet: the default";
  return (
    <>
      <ConsoleHead
        id="pc-change-h"
        kicker={`Change ${change.id}`}
        title={`${KIND_LABEL[change.kind] ?? change.kind} · ${target}`}
        lede={`Proposed by ${change.proposer}, ${when(change.proposedAt)}.`}
      />
      {q.proposed === "1" && !change.verdict ? <Notice tone="ok">Proposed. Nothing has changed yet: read the diff, then approve or reject it.</Notice> : null}
      {q.done === "approved" && change.verdict === "approved" ? <Notice tone="ok">Approved: the change is written, under your name, with its chain entries.</Notice> : null}
      {q.done === "rejected" && change.verdict === "rejected" ? <Notice tone="ok">Rejected: nothing was written.</Notice> : null}
      {failed ? <Notice tone="warn">{failed}</Notice> : null}

      <section className="pc-section" aria-labelledby="pc-diff-h">
        <h2 id="pc-diff-h" className="pc-h2">
          {change.verdict ? "What it set" : "What will change"}
        </h2>
        <div className="l-card">
          <table className="pc-diff">
            <thead>
              <tr>
                <th scope="col">Setting</th>
                <th scope="col">Now</th>
                <th scope="col">{change.verdict ? "The change" : "After approval"}</th>
              </tr>
            </thead>
            <tbody>
              {diff.fields.map((f) => (
                <tr key={f.key} className={f.before !== f.after ? "is-moved" : undefined}>
                  <td className="pc-key">{f.key}</td>
                  <td>{shown(f.before)}</td>
                  <td>{f.before === f.after ? `${shown(f.after)} (unchanged)` : shown(f.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="l-row">
            <span className="pc-ref">Now is read from {from}. After is the change's own stored payload, exactly what approval writes.</span>
          </div>
          {change.verdict ? (
            <div className="l-row">
              <div>
                <span className="pc-verdict">{change.verdict === "approved" ? "Approved" : "Rejected"}</span> by {change.decider}
              </div>
            </div>
          ) : (
            <>
              <form action={approvePlatformChange} className="pc-form" aria-label="Approve">
                <input type="hidden" name="change" value={change.id} />
                <input type="hidden" name="digest" value={diff.digest} />
                {needsCode ? (
                  <Control label="Code from your authenticator app" hint="A channel grant or an operator change needs a fresh code. Each code counts once.">
                    <input className="pc-input" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />
                  </Control>
                ) : null}
                <Button type="submit" variant="primary">
                  Approve this change
                </Button>
              </form>
              <form action={rejectPlatformChange} className="pc-form" aria-label="Reject">
                <input type="hidden" name="change" value={change.id} />
                <Button type="submit">Reject</Button>
              </form>
            </>
          )}
        </div>
      </section>
      <p>
        <Link href="/platform/changes">All changes</Link>
      </p>
    </>
  );
}
