"use server";

// A real shop's sign-up (D-079, D-080; platform design §1). Core makes the shop real ('live') and pending, with its
// owner, first-owner login and shop in one transaction, and opens the owner's session; the cookie names it and the
// owner lands on the waiting page. Two paths, by the deployment's settings:
// - with Supabase Auth set (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY): the form emails a link; its page takes the password
//   and this action spends the link's token hash, so the identity is made with the email Supabase verified
//   ('email'). The shop's details wait in a signed, short-lived cookie between the two, beside the email's keyed hash;
// - without it: the form takes the password at once, and the identity is self-asserted ('invite', the schema's
//   default), which the page says plainly. The operator's acceptance is the check either way.
// Both count each attempt against the network and the email (ops.rate_counter) before any password is hashed. Real
// sign-up needs real sign-in's settings (the identity and rate keys, the idp and public pools): without them, 404.
// No email, password or token is logged or put in a URL.
import { allowAttempt, signUpRealShop, slugFree, validRealShop } from "@munshi/core";
import { foldEmail, passwordAllowed } from "@munshi/adapters/identity";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { appPool } from "../../../lib/server/db";
import { realAuth, requestIp, setSessionCookie } from "../../../lib/server/session";
import { emailVerifier, pendingSignUp, setPendingSignUp } from "../../../lib/server/signup";

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

// One count per network and one per email (its keyed hash: the email itself never reaches the database here), both
// taken on every attempt, before scrypt runs.
async function within(auth: NonNullable<ReturnType<typeof realAuth>>, ipHash: Buffer, email: string): Promise<boolean> {
  const [ip, mail] = await Promise.all([
    allowAttempt(auth.publicPool, "shop-sign-up", ipHash),
    allowAttempt(auth.publicPool, "shop-sign-up-email", auth.ipHashOf(`email:${foldEmail(email)}`)),
  ]);
  return ip && mail;
}

async function finish(r: Awaited<ReturnType<typeof signUpRealShop>>): Promise<never> {
  if (r.kind !== "opened") redirect(back(r.kind));
  await setSessionCookie(await cookies(), r.opened);
  redirect("/waiting");
}

/** Without an email service: the whole form, password included, in one post. */
export async function signUpReal(form: FormData): Promise<void> {
  const { auth, ctx } = await request();
  if (emailVerifier()) notFound(); // with Supabase set, only the verified path makes a real shop
  const email = text(form, "email");
  if (!(await within(auth, ctx.ipHash, email))) redirect(back("limit"));
  await finish(await signUpRealShop(await appPool(), auth.port, { ...details(form), email, password: text(form, "password") }, ctx, "invite"));
}

/** With Supabase: the details and the email; Supabase sends the link, and the details wait in a signed cookie. */
export async function startRealSignUp(form: FormData): Promise<void> {
  const { auth, ctx } = await request();
  const verifier = emailVerifier();
  if (!verifier) notFound();
  const shop = details(form);
  const email = text(form, "email").trim();
  if (!(await within(auth, ctx.ipHash, email))) redirect(back("limit"));
  if (validRealShop({ ...shop, email, password: "unused-here" }).length) redirect(back("invalid"));
  if (!(await slugFree(await appPool(), shop.slug))) redirect(back("taken"));
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? "localhost"}`;
  if (!(await verifier.sendLink(email, `${origin}/sign-up/confirm`))) redirect(back("unsent"));
  setPendingSignUp(await cookies(), shop, email);
  redirect(back("sent"));
}

/** The link's page posts here: the password is checked, then the token hash spent, then the shop made. */
export async function finishRealSignUp(form: FormData): Promise<void> {
  const { auth, ctx } = await request();
  const verifier = emailVerifier();
  if (!verifier) notFound();
  const jar = await cookies();
  const pending = pendingSignUp(jar);
  if (!pending) redirect(back("lost"));
  const password = text(form, "password");
  // Checked before the link is spent: a refused password would otherwise cost the person their link.
  if (!passwordAllowed(password, [pending.shop.shopName])) redirect(`/sign-up/confirm?token_hash=${encodeURIComponent(text(form, "token_hash"))}&failed=1`);
  const email = await verifier.verify(text(form, "token_hash"));
  if (!email) redirect(back("unconfirmed"));
  if (!pending.holds(email)) redirect(back("lost"));
  await finish(await signUpRealShop(await appPool(), auth.port, { ...pending.shop, email, password }, ctx, "email"));
}
