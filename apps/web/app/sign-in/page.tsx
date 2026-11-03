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
// to the waiting page: every /app page sends them here first. Real sign-in is a real shop's, on any deployment
// that sets it up (a live one must; the hosted demo does): email and password, where a wrong one, an unknown email
// and a locked attempt all show the same line, and an identity with no shop is told to ask for an invite. On a demo
// deployment the page leads with the demo, the form below it. Without real sign-in, the demo picker and the sample
// shops stand in.
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
  const form = (
    <form action={signInWithPassword} className="s-form">
      <Field label={w.email} name="email" type="email" autoComplete="username" />
      <Field label={w.password} name="password" type="password" autoComplete="current-password" />
      <Submit>{w.signIn}</Submit>
    </form>
  );
  // The demo deployment leads with the demo (visitors land here): the sample shops are the primary action, and the
  // password form for a real shop's owner sits below.
  if (kind === "demo") {
    return (
      <Panel id="sign-in-h" title={o.tryDemo} lede={o.tryDemoBody} notice={notice}>
        <p className="s-form">
          <Link href="/demo" className="s-btn is-lg" data-primary="demo">
            {o.tryDemo}
          </Link>
        </p>
        <p className="s-aside">{o.ownersBelow}</p>
        {form}
        <p className="s-aside">
          <Link href="/sign-up?as=real">{o.realChoice}</Link>
        </p>
      </Panel>
    );
  }
  return (
    <Panel id="sign-in-h" title={w.signInTitle} lede={w.signInLede} notice={notice}>
      {form}
      <p className="s-aside">
        <Link href="/sign-up?as=real">{o.realChoice}</Link>
      </p>
    </Panel>
  );
}
