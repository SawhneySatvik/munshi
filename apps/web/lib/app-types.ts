// The shapes the BP-APP screens share. Every figure is a SourceRef into one of the page's snapshots (lib/types.ts).
import type { OpsError } from "./ops-types";
import type { Member, Snapshot } from "./types";

/** A BP-APP form's outcome: nothing yet, a refusal in the screen's words, or done (the page re-renders from the books). */
export type ActState = { error: OpsError } | { done: true } | null;

/** What every BP-APP page carries: who is signed in, the shop's name, the snapshots its figures point into, the
 *  commands the member's role holds and the page's idempotency key (one per render; each form derives its own). */
export type Frame = { member: Member; shop: string; snapshots: Snapshot[]; may: string[]; formKey: string };
