// Guarantee clause 2 in the contract: where a number may sit in a response. Each operation's response schemas are walked
// through their refs, and every integer or number node is named by its component and property path. Only the four
// figure shapes' digits are allowed; anything else, or a node of no known type (which could hold a number), is bare.
import { COMPONENT, type Json, type JsonObject } from './openapi.ts';

export const FIGURE_SITES = ['MoneyFigure.minor', 'IntFigure.value', 'DerivedMoney.minor', 'RequestedQty.qtyMilli'];

// The numeric sites each operation's responses reach, sorted.
export function numberSites(doc: JsonObject): Record<string, string[]> {
  const schemas = (doc.components as JsonObject).schemas as JsonObject;
  const out: Record<string, string[]> = {};
  for (const item of Object.values(doc.paths as JsonObject)) {
    for (const op of Object.values(item as JsonObject) as JsonObject[]) {
      const found = new Set<string>();
      const seen = new Set<string>();
      for (const response of Object.values(op.responses as JsonObject) as JsonObject[]) {
        const json = (response.content as JsonObject)['application/json'] as JsonObject | undefined;
        if (json) walk(json.schema as JsonObject, 'response', schemas, seen, found);
      }
      out[op.operationId as string] = [...found].sort();
    }
  }
  return out;
}

export function bareNumbers(doc: JsonObject): string[] {
  return Object.entries(numberSites(doc)).flatMap(([op, sites]) => sites.filter((s) => !FIGURE_SITES.includes(s)).map((s) => `${op}: ${s}`));
}

function walk(s: JsonObject, at: string, schemas: JsonObject, seen: Set<string>, found: Set<string>): void {
  if (typeof s.$ref === 'string') {
    const id = s.$ref.slice(COMPONENT.length);
    if (!seen.has(id)) {
      seen.add(id);
      walk(schemas[id] as JsonObject, id, schemas, seen, found);
    }
    return;
  }
  const members = (s.anyOf ?? s.oneOf) as JsonObject[] | undefined;
  if (members) {
    for (const m of members) walk(m, at, schemas, seen, found);
    return;
  }
  const values: Json[] = [...('const' in s ? [s.const as Json] : []), ...((s.enum as Json[] | undefined) ?? [])];
  if (values.some((v) => typeof v === 'number')) found.add(at);
  switch (s.type) {
    case 'integer':
    case 'number':
      found.add(at);
      return;
    case 'object':
      for (const [k, p] of Object.entries((s.properties as JsonObject | undefined) ?? {})) walk(p as JsonObject, `${at}.${k}`, schemas, seen, found);
      if (typeof s.additionalProperties === 'object' && s.additionalProperties !== null) {
        walk(s.additionalProperties as JsonObject, `${at}.*`, schemas, seen, found);
      }
      return;
    case 'array':
      walk(s.items as JsonObject, `${at}[]`, schemas, seen, found);
      return;
    case 'string':
    case 'boolean':
    case 'null':
      return;
    default:
      found.add(`${at} (untyped)`);
  }
}
