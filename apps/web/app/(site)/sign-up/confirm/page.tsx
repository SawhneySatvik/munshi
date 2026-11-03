import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AUTH_WORDS } from "../../../(auth)/words";
import { ConfirmForm } from "../../../../components/site/RealSignUp";
import { LANG_COOKIE, parseLang } from "../../../../lib/i18n";
import { ONBOARDING_WORDS } from "../../../../lib/i18n-onboard";
import { emailVerifier, pendingSignUp } from "../../../../lib/server/signup";

export const metadata: Metadata = { title: "Munshi · Set your password" };

// The email link's page: Supabase sends the owner here with the link's token hash. Opening it spends nothing (a
// mail scanner may open it first): the form posts the hash with the password, and the action verifies it once. It works
// only in the browser that asked for the link, within the hour (its signed cookie holds the shop's details). 404 where
// no email service is set.
export default async function ConfirmPage(props: {
  searchParams: Promise<{ token_hash?: string | string[]; failed?: string | string[]; limit?: string | string[] }>;
}) {
  if (!emailVerifier()) notFound();
  const [q, jar] = await Promise.all([props.searchParams, cookies()]);
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const [o, a] = [ONBOARDING_WORDS[lang], AUTH_WORDS[lang]];
  const tokenHash = typeof q.token_hash === "string" ? q.token_hash : "";
  const pending = pendingSignUp(jar);
  return (
    <section className="s-screen" aria-labelledby="confirm-h">
      <h1 className="s-h1" id="confirm-h">
        {o.confirmTitle}
      </h1>
      <p className="s-screen-lede">{pending && tokenHash ? o.confirmLede : o.confirmNoCookie}</p>
      <p className="s-field-n">{o.confirmSameBrowser}</p>
      {q.failed === "1" || q.limit === "1" ? (
        <p className="s-alert" role="alert">
          {q.limit === "1" ? o.realLimit : o.realFailed}
        </p>
      ) : null}
      {pending && tokenHash ? <ConfirmForm a={a} w={o} tokenHash={tokenHash} /> : null}
      <p className="s-aside">
        <Link href="/sign-up?as=real">{o.signUpAgain}</Link>
      </p>
    </section>
  );
}
