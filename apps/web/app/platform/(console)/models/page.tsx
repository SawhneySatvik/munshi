import { KNOWN_ALIASES } from "@munshi/agent";
import { modelAllowList, withOperator } from "@munshi/core";
import { cookies } from "next/headers";
import { Button } from "../../../../components/Button";
import { ConsoleHead, Control, Notice, OnOffSelect, onOff, SetBy } from "../../../../components/platform/Console";
import { failureLine } from "../../../../components/platform/failure";
import { operatorOr404 } from "../../../../lib/server/platform-session";
import { proposeModelAllow } from "./actions";

const NONE = "no approved change wrote this row.";
const PAIRS = Object.entries(KNOWN_ALIASES).flatMap(([alias, roles]) => roles.map((role) => `${alias}|${role}`));

// The model allow-list (P-5): the latest row per (alias, role), each beside the change that set it, a proposal to switch
// one off (or on again), and a proposal for any (alias, role) this build serves. Every row is an approved platform
// change, approved on its own page in a later request.
export default async function ConsoleModelsPage(props: { searchParams: Promise<{ failed?: string | string[] }> }) {
  const { session, pool } = await operatorOr404(await cookies());
  const q = await props.searchParams;
  const rows = await withOperator(pool, session, (c) => modelAllowList(c));
  const failed = failureLine(q.failed);
  return (
    <>
      <ConsoleHead
        id="pc-models-h"
        kicker="Every shop"
        title="Model allow-list"
        lede="The models shops may pick for each role, by alias. A shop's owner chooses per desk from the ones switched on; a desk with none left shows its template."
      />
      {failed ? <Notice tone="warn">{failed}</Notice> : null}
      <section className="pc-section" aria-labelledby="pc-allow-h">
        <h2 id="pc-allow-h" className="pc-h2">
          Allowed models
        </h2>
        <div className="l-card">
          {rows.length ? (
            rows.map((r) => (
              <div className="l-row" key={`${r.alias}|${r.role}`}>
                <div>
                  <span className="pc-key">{r.alias}</span> · {r.role}
                  {Object.hasOwn(KNOWN_ALIASES, r.alias) ? null : <div className="l-sub">This build does not serve this alias: no shop can use it here.</div>}
                  <SetBy from={r.from} none={NONE} />
                </div>
                <span className="pc-row-v">{onOff(r.enabled)}</span>
                <form action={proposeModelAllow} aria-label={`Switch ${r.alias} for ${r.role} ${r.enabled ? "off" : "on"}`}>
                  <input type="hidden" name="alias" value={r.alias} />
                  <input type="hidden" name="role" value={r.role} />
                  <input type="hidden" name="enabled" value={r.enabled ? "false" : "true"} />
                  <Button type="submit">{r.enabled ? "Propose off" : "Propose on"}</Button>
                </form>
              </div>
            ))
          ) : (
            <div className="l-row">
              <span className="pc-meta">No model is allowed yet: every AI desk shows its template.</span>
            </div>
          )}
          <form action={proposeModelAllow} className="pc-form" aria-label="Propose a model">
            <h3 className="pc-h2">Propose a model</h3>
            <div className="pc-form-grid">
              <Control label="Alias and role" hint="Only the models this build serves">
                <select name="pair" className="pc-input" defaultValue={PAIRS[0]}>
                  {PAIRS.map((p) => (
                    <option key={p} value={p}>
                      {p.replace("|", " · ")}
                    </option>
                  ))}
                </select>
              </Control>
              <Control label="Allowed">
                <OnOffSelect name="enabled" value={true} />
              </Control>
            </div>
            <Button type="submit">Propose</Button>
          </form>
        </div>
      </section>
    </>
  );
}
