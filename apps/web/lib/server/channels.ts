// What the channel screens may know of the deployment's channels (core's channelState): the send mode, which
// credentials are set, and the Instagram account ref the grant must name; never a token, a secret or an id. No route gives a
// campaign's card a public HTTPS address yet, so Instagram is never live here (outbox.ts wires no Instagram sender).
import { type ChannelDeploy, channelDeployOf } from "@munshi/core";
import { config } from "./config";

export function channelDeploy(): ChannelDeploy {
  return channelDeployOf(config(), false);
}
