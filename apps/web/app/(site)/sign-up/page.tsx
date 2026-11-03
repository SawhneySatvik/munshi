import { deploymentKind, servedDeployment } from "@munshi/core";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { AUTH_WORDS } from "../../(auth)/words";
import { type Notice, Onboarding } from "../../../components/site/Onboarding";
import { ONBOARD_WORDS } from "../../../components/site/onboard-words";
import { RealSignUpForm } from "../../../components/site/RealSignUp";
import { LANG_COOKIE, parseLang } from "../../../lib/i18n";
import { ONBOARDING_WORDS } from "../../../lib/i18n-onboard";
import { appPool } from "../../../lib/server/db";
import { realAuth } from "../../../lib/server/session";
import { emailVerifier } from "../../../lib/server/signup";

export const metadata: Metadata = { title: "Munshi · Sign up" };

type Query = Record<
  "as" | "invalid" | "taken" | "limit" | "failed" | "waiting" | "refused" | "closed" | "sent" | "lost" | "unconfirmed" | "unsent",
  string | string[] | undefined
>;

// Sign-up, two clear choices. A sample shop (the demo deployment): the
// onboarding screens post to makeSampleShop, which opens the new sandbox's owner in /app. A real shop,
// wherever real sign-in is set up: its details and the owner's sign-in make a real shop that waits for the operator's
// acceptance, and its owner lands on the waiting page; with Supabase Auth set the email is verified by a link first.
// On a hosted or live database without Supabase, the real shop's choice says only that real shops open here soon: an
// unverified email signs up a real shop only on a laptop or a test database. With neither (a live deployment
// without its keys cannot boot), the page says shops join by invitation.
export default async function SignUpPage(props: { searchParams: Promise<Partial<Query>> }) {
  const pool = await appPool();
  const [q, kind, served, jar] = await Promise.all([props.searchParams, deploymentKind(pool), servedDeployment(pool), cookies()]);
  const lang = parseLang(jar.get(LANG_COOKIE)?.value);
  const [w, o, a] = [ONBOARD_WORDS[lang], ONBOARDING_WORDS[lang], AUTH_WORDS[lang]];
  const sample = kind === "demo";
  const real = realAuth() !== null;
  if (!sample && !real) {
    return (
      <section className="s-screen" aria-labelledby="sign-up-h">
        <p className="s-kicker">{w.kicker}</p>
        <h1 className="s-h1" id="sign-up-h">
          {w.liveTitle}
        </h1>
        <p className="s-screen-lede">{w.liveBody}</p>
        <p className="s-aside">
          <Link href="/sign-in">{w.haveShop}</Link>
        </p>
      </section>
    );
  }
  const as = real && (q.as === "real" || !sample) ? "real" : "sample";
  const choices =
    sample && real ? (
      <nav className="s-form" aria-label={o.choiceTitle}>
        <Link href="/sign-up" className={`s-card${as === "sample" ? " is-lead" : ""}`} aria-current={as === "sample" ? "page" : undefined}>
          <span>{o.sampleChoice}</span>
          <span className="s-card-k">{o.sampleChoiceBody}</span>
        </Link>
        <Link href="/sign-up?as=real" className={`s-card${as === "real" ? " is-lead" : ""}`} aria-current={as === "real" ? "page" : undefined}>
          <span>{o.realChoice}</span>
          <span className="s-card-k">{o.realChoiceBody}</span>
        </Link>
      </nav>
    ) : null;
  if (as === "sample") {
    const notice: Notice | undefined = q.taken === "1" ? "taken" : q.invalid === "1" ? "invalid" : q.limit === "1" ? "limit" : undefined;
    return (
      <section className="s-screen" aria-labelledby="sign-up-title">
        <p className="s-kicker">{w.kicker}</p>
        <h1 className="s-h1" id="sign-up-title">
          {w.title}
        </h1>
        <p className="s-screen-lede">{w.lede}</p>
        {choices}
        <Onboarding back="sign-up" notice={notice} />
        <p className="s-aside">
          <Link href="/demo">{w.pickInstead}</Link>
          <Link href="/sign-in">{w.haveShop}</Link>
        </p>
      </section>
    );
  }
  const emailLink = emailVerifier() !== null;
  const soon = served && !emailLink; // no unverified email on a served deployment: no form
  const one = (k: keyof Query) => q[k] === "1";
  // Each notice the actions send back, and its line (the first one set wins).
  const lines: [keyof Query, string][] = [
    ["taken", o.realTaken],
    ["invalid", o.realInvalid],
    ["limit", o.realLimit],
    ["failed", o.realFailed],
    ["waiting", o.realWaiting],
    ["refused", o.realRefused],
    ["closed", o.realSoon],
    ["lost", o.confirmNoCookie],
    ["unsent", o.unsent],
    ["unconfirmed", o.confirmFailed],
  ];
  const line = lines.find(([k]) => one(k))?.[1];
  return (
    <section className="s-screen" aria-labelledby="real-h">
      <p className="s-kicker">{w.kicker}</p>
      <h1 className="s-h1" id="real-h">
        {one("sent") ? o.sentTitle : o.realTitle}
      </h1>
      <p className="s-screen-lede">{one("sent") ? o.sentBody : o.realLede}</p>
      {choices}
      {line ? (
        <p className="s-alert" role="alert">
          {line}
        </p>
      ) : null}
      {soon ? (
        <p className="s-screen-lede" data-soon="">
          {o.realSoon}
        </p>
      ) : one("sent") ? null : (
        <RealSignUpForm a={a} w={o} emailLink={emailLink} />
      )}
      <p className="s-aside">
        <Link href="/sign-in">{w.haveShop}</Link>
      </p>
    </section>
  );
}
