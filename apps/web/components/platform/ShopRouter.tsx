import { DOCUMENT_ALIAS, KNOWN_ALIASES } from "@munshi/ai";
import type { ConsoleShop } from "@munshi/core";
import { proposePlatformChange } from "../../app/platform/actions";
import { Button } from "../Button";
import { Control, onOff, SetBy } from "./Console";

// The superadmin's router for one shop and its AI budget, on the console's shop page. Each form writes
// one pending platform change of its kind ({alias, role, allowed, is_default}, {feature, enabled}, {monthly_minor,
// currency}); nothing takes effect until a later request approves it (approvePlatformChange). What is shown is the
// effective state now, each value beside the change that set it, and whose list governs a role: the shop's own once it
// has any row for the role, else the deployment's allow-list.

const FEATURE_LABEL: Record<string, string> = {
  ask: "Ask and Why?",
  photos: "Shelf and bill photos",
  voice: "Voice (spoken questions, voice notes)",
  read_aloud: "Read aloud",
  narration: "Morning brief narration",
  campaign_copy: "Campaign copy",
  inbox_drafts: "Inbox drafts (reply, order)",
  memory: "Keeper's notes (memory)",
};

const hidden = (shop: ConsoleShop, kind: string) => (
  <>
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="tenant" value={shop.tenantId} />
    <input type="hidden" name="back" value={`/platform/shops/${shop.tenantId}`} />
  </>
);

/** Per role: whose list governs, the shop's default, each alias's state, and a form to set one alias on the shop's list. */
export function ModelsPanel({ shop }: { shop: ConsoleShop }) {
  return (
    <section className="pc-section" aria-labelledby="pc-models-h" data-slot="shop-models">
      <h2 id="pc-models-h" className="pc-h2">
        Models
      </h2>
      <p className="pc-meta">
        A role with no row of this shop's takes the deployment's allow-list. Once the shop has a row for a role, only the aliases allowed on its own
        list answer, and the deployment's list still bounds them.
      </p>
      {/* A PDF bill goes to the document reader's job API, not a chat model: no list here governs it. */}
      <p className="pc-meta" data-slot="pdf-bills">
        PDF bills always use the document reader {DOCUMENT_ALIAS}; this list does not govern them. Photo bills use the vision role below.
      </p>
      {shop.router.map((r) => {
        const known = Object.keys(KNOWN_ALIASES).filter((a) => (KNOWN_ALIASES[a] as readonly string[]).includes(r.role));
        return (
          <div className="l-card" key={r.role} data-role={r.role} data-source={r.source}>
            <h3 className="pc-h2">
              {r.role} · {r.source === "shop" ? "the shop's list" : "the deployment's list"}
              {r.shopDefault ? ` · default ${r.shopDefault}` : " · the build's default"}
            </h3>
            {r.aliases.map((a) => (
              <div className="l-row" key={a.alias} data-alias={a.alias} data-usable={a.usable ? "yes" : "no"}>
                <div>
                  {a.alias}
                  <div className="l-sub">
                    deployment {a.deployment ? "enables it" : "has it off"}
                    {a.shop ? ` · shop list: ${a.shop.allowed ? "allowed" : "not allowed"}${a.shop.isDefault ? ", default" : ""}` : " · not on the shop's list"}
                  </div>
                  {a.shop ? <SetBy from={a.shop.from} none="" /> : null}
                </div>
                <span className="pc-row-v">{a.usable ? "Usable" : "Off"}</span>
              </div>
            ))}
            <form action={proposePlatformChange} className="pc-form" aria-label={`Shop models for ${r.role}`}>
              {hidden(shop, "shop_models")}
              <input type="hidden" name="role" value={r.role} />
              <div className="pc-form-grid">
                <Control label="Alias">
                  <select name="alias" className="pc-input" required defaultValue="">
                    <option value="" disabled>
                      Pick an alias
                    </option>
                    {known.map((alias) => (
                      <option key={alias} value={alias}>
                        {alias}
                      </option>
                    ))}
                  </select>
                </Control>
                <Control label="On the shop's list">
                  <select name="allowed" defaultValue="true" className="pc-input">
                    <option value="true">Allowed</option>
                    <option value="false">Not allowed</option>
                  </select>
                </Control>
                <Control label="The shop's default for the role" hint="Only an allowed alias can be the default">
                  <select name="is_default" defaultValue="false" className="pc-input">
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </Control>
              </div>
              <Button type="submit">Propose</Button>
            </form>
          </div>
        );
      })}
    </section>
  );
}

/** The eight AI features, each with its switch now (no row: on) and a proposal to flip it. */
export function FeaturesPanel({ shop }: { shop: ConsoleShop }) {
  return (
    <section className="pc-section" aria-labelledby="pc-features-h" data-slot="shop-features">
      <h2 id="pc-features-h" className="pc-h2">
        Features
      </h2>
      <p className="pc-meta">
        A feature is usable only while the shop has AI ({onOff(shop.limits.aiEnabled)} now) and its own switch is on. A feature switched off is hidden or
        labelled in the shop's app, and its action is refused.
      </p>
      <div className="l-card">
        {shop.features.map((f) => (
          <div className="l-row" key={f.feature} data-feature={f.feature} data-enabled={f.enabled ? "on" : "off"}>
            <div>
              {FEATURE_LABEL[f.feature] ?? f.feature}
              <SetBy from={f.from} none="no approved change has switched it: on." />
            </div>
            <form action={proposePlatformChange} className="pc-row-v" aria-label={`Switch ${f.feature}`}>
              {hidden(shop, "shop_features")}
              <input type="hidden" name="feature" value={f.feature} />
              <input type="hidden" name="enabled" value={f.enabled ? "false" : "true"} />
              <span>{onOff(f.enabled)} </span>
              <Button type="submit">{f.enabled ? "Propose off" : "Propose on"}</Button>
            </form>
          </div>
        ))}
      </div>
    </section>
  );
}

/** The shop's monthly AI budget, in whole US cents (empty: no money cap). */
export function BudgetForm({ shop }: { shop: ConsoleShop }) {
  const s = shop.spend;
  return (
    <form action={proposePlatformChange} className="pc-form" aria-label="Monthly AI budget" data-slot="shop-budget">
      {hidden(shop, "ai_budget")}
      <h3 className="pc-h2">Monthly AI budget</h3>
      <p className="pc-meta">
        The cap counts priced calls only: a call whose model has no price, or whose provider reports no usage, adds nothing to the spend and is
        never refused by the cap. From most of the budget the owner sees a banner; once the priced spend reaches it, every model call is refused
        until next month (the brief keeps its template; watchers make no model call).
      </p>
      <p className="pc-meta" data-slot="unpriced-share">
        This month: {s.unpricedCalls} of {s.calls} calls have no price and are not counted against the budget.
      </p>
      <Control label="US cents a month" hint="0 to 100000 (US$1,000); empty for no money cap">
        <input name="monthly_minor" type="number" min={0} max={100000} step={1} defaultValue={s.budgetMinor ?? ""} className="pc-input" inputMode="numeric" />
      </Control>
      <Button type="submit">Propose</Button>
    </form>
  );
}
