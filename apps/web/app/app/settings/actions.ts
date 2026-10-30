"use server";

// Settings → Capabilities (BLUEPRINT §8.13): the owner switches a capability on or off, through core's switchCapability
// as the signed-in member under the form's key. One audited ops row (capability.switch), never a book row; the database
// refuses anyone but an active owner, a switch-on while something it requires is off and a switch-off while something
// that requires it is on.
import { CAPABILITIES, type Capability, switchCapability } from "@munshi/core";
import type { ActState } from "../../../lib/app-types";
import { act, field, invalid } from "../../../lib/server/act";
import { appPool } from "../../../lib/server/db";

export async function switchAction(_prev: ActState, form: FormData): Promise<ActState> {
  return act(form, "/app/settings", async (session) => {
    const capability = field(form, "capability") as Capability;
    const on = field(form, "on");
    if (!(CAPABILITIES as readonly string[]).includes(capability) || (on !== "true" && on !== "false")) return invalid();
    await switchCapability(await appPool(), session, capability, on === "true");
    return undefined;
  });
}
