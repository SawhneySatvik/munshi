import { inviteIsOpen } from "@munshi/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "../../../../../components/Button";
import { appPool } from "../../../../../lib/server/db";
import { joinShop } from "../../../actions";
import { Field, Panel, words } from "../../../panel";

export const metadata: Metadata = { title: "Munshi · Join your shop" };

// An invite link (BLUEPRINT §6.2, §6.3): 404 unless its token names an unused, unexpired invite of that shop, on a live
// deployment. One form, the same page whether or not the invited email already has a Munshi account: the email the
// invite was sent to, and a password (AUTH3). The page names neither the email nor the shop's people.
export default async function InvitePage(props: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ failed?: string | string[] }> }) {
  const [{ slug, token }, { failed }] = await Promise.all([props.params, props.searchParams]);
  if (!(await inviteIsOpen(await appPool(), slug, token))) notFound();
  const w = await words();
  return (
    <Panel id="invite-h" title={w.inviteTitle} lede={w.inviteLede} notice={failed === "1" ? w.inviteFailed : undefined}>
      <form action={joinShop} className="people">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="token" value={token} />
        <Field label={w.email} name="email" type="email" autoComplete="username" />
        <Field label={w.password} name="password" type="password" autoComplete="current-password" />
        <p className="field-note">{w.rules}</p>
        <Button type="submit" variant="primary">
          {w.join}
        </Button>
      </form>
    </Panel>
  );
}
