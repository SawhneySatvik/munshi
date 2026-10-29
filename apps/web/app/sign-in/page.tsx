import { deploymentKind } from "@munshi/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signInWithPassword } from "../(auth)/actions";
import { Field, Panel, words } from "../(auth)/panel";
import { Button } from "../../components/Button";
import { appPool } from "../../lib/server/db";

export const metadata: Metadata = { title: "Munshi · Sign in" };

// Where every page sends a person with no session. A demo deployment has no real sign-in: the demo picker and the sample
// shops instead (BLUEPRINT §6.6). On live, email and password (§6.2): a wrong one, an unknown email and a locked
// attempt all show the same line; an identity with no shop is told to ask for an invite, with no hint of anything else.
export default async function SignInPage(props: { searchParams: Promise<{ failed?: string | string[]; none?: string | string[] }> }) {
  if ((await deploymentKind(await appPool())) !== "live") redirect("/demo");
  const [q, w] = await Promise.all([props.searchParams, words()]);
  const notice = q.failed === "1" ? w.wrong : q.none === "1" ? w.noInvite : undefined;
  return (
    <Panel id="sign-in-h" title={w.signInTitle} lede={w.signInLede} notice={notice}>
      <form action={signInWithPassword} className="people">
        <Field label={w.email} name="email" type="email" autoComplete="username" />
        <Field label={w.password} name="password" type="password" autoComplete="current-password" />
        <Button type="submit" variant="primary">
          {w.signIn}
        </Button>
      </form>
    </Panel>
  );
}
