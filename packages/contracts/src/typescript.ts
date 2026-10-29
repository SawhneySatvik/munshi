// openapi.json → the SDK's types (packages/sdk/src/schema.gen.ts, BLUEPRINT §5.6). Only the JSON Schema keywords the
// contracts use are understood; any other keyword throws, so the emitter can never quietly widen a type to unknown.
// Optional properties are `?: T | undefined`, which is what zod infers under exactOptionalPropertyTypes.
import { COMPONENT, type Json, type JsonObject } from './openapi.ts';

const CHECKS = new Set(['minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'minItems', 'maxItems', 'contentMediaType']);
const SHAPE = new Set(['type', 'properties', 'required', 'additionalProperties', 'propertyNames', 'items', 'enum', 'const', 'anyOf', 'oneOf', '$ref']);
const AUTH = { publishableKey: 'publishable', secretKey: 'secret' } as const;

export function emitTypes(doc: JsonObject): string {
  const schemas = (doc.components as JsonObject).schemas as JsonObject;
  const ids = Object.keys(schemas).sort();
  const out = [
    '// Generated from packages/contracts/openapi.json by packages/contracts/src/build.ts (pnpm contracts). Do not edit:',
    '// change the zod schemas in packages/contracts/src/v1/ and regenerate. Types only; the SDK has no runtime dependency.',
    '',
  ];
  for (const id of ids) out.push(`export type ${id} = ${type(schemas[id] as JsonObject, '', id)};`, '');

  out.push('export interface Schemas {', ...ids.map((id) => `  ${id}: ${id};`), '}', '');

  const ops: [string, string[]][] = [];
  for (const [path, item] of Object.entries(doc.paths as JsonObject)) {
    for (const [method, raw] of Object.entries(item as JsonObject)) {
      const op = raw as JsonObject;
      const x = op['x-munshi-schemas'] as Record<string, string | null>;
      const security = op.security as JsonObject[];
      const scheme = Object.keys(security[0] ?? {})[0] as keyof typeof AUTH | undefined;
      const status = Object.keys(op.responses as JsonObject).find((s) => s.startsWith('2'));
      ops.push([
        op.operationId as string,
        [
          `  ${op.operationId}: {`,
          `    method: ${JSON.stringify(method.toUpperCase())};`,
          `    path: ${JSON.stringify(path)};`,
          `    auth: ${JSON.stringify(scheme ? AUTH[scheme] : 'none')};`,
          `    params: ${x.params ?? 'undefined'};`,
          `    query: ${x.query ?? 'undefined'};`,
          `    headers: ${x.headers ?? 'undefined'};`,
          `    body: ${x.body ?? 'undefined'};`,
          `    status: ${status};`,
          // A media route streams bytes; nothing in the SDK parses them.
          `    response: ${x.response ?? 'ArrayBuffer'};`,
          `    deferred: ${op['x-munshi-deferred'] === true};`,
          '  };',
        ],
      ]);
    }
  }
  ops.sort(([a], [b]) => a.localeCompare(b));
  out.push('export interface Operations {', ...ops.flatMap(([, lines]) => lines), '}', '');
  return out.join('\n');
}

function type(s: JsonObject, indent: string, at: string): string {
  for (const k of Object.keys(s)) {
    if (!SHAPE.has(k) && !CHECKS.has(k)) throw new Error(`contracts: ${at} uses ${k}, which the type emitter does not read`);
  }
  if (typeof s.$ref === 'string') {
    if (!s.$ref.startsWith(COMPONENT)) throw new Error(`contracts: ${at} refers outside the components`);
    return s.$ref.slice(COMPONENT.length);
  }
  const members = (s.anyOf ?? s.oneOf) as JsonObject[] | undefined;
  if (members) return members.map((m, i) => type(m, indent, `${at}|${i}`)).join(' | ');
  if ('const' in s) return literal(s.const as Json, at);
  if (Array.isArray(s.enum)) return s.enum.map((v) => literal(v, at)).join(' | ');
  switch (s.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const item = type(s.items as JsonObject, indent, `${at}[]`);
      return /[ |]/.test(item) && !item.startsWith('{') ? `(${item})[]` : `${item}[]`;
    }
    case 'object':
      return object(s, indent, at);
    default:
      throw new Error(`contracts: ${at} has no type the emitter knows`);
  }
}

function object(s: JsonObject, indent: string, at: string): string {
  const props = s.properties as JsonObject | undefined;
  if (props) {
    // Every object in the contracts is strict: an open one would type as narrower than what it accepts.
    if (s.additionalProperties !== false) throw new Error(`contracts: ${at} is an object that is not strict`);
    const required = new Set((s.required as string[] | undefined) ?? []);
    const inner = `${indent}  `;
    const lines = Object.entries(props).map(([k, p]) => {
      const t = type(p as JsonObject, inner, `${at}.${k}`);
      return required.has(k) ? `${inner}${key(k)}: ${t};` : `${inner}${key(k)}?: ${t} | undefined;`;
    });
    return `{\n${lines.join('\n')}\n${indent}}`;
  }
  if (typeof s.additionalProperties === 'object' && s.additionalProperties !== null) {
    return `Record<string, ${type(s.additionalProperties as JsonObject, indent, `${at}.*`)}>`;
  }
  throw new Error(`contracts: ${at} is an object with neither properties nor a value schema`);
}

const key = (k: string) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k) ? k : JSON.stringify(k));

function literal(v: Json, at: string): string {
  if (v !== null && typeof v === 'object') throw new Error(`contracts: ${at} has a non-scalar literal`);
  return JSON.stringify(v);
}
