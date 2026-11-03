import { waitingView } from "@munshi/core";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LANG_COOKIE, parseLang } from "../../../lib/i18n";
import { ONBOARDING_WORDS } from "../../../lib/i18n-onboard";
import { appPool } from "../../../lib/server/db";
import { signedInFrom } from "../../../lib/server/session";
import { signOut } from "../actions";
import { Panel, Submit } from "../panel";

export const metadata: Metadata = { title: "Munshi · Waiting for approval" };

// Where a real shop's owner lands while the superadmin has not accepted the shop (D-079, D-080): its name, its state
// and the owner's own member row, nothing else (the database refuses the shop every snapshot while it waits, so no
// figure could show). How long is left is a word, never a count. Every /app page sends a pending owner to sign-in,
// which sends them here; once the shop is accepted this page says so and opens /app.
export default async function WaitingPage() {
  const jar = await cookies();
  const signedIn = await signedInFrom(jar);
  if (!signedIn) redirect("/sign-in");
  const v = await waitingView(await appPool(), signedIn.session);
  if (!v) redirect("/app"); // counter staff of an open shop: the waiting page is the office's (D-082)
  const w = ONBOARDING_WORDS[parseLang(jar.get(LANG_COOKIE)?.value)];
  const status = v.state === "open" ? w.accepted : v.state === "expired" ? w.expired : w.pending;
  return (
    <Panel id="waiting-h" title={w.waitingTitle} lede={w.waitingLede}>
      <dl className="s-facts" data-state={v.state}>
        <dt>{w.shop}</dt>
        <dd data-name="">{v.shopName}</dd>
        <dt>{w.status}</dt>
        <dd>
          {status}
          {v.left ? ` ${w[v.left]}` : null}
        </dd>
        <dt>{w.you}</dt>
        <dd>
          <span data-name="">{v.owner.name}</span>
          {v.owner.role === "owner" ? ` · ${w.owner}` : null}
        </dd>
      </dl>
      {v.state === "open" ? (
        <p className="s-aside">
          <Link href="/app">{w.openShop}</Link>
        </p>
      ) : null}
      {v.state === "expired" ? (
        <p className="s-aside">
          <Link href="/sign-up">{w.signUpAgain}</Link>
        </p>
      ) : null}
      <form action={signOut} className="s-form">
        <Submit>{w.signOut}</Submit>
      </form>
    </Panel>
  );
}
