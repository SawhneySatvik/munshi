import { deploymentKind, resetIsOpen } from "@munshi/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button } from "../../../../../components/Button";
import { appPool } from "../../../../../lib/server/db";
import { liveAuth } from "../../../../../lib/server/session";
import { setNewPassword } from "../../../actions";
import { Field, Panel, words } from "../../../panel";

export const metadata: Metadata = { title: "Munshi · New password" };

// A reset link (BLUEPRINT §6.2, review N1), issued by an owner or a manager in the app: 404 unless its token names an
// unused, unexpired grant of that shop, on a live deployment. Setting the password uses the link once and signs the
// person out everywhere else first.
export default async function ResetPage(props: { params: Promise<{ slug: string; token: string }>; searchParams: Promise<{ failed?: string | string[] }> }) {
  const [{ slug, token }, { failed }] = await Promise.all([props.params, props.searchParams]);
  const pool = await appPool();
  if ((await deploymentKind(pool)) !== "live" || !(await resetIsOpen(pool, liveAuth().publicPool, slug, token))) notFound();
  const w = await words();
  return (
    <Panel id="reset-h" title={w.resetTitle} lede={w.resetLede} notice={failed === "1" ? w.resetFailed : undefined}>
      <form action={setNewPassword} className="people">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="token" value={token} />
        <Field label={w.newPassword} name="password" type="password" autoComplete="new-password" />
        <p className="field-note">{w.rules}</p>
        <Button type="submit" variant="primary">
          {w.setPassword}
        </Button>
      </form>
    </Panel>
  );
}
