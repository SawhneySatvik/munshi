"use server";

// The superadmin console's actions. Each one gets its operator from operatorOr404 (else 404) and runs
// core's platform paths in that operator's one transaction: a proposal writes one pending platform.change and goes to
// its own page, where a LATER request shows the diff and approves it with that diff's digest (and a fresh TOTP code
// where the kind needs one). A refusal comes back as one line on the page it came from. An operator is added here only
// as a proposal: its approval mints the new operator's TOTP secret, which the console has no way to show once and only
// to the approver, so that approval is `pnpm platform:approve`'s (it writes the URI to a 0600 file); a page that lost
// it would leave an identity that can never be an operator.
import { KNOWN_ALIASES } from "@munshi/ai";
import { addsOperator, approveChange, type ChangeInput, CoreError, changeDiff, proposeChange, rejectChange, withOperator } from "@munshi/core";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { operatorOr404, signInConsole, signOutConsole } from "../../lib/server/platform-session";
import { requestIp } from "../../lib/server/session";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Whole numbers as numbers, on and off as booleans, an empty optional text as null; anything else stays text, and
// core's schema for the kind refuses what does not fit.
const num = (form: FormData, name: string): unknown => (/^[0-9]{1,6}$/.test(text(form, name)) ? Number(text(form, name)) : text(form, name));
const flag = (form: FormData, name: string): unknown => (text(form, name) === "true" ? true : text(form, name) === "false" ? false : text(form, name));
const orNull = (form: FormData, name: string) => text(form, name) || null;

function inputOf(form: FormData): ChangeInput | null {
  const tenantId = text(form, "tenant") || null;
  switch (text(form, "kind")) {
    case "shop_config":
      return { kind: "shop_config", tenantId, set: { ai_enabled: flag(form, "ai_enabled"), ai_daily_calls: num(form, "ai_daily_calls"), media_daily_calls: num(form, "media_daily_calls") } };
    case "site_verify":
      return { kind: "site_verify", tenantId, set: { site_verified: flag(form, "site_verified") } };
    case "channel_grant":
      return {
        kind: "channel_grant",
        tenantId,
        set: { channel: text(form, "channel"), granted: flag(form, "granted"), max_test_recipients: num(form, "max_test_recipients"), account_ref: orNull(form, "account_ref") },
      };
    case "default_config":
      return {
        kind: "default_config",
        set: {
          ai_enabled: flag(form, "ai_enabled"),
          ai_daily_calls: num(form, "ai_daily_calls"),
          media_daily_calls: num(form, "media_daily_calls"),
          sandbox_media_daily_calls_total: num(form, "sandbox_media_daily_calls_total"),
        },
      };
    case "reserved_slug":
      return { kind: "reserved_slug", set: { slug: text(form, "slug"), note: orNull(form, "note") } };
    case "tenant_accept":
      return { kind: "tenant_accept", tenantId, set: {} };
    // An operator added (an identity's subject and a display name), or one deactivated by its id.
    case "operator":
      return text(form, "deactivate")
        ? { kind: "operator", set: { id: text(form, "deactivate"), active: false } }
        : { kind: "operator", set: { subject: text(form, "subject"), display_name: text(form, "display_name") } };
    // The router per shop. An alias the running build does not serve in the role is refused here, before any
    // change is written (core never imports the model layer), as the deployment's allow-list form does.
    case "shop_models": {
      const alias = text(form, "alias");
      const role = text(form, "role");
      if (!Object.hasOwn(KNOWN_ALIASES, alias) || !(KNOWN_ALIASES[alias] as readonly string[]).includes(role)) return null;
      return { kind: "shop_models", tenantId, set: { alias, role, allowed: flag(form, "allowed"), is_default: flag(form, "is_default") } };
    }
    case "shop_features":
      return { kind: "shop_features", tenantId, set: { feature: text(form, "feature"), enabled: flag(form, "enabled") } };
    // A monthly budget in whole US cents; empty is no money cap (both null).
    case "ai_budget":
      return text(form, "monthly_minor")
        ? { kind: "ai_budget", tenantId, set: { monthly_minor: num(form, "monthly_minor"), currency: "USD" } }
        : { kind: "ai_budget", tenantId, set: { monthly_minor: null, currency: null } };
    default:
      return null;
  }
}

// Where a failed proposal returns: its form's own page, and only a console page.
const back = (form: FormData) => {
  const to = text(form, "back");
  return /^\/platform(\/(defaults|operators|shops\/[0-9a-f-]{36}))?$/.test(to) ? to : "/platform";
};
const withFailure = (to: string, code: string) => `${to}?failed=${code}`;
const codeOf = (err: unknown) => (err instanceof CoreError ? err.code : "internal");

export async function signInToConsole(form: FormData): Promise<void> {
  const jar = await cookies();
  const ip = requestIp(await headers());
  const session = await signInConsole(jar, { email: text(form, "email"), password: text(form, "password"), code: text(form, "code") }, ip);
  redirect(session ? "/platform" : "/platform/sign-in?failed=1");
}

export async function signOutOfConsole(): Promise<void> {
  await signOutConsole(await cookies());
  redirect("/platform/sign-in");
}

export async function proposePlatformChange(form: FormData): Promise<void> {
  const { session, pool } = await operatorOr404(await cookies());
  const input = inputOf(form);
  if (!input) redirect(withFailure(back(form), "invalid"));
  let id: string;
  try {
    id = (await withOperator(pool, session, (c) => proposeChange(c, input))).id;
  } catch (err) {
    redirect(`${withFailure(back(form), codeOf(err))}&kind=${input.kind}`);
  }
  redirect(`/platform/changes/${id}?proposed=1`);
}

export async function approvePlatformChange(form: FormData): Promise<void> {
  const { session, pool, secret } = await operatorOr404(await cookies());
  const id = text(form, "change");
  if (!UUID.test(id)) redirect("/platform/changes");
  const code = text(form, "code");
  let cli = false;
  try {
    await withOperator(pool, session, async (c) => {
      // Refused before core is called, in the same transaction: nothing is decided and no code is spent.
      if (addsOperator(await changeDiff(c, id))) {
        cli = true;
        return;
      }
      await approveChange(c, id, { digest: text(form, "digest"), ...(code ? { code } : {}), platformSecret: secret });
    });
  } catch (err) {
    redirect(withFailure(`/platform/changes/${id}`, codeOf(err)));
  }
  if (cli) redirect(withFailure(`/platform/changes/${id}`, "cli"));
  redirect(`/platform/changes/${id}?done=approved`);
}

export async function rejectPlatformChange(form: FormData): Promise<void> {
  const { session, pool } = await operatorOr404(await cookies());
  const id = text(form, "change");
  if (!UUID.test(id)) redirect("/platform/changes");
  try {
    await withOperator(pool, session, (c) => rejectChange(c, id));
  } catch (err) {
    redirect(withFailure(`/platform/changes/${id}`, codeOf(err)));
  }
  redirect(`/platform/changes/${id}?done=rejected`);
}
