import { consoleDefaults, withOperator } from "@munshi/core";
import { cookies } from "next/headers";
import { Button } from "../../../../components/Button";
import { ConsoleHead, Control, Notice, NumberInput, OnOffSelect, onOff, SetBy } from "../../../../components/platform/Console";
import { failureLine } from "../../../../components/platform/failure";
import { operatorOr404 } from "../../../../lib/server/platform-session";
import { proposePlatformChange } from "../../actions";

const NONE = "no approved change has set the demo defaults: the sample shops have AI off.";

// The demo shops' default config (the sample and showcase shops, sandboxes included, take it unless a shop has its own
// config) and the reserved slugs, each beside the change that set it, and a proposal for each.
export default async function ConsoleDefaultsPage(props: { searchParams: Promise<{ failed?: string | string[] }> }) {
  const { session, pool } = await operatorOr404(await cookies());
  const q = await props.searchParams;
  const { defaults: d, slugs } = await withOperator(pool, session, (c) => consoleDefaults(c));
  const failed = failureLine(q.failed);
  const rows: [string, string][] = d
    ? [
        ["AI", onOff(d.aiEnabled)],
        ["Text calls a day, each shop", String(d.aiDailyCalls)],
        ["Media calls a day, each shop", String(d.mediaDailyCalls)],
        ["Media calls a day, all sandboxes together", String(d.sandboxMediaDailyCallsTotal)],
      ]
    : [];
  return (
    <>
      <ConsoleHead
        id="pc-defaults-h"
        kicker="Demo deployment"
        title="Demo defaults and slugs"
        lede="The demo's sample shops take these unless a shop has its own config. A reserved slug keeps a name from self-serve sign-up."
      />
      {failed ? <Notice tone="warn">{failed}</Notice> : null}
      <section className="pc-section" aria-labelledby="pc-dc-h">
        <h2 id="pc-dc-h" className="pc-h2">
          Demo default config
        </h2>
        <div className="l-card">
          {d ? (
            rows.map(([k, v]) => (
              <div className="l-row" key={k}>
                <div>
                  {k}
                  <SetBy from={d.from} none={NONE} />
                </div>
                <span className="pc-row-v">{v}</span>
              </div>
            ))
          ) : (
            <div className="l-row">
              <SetBy from={null} none={NONE} />
            </div>
          )}
          <form action={proposePlatformChange} className="pc-form" aria-label="Propose demo defaults">
            <input type="hidden" name="kind" value="default_config" />
            <input type="hidden" name="back" value="/platform/defaults" />
            <h3 className="pc-h2">Propose new defaults</h3>
            <div className="pc-form-grid">
              <Control label="AI">
                <OnOffSelect name="ai_enabled" value={d?.aiEnabled ?? false} />
              </Control>
              <Control label="Text calls a day" hint="0 to 2000">
                <NumberInput name="ai_daily_calls" value={d?.aiDailyCalls ?? 0} max={2000} />
              </Control>
              <Control label="Media calls a day" hint="0 to 500">
                <NumberInput name="media_daily_calls" value={d?.mediaDailyCalls ?? 0} max={500} />
              </Control>
              <Control label="Sandboxes' media calls a day, together" hint="0 to 5000">
                <NumberInput name="sandbox_media_daily_calls_total" value={d?.sandboxMediaDailyCallsTotal ?? 0} max={5000} />
              </Control>
            </div>
            <Button type="submit">Propose</Button>
          </form>
        </div>
      </section>

      <section className="pc-section" aria-labelledby="pc-slugs-h">
        <h2 id="pc-slugs-h" className="pc-h2">
          Reserved slugs
        </h2>
        <div className="l-card">
          {slugs.length ? (
            slugs.map((s) => (
              <div className="l-row" key={s.slug}>
                <div>
                  <span className="pc-key">{s.slug}</span>
                  {s.note ? <div className="l-sub">{s.note}</div> : null}
                  <SetBy from={s} none="reserved by the schema, not by a change." />
                </div>
              </div>
            ))
          ) : (
            <div className="l-row">
              <span className="pc-meta">No slug is reserved yet.</span>
            </div>
          )}
          <form action={proposePlatformChange} className="pc-form" aria-label="Reserve a slug">
            <input type="hidden" name="kind" value="reserved_slug" />
            <input type="hidden" name="back" value="/platform/defaults" />
            <h3 className="pc-h2">Reserve a slug</h3>
            <div className="pc-form-grid">
              <Control label="Slug" hint="3 to 40: a lower case letter, then letters, digits or -">
                <input name="slug" required className="pc-input" pattern="[a-z][a-z0-9\-]{2,39}" />
              </Control>
              <Control label="Note" hint="Optional, up to 64 characters">
                <input name="note" className="pc-input" maxLength={64} />
              </Control>
            </div>
            <Button type="submit">Propose</Button>
          </form>
        </div>
      </section>
    </>
  );
}
