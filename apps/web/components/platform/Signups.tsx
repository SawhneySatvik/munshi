import type { SignupAge, SignupBoard } from "@munshi/core";
import { proposePlatformChange } from "../../app/platform/actions";
import { Button } from "../Button";

const AGE: Record<SignupAge, string> = { today: "Signed up today", this_week: "Signed up this week", last_week: "Signed up over a week ago" };
const KIND: Record<string, string> = { kirana: "Kirana store", salon: "Salon", apparel: "Clothing shop" };

/**
 * The console's real shops waiting for acceptance (D-079, D-080), oldest first, and the directory's counts. Accept
 * proposes a tenant_accept change and goes to its page, where a later request approves it (the two-step rule), so the
 * acceptance is the approving operator's, chained and listed among the recent changes. A sign-up expires unaccepted
 * after two weeks; the daily purge then frees its web address.
 */
export function Signups({ board }: { board: SignupBoard }) {
  const c = board.counts;
  return (
    <section className="pc-section" aria-labelledby="pc-signups-h">
      <h2 id="pc-signups-h" className="pc-h2">
        Shops waiting for acceptance
      </h2>
      <p className="pc-meta" data-counts="">
        {`${c.waiting} waiting · ${c.accepted} accepted · ${c.expired} expired, not yet purged · ${c.samples} sample shops`}
      </p>
      <div className="l-card">
        {board.waiting.length === 0 ? <div className="l-row">No real shop is waiting.</div> : null}
        {board.waiting.map((s) => (
          <div className="l-row" key={s.tenantId} data-waiting={s.tenantId}>
            <div>
              {s.name}
              <div className="l-sub">
                {[KIND[s.businessType] ?? s.businessType, s.slug, AGE[s.age]].join(" · ")}
              </div>
            </div>
            <form action={proposePlatformChange} aria-label={`Accept ${s.slug}`}>
              <input type="hidden" name="kind" value="tenant_accept" />
              <input type="hidden" name="tenant" value={s.tenantId} />
              <input type="hidden" name="back" value="/platform" />
              <Button type="submit">Accept</Button>
            </form>
          </div>
        ))}
      </div>
    </section>
  );
}
