import { type ChannelState, channelState, consoleShop, CoreError, withOperator } from "@munshi/core";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Button } from "../../../../../components/Button";
import { ConsoleHead, Control, Notice, NumberInput, OnOffSelect } from "../../../../../components/platform/Console";
import { failureLine } from "../../../../../components/platform/failure";
import { CHANNEL_REASON } from "../../../../../lib/i18n-app";
import { channelDeploy } from "../../../../../lib/server/channels";
import { ShopCard } from "../../../../../components/platform/ShopCard";
import { BudgetForm, FeaturesPanel, ModelsPanel } from "../../../../../components/platform/ShopRouter";
import { operatorOr404 } from "../../../../../lib/server/platform-session";
import { proposePlatformChange } from "../../../actions";

// One shop, and the proposals the console can make for it: AI on or off with its text and media caps, the site
// verified or hidden, a channel granted or withdrawn with its recipient cap or Instagram account, the shop's monthly AI
// budget, and the router per shop: which models each role may use, and which AI features are on. Each form
// writes one pending platform.change; nothing changes until a later request approves it. Each channel's form opens with
// its state now (core's channelState, as the shop's settings show it): live, or recorded and why.
export default async function ConsoleShopPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ failed?: string | string[] }> }) {
  const { session, pool } = await operatorOr404(await cookies());
  const [{ id }, q] = await Promise.all([props.params, props.searchParams]);
  const shop = await withOperator(pool, session, (c) => consoleShop(c, id)).catch((err: unknown) => {
    if (err instanceof CoreError && err.code === "not_found") notFound();
    throw err;
  });
  const l = shop.limits;
  const back = `/platform/shops/${shop.tenantId}`;
  const failed = failureLine(q.failed);
  const whatsapp = shop.grants.find((g) => g.channel === "whatsapp");
  const instagram = shop.grants.find((g) => g.channel === "instagram");
  const deploy = channelDeploy();
  const stateOf = (g: typeof whatsapp, channel: "whatsapp" | "instagram") =>
    channelState(channel, shop.dataClass, g ? { granted: g.granted, accountRef: g.accountRef } : null, deploy);
  return (
    <>
      <ConsoleHead id="pc-shop-h" kicker="Shop" title={shop.name} lede="What is set now, each beside the change that set it, and the changes you can propose." />
      {failed ? <Notice tone="warn">{failed}</Notice> : null}
      <ShopCard shop={shop} link={false} />

      <section className="pc-section" aria-labelledby="pc-propose-h">
        <h2 id="pc-propose-h" className="pc-h2">
          Propose a change
        </h2>
        <div className="l-card">
          <form action={proposePlatformChange} className="pc-form" aria-label="AI and caps">
            <input type="hidden" name="kind" value="shop_config" />
            <input type="hidden" name="tenant" value={shop.tenantId} />
            <input type="hidden" name="back" value={back} />
            <h3 className="pc-h2">AI and caps</h3>
            <div className="pc-form-grid">
              <Control label="AI">
                <OnOffSelect name="ai_enabled" value={l.aiEnabled} />
              </Control>
              <Control label="Text calls a day" hint="0 to 2000">
                <NumberInput name="ai_daily_calls" value={l.aiDailyCalls} max={2000} />
              </Control>
              <Control label="Media calls a day" hint="0 to 500">
                <NumberInput name="media_daily_calls" value={l.mediaDailyCalls} max={500} />
              </Control>
            </div>
            <Button type="submit">Propose</Button>
          </form>

          <BudgetForm shop={shop} />

          <form action={proposePlatformChange} className="pc-form" aria-label="Site verification">
            <input type="hidden" name="kind" value="site_verify" />
            <input type="hidden" name="tenant" value={shop.tenantId} />
            <input type="hidden" name="back" value={back} />
            <h3 className="pc-h2">Site</h3>
            <Control label="The shop's public site">
              <select name="site_verified" defaultValue={l.siteVerified ? "false" : "true"} className="pc-input">
                <option value="true">Verified (served)</option>
                <option value="false">Hidden</option>
              </select>
            </Control>
            <Button type="submit">Propose</Button>
          </form>

          <form action={proposePlatformChange} className="pc-form" aria-label="WhatsApp grant">
            <input type="hidden" name="kind" value="channel_grant" />
            <input type="hidden" name="tenant" value={shop.tenantId} />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="channel" value="whatsapp" />
            <h3 className="pc-h2">WhatsApp</h3>
            <ChannelNow state={stateOf(whatsapp, "whatsapp")} />
            <div className="pc-form-grid">
              <Control label="Grant">
                <select name="granted" defaultValue={whatsapp?.granted ? "true" : "false"} className="pc-input">
                  <option value="true">Granted</option>
                  <option value="false">None</option>
                </select>
              </Control>
              <Control label="Test recipients at most" hint="0 to 5">
                <NumberInput name="max_test_recipients" value={whatsapp?.maxTestRecipients ?? 0} max={5} />
              </Control>
            </div>
            <p className="pc-meta">Approving a channel grant needs a fresh code from your authenticator app.</p>
            <Button type="submit">Propose</Button>
          </form>

          <form action={proposePlatformChange} className="pc-form" aria-label="Instagram grant">
            <input type="hidden" name="kind" value="channel_grant" />
            <input type="hidden" name="tenant" value={shop.tenantId} />
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="channel" value="instagram" />
            <input type="hidden" name="max_test_recipients" value="0" />
            <h3 className="pc-h2">Instagram</h3>
            <ChannelNow state={stateOf(instagram, "instagram")} />
            <div className="pc-form-grid">
              <Control label="Grant">
                <select name="granted" defaultValue={instagram?.granted ? "true" : "false"} className="pc-input">
                  <option value="true">Granted</option>
                  <option value="false">None</option>
                </select>
              </Control>
              <Control label="Account" hint="The account name Munshi holds (INSTAGRAM_ACCOUNT_REF, no long digit runs); empty for none">
                <input name="account_ref" defaultValue={instagram?.accountRef ?? ""} className="pc-input" pattern="[a-z0-9_.\-]{1,64}" />
              </Control>
            </div>
            <p className="pc-meta">Approving a channel grant needs a fresh code from your authenticator app.</p>
            <Button type="submit">Propose</Button>
          </form>
        </div>
      </section>
      <ModelsPanel shop={shop} />
      <FeaturesPanel shop={shop} />
    </>
  );
}

// A channel's state now, in words: live, or not and the first reason why (core's channelState).
function ChannelNow({ state }: { state: ChannelState }) {
  return (
    <p className="pc-meta" data-channel-state={state.reason}>
      {state.live ? "Live now. " : "Not live now. "}
      {CHANNEL_REASON[state.reason]?.en}
    </p>
  );
}
