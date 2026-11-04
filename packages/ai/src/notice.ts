// Model notices: a deployment with no key for a model, and the binding or chain step taken instead. This package writes
// nothing to the console (only core's logger may) and may import no core module at all (the provider layer stands
// alone, and a boundary test holds it to that), so the app hands in core's logger (apps/web lib/server/agent-port.ts:
// onModelNotice → log). A notice carries names only: the setting that is missing (its name, never its value) and the
// role, each held to log.ts's shapes there; a failed call adds its error code and the provider's HTTP status, never text.
export type ModelNotice = { names?: readonly string[]; code?: string; status?: number };
type Sink = (event: string, fields: ModelNotice) => void;

let sink: Sink = () => {};

/** Where notices go; returns a function that puts the previous sink back. Without one, they go nowhere. */
export function onModelNotice(next: Sink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

export function notice(event: string, fields: ModelNotice): void {
  sink(event, fields);
}

/** The setting a "<NAME> is not set" error names (client.ts apiKey); null for any other message. */
export const missingSetting = (message: string): string | null => /^([A-Z][A-Z0-9_]{0,39}) is not set$/.exec(message)?.[1] ?? null;
