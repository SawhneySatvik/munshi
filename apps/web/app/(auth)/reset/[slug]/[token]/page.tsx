import { resetIsOpen } from "@munshi/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { appPool } from "../../../../../lib/server/db";
import { realAuth } from "../../../../../lib/server/session";
import { setNewPassword } from "../../../actions";
import { Field, Panel, Submit, words } from "../../../panel";

export const metadata: Metadata = { title: "Munshi · New password" };

// A reset link, issued by an owner or a manager in the app: 404 unless its token names an
// unused, unexpired grant of that real shop (and real sign-in is set up). Setting the password uses the link once and signs the
// person out everywhere else first.
export default async function ResetPage(props: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ failed?: string | string[] }> }) {
  const [{ slug, token }, { failed }] = await Promise.all([props.params, props.searchParams]);
  const pool = await appPool();
  const auth = realAuth();
  if (!auth || !(await resetIsOpen(pool, auth.publicPool, slug, token))) notFound();
  const w = await words();
  return (
    <Panel id="reset-h" title={w.resetTitle} lede={w.resetLede} notice={failed === "1" ? w.resetFailed : undefined}>
      <form action={setNewPassword} className="s-form">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="token" value={token} />
        <Field label={w.newPassword} name="password" type="password" autoComplete="new-password" />
        <p className="s-field-n">{w.rules}</p>
        <Submit>{w.setPassword}</Submit>
      </form>
    </Panel>
  );
}
