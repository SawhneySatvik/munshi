import { deploymentKind } from "@munshi/core";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { signInWithPassword } from "../(auth)/actions";
import { Field, Panel, Submit, words } from "../(auth)/panel";
import { LANG_COOKIE, parseLang } from "../../lib/i18n";
import { ONBOARDING_WORDS } from "../../lib/i18n-onboard";
import { appPool } from "../../lib/server/db";
import { realAuth, SESSION_COOKIE, signedInFrom } from "../../lib/server/session";

export const metadata: Metadata = { title: "Munshi · Sign in" };

// Where every page sends a person with no session. A real shop's owner whose shop still waits for the operator goes on
// to the waiting page (D-080): every /app page sends them here first. Real sign-in is a real shop's, on any deployment
// that sets it up (a live one must; the hosted demo does): email and password (§6.2), where a wrong one, an unknown email
// and a locked attempt all show the same line, and an identity with no shop is told to ask for an invite. Without it,
// the demo picker and the sample shops stand in (BLUEPRINT §6.6).
export default async function SignInPage(props: {
  searchParams: Promise<{ failed?: string | string[]; none?: string | string[]; expired?: string | string[] }>;
}) {
  const jar = await cookies();
  const signedIn = jar.get(SESSION_COOKIE) ? await signedInFrom(jar) : null;
  if (signedIn && signedIn.shop !== "open") redirect("/waiting");
  const pool = await appPool();
  if (!realAuth()) redirect("/demo");
  const [q, w, kind] = await Promise.all([props.searchParams, words(), deploymentKind(pool)]);
  const o = ONBOARDING_WORDS[parseLang(jar.get(LANG_COOKIE)?.value)];
  const notice = q.failed === "1" ? w.wrong : q.none === "1" ? w.noInvite : q.expired === "1" ? o.realExpired : undefined;
  return (
    <Panel id="sign-in-h" title={w.signInTitle} lede={w.signInLede} notice={notice}>
      <form action={signInWithPassword} className="s-form">
        <Field label={w.email} name="email" type="email" autoComplete="username" />
        <Field label={w.password} name="password" type="password" autoComplete="current-password" />
        <Submit>{w.signIn}</Submit>
      </form>
      <p className="s-aside">
        <Link href="/sign-up?as=real">{o.realChoice}</Link>
        {kind === "demo" ? <Link href="/demo">{w.demoTitle}</Link> : null}
      </p>
    </Panel>
  );
}
