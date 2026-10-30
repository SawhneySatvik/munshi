"use server";

// The superadmin console's actions (BLUEPRINT §6.5). Each one gets its operator from operatorOr404 (else 404) and runs
// core's platform paths in that operator's one transaction: a proposal writes one pending platform.change and goes to
// its own page, where a LATER request shows the diff and approves it with that diff's digest (and a fresh TOTP code
// where the kind needs one). A refusal comes back as one line on the page it came from.
import { approveChange, type ChangeInput, CoreError, proposeChange, rejectChange, withOperator } from "@munshi/core";
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
    default:
      return null;
  }
}

// Where a failed proposal returns: its form's own page, and only a console page.
const back = (form: FormData) => {
  const to = text(form, "back");
  return /^\/platform(\/(defaults|shops\/[0-9a-f-]{36}))?$/.test(to) ? to : "/platform";
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
    redirect(withFailure(back(form), codeOf(err)));
  }
  redirect(`/platform/changes/${id}?proposed=1`);
}

export async function approvePlatformChange(form: FormData): Promise<void> {
  const { session, pool, secret } = await operatorOr404(await cookies());
  const id = text(form, "change");
  if (!UUID.test(id)) redirect("/platform/changes");
  const code = text(form, "code");
  try {
    await withOperator(pool, session, (c) => approveChange(c, id, { digest: text(form, "digest"), ...(code ? { code } : {}), platformSecret: secret }));
  } catch (err) {
    redirect(withFailure(`/platform/changes/${id}`, codeOf(err)));
  }
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
