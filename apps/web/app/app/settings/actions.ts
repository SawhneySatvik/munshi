"use server";

// Settings → Capabilities: the owner switches a capability on or off, through core's switchCapability
// as the signed-in member under the form's key. One audited ops row (capability.switch), never a book row; the database
// refuses anyone but an active owner, a switch-on while something it requires is off and a switch-off while something
// that requires it is on.
import { CAPABILITIES, type Capability, chooseModel, switchCapability } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, field, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";
import { catalogue } from "../../../lib/server/ai-staff";

export async function switchAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/settings", async (session) => {
    const capability = field(form, "capability") as Capability;
    const on = field(form, "on");
    if (!(CAPABILITIES as readonly string[]).includes(capability) || (on !== "true" && on !== "false")) return invalid();
    await switchCapability(await appPool(), session, capability, on === "true");
    return undefined;
  });
}

// Settings → AI staff: the owner picks the model for one agent ("default" follows the shop's default, else the
// build's) through core's chooseModel under the form's key: one audited ops.model_choice row. Core refuses anyone but
// the owner, and an alias the platform's allow-list does not have enabled for the agent's role or this build does not
// serve.
export async function chooseModelAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/settings/ai", async (session, key) => {
    const agent = field(form, "agent");
    const alias = field(form, "alias");
    if (!agent || !alias) return invalid();
    await chooseModel(await appPool(), session, { agent, alias: alias === "default" ? null : alias }, catalogue(), key);
    return undefined;
  });
}
