import "server-only";
import { type AiFeature, featureSwitches, type withPage } from "@munshi/core";

// Kept apart from ops.ts so the agent port can ask for the shop's switches without loading the screens' read helpers.
type Client = Parameters<Parameters<typeof withPage>[2]>[0];

/** The AI features the operator switched off for the member's shop, in a member transaction the caller holds. */
export async function switchedOffIn(c: Client): Promise<AiFeature[]> {
  const switches = await featureSwitches(c);
  return (Object.keys(switches) as AiFeature[]).filter((f) => !switches[f].on);
}
