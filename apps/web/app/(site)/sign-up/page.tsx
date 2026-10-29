import { deploymentKind } from "@munshi/core";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { type Notice, Onboarding } from "../../../components/site/Onboarding";
import { ONBOARD_WORDS } from "../../../components/site/onboard-words";
import { LANG_COOKIE, parseLang } from "../../../lib/i18n";
import { appPool } from "../../../lib/server/db";

export const metadata: Metadata = { title: "Munshi · Sign up" };

type Query = { invalid?: string | string[]; taken?: string | string[]; limit?: string | string[] };

// Sign-up (BLUEPRINT §6.3, §6.6). On the demo deployment it is the sample shop: the onboarding screens post to the real
// makeSampleShop, which opens the new sandbox's owner in /app, or comes back here with its one line. On live, self-serve
// sign-up is off until the identity move (a real shop is onboarded assisted, by invite), so the page says so.
export default async function SignUpPage(props: { searchParams: Promise<Query> }) {
  const [q, kind, jar] = await Promise.all([props.searchParams, deploymentKind(await appPool()), cookies()]);
  const w = ONBOARD_WORDS[parseLang(jar.get(LANG_COOKIE)?.value)];
  if (kind !== "demo") {
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
  const notice: Notice | undefined = q.taken === "1" ? "taken" : q.invalid === "1" ? "invalid" : q.limit === "1" ? "limit" : undefined;
  return (
    <section className="s-screen" aria-labelledby="sign-up-title">
      <p className="s-kicker">{w.kicker}</p>
      <h1 className="s-h1" id="sign-up-title">
        {w.title}
      </h1>
      <p className="s-screen-lede">{w.lede}</p>
      <Onboarding back="sign-up" notice={notice} />
      <p className="s-aside">
        <Link href="/demo">{w.pickInstead}</Link>
        <Link href="/sign-in">{w.haveShop}</Link>
      </p>
    </section>
  );
}
