"use server";

// A real shop's sign-up. Core makes the shop real ('live') and pending, with its
// owner, first-owner login and shop in one transaction, and opens the owner's session; the cookie names it and the
// owner lands on the waiting page. Two paths, by the deployment's settings:
// - with Supabase Auth set (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, and MUNSHI_APP_URL, the app's public origin the
//   link returns to): the form emails a link; its page takes the password and this action spends the link's token
//   hash, so the identity is made with the email Supabase verified ('email'). The shop's details wait in a signed,
//   hour-long cookie between the two, beside the email's keyed hash;
// - without it: the form takes the password at once, and the identity is self-asserted ('invite', the schema's
//   default), which the page says plainly. Only on a laptop or a test database: on a hosted or live one core refuses
//   it before anything is made, and the page offers no form.
// Every attempt counts against the network first; the email's count is taken once the input validates (a finish, by
// the cookie's email hash, before Supabase is called), each before any password is hashed. Real sign-up needs real
// sign-in's settings (the identity and rate keys, the idp and public pools): without them, 404. No email, password or
// token is logged or put in a URL.
import { allowAttempt, signUpRealShop, slugFree, validRealShop } from "@munshi/core";
import { passwordAllowed } from "@munshi/adapters/identity";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { config } from "../../../lib/server/config";
import { appPool } from "../../../lib/server/db";
import { realAuth, requestIp, setSessionCookie } from "../../../lib/server/session";
import { clearPendingSignUp, emailKey, emailVerifier, pendingSignUp, setPendingSignUp } from "../../../lib/server/signup";

type Auth = NonNullable<ReturnType<typeof realAuth>>;

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};
const back = (notice: string) => `/sign-up?as=real&${notice}=1`;

const details = (form: FormData) => ({
  shopName: text(form, "shopName"),
  businessType: text(form, "businessType"),
  city: text(form, "city"),
  ownerName: text(form, "ownerName"),
  slug: text(form, "slug").trim().toLowerCase(),
});

async function request() {
  const auth = realAuth();
  if (!auth) notFound();
  return { auth, ctx: { ipHash: auth.ipHashOf(requestIp(await headers())), botCheck: true } };
}

// The network's count (every attempt) and the email's (its keyed hash, never the email), in ops.rate_counter.
const networkWithin = (auth: Auth, ipHash: Buffer) => allowAttempt(auth.publicPool, "shop-sign-up", ipHash);
const emailWithin = (auth: Auth, key: string) => allowAttempt(auth.publicPool, "shop-sign-up-email", auth.ipHashOf(`email:${key}`));

async function finish(r: Awaited<ReturnType<typeof signUpRealShop>>): Promise<never> {
  if (r.kind !== "opened") redirect(back(r.kind));
  const jar = await cookies();
  clearPendingSignUp(jar);
  await setSessionCookie(jar, r.opened);
  redirect("/waiting");
}

/** Without an email service (a laptop or a test database): the whole form, password included, in one post. */
export async function signUpReal(form: FormData): Promise<void> {
  const { auth, ctx } = await request();
  if (emailVerifier()) notFound(); // with Supabase set, only the verified path makes a real shop
  if (!(await networkWithin(auth, ctx.ipHash))) redirect(back("limit"));
  const input = { ...details(form), email: text(form, "email").trim(), password: text(form, "password") };
  if (validRealShop(input).length) redirect(back("invalid"));
  if (!(await emailWithin(auth, emailKey(input.email)))) redirect(back("limit"));
  await finish(await signUpRealShop(await appPool(), auth.port, input, ctx, "invite"));
}

/** With Supabase: the details and the email; Supabase sends the link, and the details wait in a signed cookie. */
export async function startRealSignUp(form: FormData): Promise<void> {
  const { auth, ctx } = await request();
  const verifier = emailVerifier();
  const appUrl = config().appUrl;
  if (!verifier || !appUrl) notFound();
  if (!(await networkWithin(auth, ctx.ipHash))) redirect(back("limit"));
  const shop = details(form);
  const email = text(form, "email").trim();
  if (validRealShop({ ...shop, email, password: "unused-here" }).length) redirect(back("invalid"));
  if (!(await emailWithin(auth, emailKey(email)))) redirect(back("limit"));
  if (!(await slugFree(await appPool(), shop.slug))) redirect(back("taken"));
  // The link returns to the configured public origin, never to a request's own Host or Origin.
  if (!(await verifier.sendLink(email, `${appUrl}/sign-up/confirm`))) redirect(back("unsent"));
  setPendingSignUp(await cookies(), shop, email);
  redirect(back("sent"));
}

/** The link's page posts here: counted, the password checked, then the token hash spent, then the shop made. */
export async function finishRealSignUp(form: FormData): Promise<void> {
  const { auth, ctx } = await request();
  const verifier = emailVerifier();
  if (!verifier) notFound();
  const pending = pendingSignUp(await cookies());
  if (!pending) redirect(back("lost"));
  const again = `/sign-up/confirm?token_hash=${encodeURIComponent(text(form, "token_hash"))}`;
  if (!(await networkWithin(auth, ctx.ipHash)) || !(await emailWithin(auth, pending.emailKey))) redirect(`${again}&limit=1`);
  const password = text(form, "password");
  // Checked before the link is spent: a refused password would otherwise cost the person their link.
  if (!passwordAllowed(password, [pending.shop.shopName])) redirect(`${again}&failed=1`);
  const email = await verifier.verify(text(form, "token_hash"));
  if (!email) redirect(back("unconfirmed"));
  if (!pending.holds(email)) redirect(back("lost"));
  await finish(await signUpRealShop(await appPool(), auth.port, { ...pending.shop, email, password }, ctx, "email"));
}
