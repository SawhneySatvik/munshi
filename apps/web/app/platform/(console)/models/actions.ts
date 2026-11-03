"use server";

// The console's model allow-list: a proposal writes one pending model_allow change, {alias, role, enabled}, and
// goes to the change's own page, where a later request shows the diff and approves it (approvePlatformChange, as for
// every kind). Only an alias this build serves in that role may be proposed: core never imports the agent, so the check
// is here. A refusal comes back as one line on this page.
import { KNOWN_ALIASES } from "@munshi/ai";
import { CoreError, proposeChange, withOperator } from "@munshi/core";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { operatorOr404 } from "../../../../lib/server/platform-session";

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v.trim() : "";
};

export async function proposeModelAllow(form: FormData): Promise<void> {
  const { session, pool } = await operatorOr404(await cookies());
  // The new-model form names the pair as "alias|role"; a row's own form names each.
  const pair = text(form, "pair").split("|");
  const [alias, role] = pair.length === 2 ? pair : [text(form, "alias"), text(form, "role")];
  const enabled = text(form, "enabled");
  const serves = !!alias && !!role && Object.hasOwn(KNOWN_ALIASES, alias) && (KNOWN_ALIASES[alias] as readonly string[]).includes(role);
  if (!serves || (enabled !== "true" && enabled !== "false")) redirect("/platform/models?failed=invalid");
  let id: string;
  try {
    id = (await withOperator(pool, session, (c) => proposeChange(c, { kind: "model_allow", set: { alias, role, enabled: enabled === "true" } }))).id;
  } catch (err) {
    redirect(`/platform/models?failed=${err instanceof CoreError ? err.code : "internal"}`);
  }
  redirect(`/platform/changes/${id}?proposed=1`);
}
