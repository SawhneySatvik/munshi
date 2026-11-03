"use server";

// Real sign-in, the shop picker, invites and resets (BLUEPRINT §6.2–§6.4): a real shop's, on any deployment that sets
// real sign-in up (D-080; a live one must); elsewhere each answers 404 and the demo picker stands in (§6.6, AUTH1). A
// real shop still waiting for the operator's acceptance opens on the waiting page. The person comes from the identity port and core's paths,
// never from the form; every failure of a form comes back as its one line (AUTH3), and no password, token or email is
// logged. Sign-out works on both.
import { acceptInvite, allowAttempt, type Membership, memberships, openRealSession, redeemReset, shopState } from "@munshi/core";
import type { Identity } from "@munshi/adapters/identity";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { landing } from "../../lib/nav";
import { appPool } from "../../lib/server/db";
import { memberOf } from "../../lib/server/ops";
import { PICK_COOKIE, pickFrom, realAuth, requestIp, setPickCookie, setSessionCookie, signOutCookie } from "../../lib/server/session";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

async function liveOnly() {
  if (!realAuth()) notFound();
  return appPool();
}

// The request as the identity port sees it. The bot check (Turnstile) arrives with the deploy wave; until then it is
// recorded as passed (D-045), so the port's three-failures rule asks nothing of anyone yet.
async function request() {
  const auth = realAuth();
  if (!auth) notFound();
  return { auth, ctx: { ipHash: auth.ipHashOf(requestIp(await headers())), botCheck: true } };
}

// A real shop waiting for acceptance opens on the waiting page, its owner's only page; once its sign-up has expired, or
// for anyone else, the database opens no session and the person is told which.
async function enter(identity: Identity, shop: Membership): Promise<never> {
  const pool = await appPool();
  const opened = await openRealSession(pool, identity, shop.id);
  if (!opened) redirect((await shopState(pool, shop.id)) === "expired" ? "/sign-in?expired=1" : "/sign-in?failed=1");
  await setSessionCookie(await cookies(), opened);
  redirect((await shopState(pool, shop.id)) === "open" ? landing(shop.role) : "/waiting");
}

export async function signInWithPassword(form: FormData): Promise<void> {
  const pool = await liveOnly();
  const { auth, ctx } = await request();
  const within = await allowAttempt(auth.publicPool, "sign-in", ctx.ipHash);
  const identity = within ? await auth.port.signIn({ email: text(form, "email"), password: text(form, "password") }, ctx) : null;
  if (!identity) redirect("/sign-in?failed=1");
  const shops = await memberships(pool, identity);
  if (shops.length === 0) redirect("/sign-in?none=1");
  if (shops.length > 1) {
    setPickCookie(await cookies(), identity);
    redirect("/choose-shop");
  }
  await enter(identity, shops[0] as Membership);
}

export async function chooseShop(form: FormData): Promise<void> {
  const pool = await liveOnly();
  const jar = await cookies();
  const identity = pickFrom(jar);
  if (!identity) redirect("/sign-in");
  const shop = (await memberships(pool, identity)).find((m) => m.id === text(form, "tenant"));
  if (!shop) redirect("/choose-shop");
  jar.set(PICK_COOKIE, "", { path: "/", maxAge: 0 });
  await enter(identity, shop);
}

// Back to a link's own page with its one failure line.
const again = (route: "invite" | "reset", slug: string, token: string) => `/${route}/${encodeURIComponent(slug)}/${encodeURIComponent(token)}?failed=1`;

export async function joinShop(form: FormData): Promise<void> {
  const pool = await liveOnly();
  const { auth, ctx } = await request();
  const [slug, token] = [text(form, "slug"), text(form, "token")];
  if (!(await allowAttempt(auth.publicPool, "sign-in", ctx.ipHash))) redirect(again("invite", slug, token));
  const r = await acceptInvite(pool, auth.port, { slug, token, email: text(form, "email"), password: text(form, "password") }, ctx);
  if (r.kind === "not_found") notFound();
  if (r.kind === "failed") redirect(again("invite", slug, token));
  await setSessionCookie(await cookies(), r.opened);
  const me = await memberOf(r.opened.session);
  redirect(me ? landing(me.role) : "/app");
}

export async function setNewPassword(form: FormData): Promise<void> {
  const pool = await liveOnly();
  const { auth } = await request();
  const [slug, token] = [text(form, "slug"), text(form, "token")];
  const r = await redeemReset(pool, auth.publicPool, auth.port, { slug, token, password: text(form, "password") });
  if (r.kind === "not_found") notFound();
  if (r.kind === "failed") redirect(again("reset", slug, token));
  await setSessionCookie(await cookies(), r.opened);
  const me = await memberOf(r.opened.session);
  redirect(me ? landing(me.role) : "/app");
}

export async function signOut(): Promise<void> {
  await signOutCookie(await cookies());
  redirect("/sign-in");
}
