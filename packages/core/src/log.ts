// One JSON line per event (BLUEPRINT §4.5), and the only module that writes to the console (gate SCAN-CONSOLE). A line
// holds fixed fields only, each checked against its shape (a label, an id, a number); a value outside its shape is
// dropped and named under `dropped`, never written. So a body, a name, a phone, a key, a token or model text cannot
// reach a log line, whatever a caller passes.
import { currentRequest } from './context.ts';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = {
  /** The route's pattern as the app names it (`/bills/[id]`), never the path asked for: a path can carry a code. */
  route?: string;
  tenantId?: string;
  /** A CoreError, ConfigError or boot code. */
  code?: string;
  sqlstate?: string;
  pool?: string;
  /** Setting names, as a ConfigError gives them. */
  names?: readonly string[];
  status?: number;
  durationMs?: number;
};

// Labels are short on purpose: a secret is long (32 bytes of hex, a provider key), so even a lowercase one is refused.
const LABEL = /^[a-z][a-z0-9_]{0,23}$/;
const EVENT = /^[a-z][a-z_]{0,23}(\.[a-z][a-z_]{0,23}){0,2}$/;
const ROUTE = /^\/$|^(\/([a-z][a-z0-9._-]{0,23}|\[{1,2}(\.\.\.)?[a-zA-Z]{1,24}\]{1,2}))+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SETTING = /^[A-Z][A-Z0-9_]{0,39}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const REQUEST_ID = /^[A-Za-z0-9:_-]{1,128}$/;

const text = (re: RegExp) => (v: unknown) => typeof v === 'string' && re.test(v);
const between = (lo: number, hi: number) => (v: unknown) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;

const SHAPES: { [K in keyof Required<LogFields>]: (value: unknown) => boolean } = {
  route: text(ROUTE),
  tenantId: text(UUID),
  code: text(LABEL),
  sqlstate: text(SQLSTATE),
  pool: text(LABEL),
  names: (v) => Array.isArray(v) && v.length <= 20 && v.every(text(SETTING)),
  status: between(100, 599),
  durationMs: between(0, 86_400_000),
};

export function log(event: string, fields: LogFields = {}, level: LogLevel = 'info'): void {
  const request = currentRequest();
  const labelled = EVENT.test(event);
  const line: Record<string, unknown> = { time: new Date().toISOString(), level, event: labelled ? event : 'unlabelled' };
  const dropped = labelled ? [] : ['event'];
  if (request && REQUEST_ID.test(request.requestId)) line.requestId = request.requestId;
  if (request?.tenantId && UUID.test(request.tenantId)) line.tenantId = request.tenantId;
  for (const key of Object.keys(SHAPES) as (keyof LogFields)[]) {
    const value = fields[key];
    if (value === undefined) continue;
    if (SHAPES[key](value)) line[key] = value;
    else dropped.push(key);
  }
  if (dropped.length) line.dropped = dropped;
  (level === 'info' ? console.log : console.error)(JSON.stringify(line));
}
