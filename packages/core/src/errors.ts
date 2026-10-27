// Every error leaving packages/core is a CoreError: a code and a fixed message. A raw Postgres error is never passed on,
// not even as `cause`: its message and DETAIL carry row values ("Key (…, bill_no)=(…, B-17) already exists").

export type CoreCode = 'refused' | 'conflict' | 'invalid' | 'not_found' | 'not_proposed' | 'unbalanced' | 'unknown_query' | 'internal';

const MESSAGES: Record<CoreCode, string> = {
  refused: 'Not allowed.',
  conflict: 'That record already exists or changed at the same time.',
  invalid: 'The request is not valid.',
  not_found: 'Not found.',
  not_proposed: 'This draft has already been decided.',
  unbalanced: 'The journal entry does not balance.',
  unknown_query: 'No such named read.',
  internal: 'Something went wrong.',
};

export class CoreError extends Error {
  readonly code: CoreCode;
  readonly sqlstate: string | undefined; // the Postgres SQLSTATE (MS001, 23505, …) when the database refused
  readonly constraint: string | undefined; // a constraint name, never its values
  readonly fields: string[] | undefined; // input paths that failed validation, never their values

  constructor(code: CoreCode, detail: { sqlstate?: string; constraint?: string; fields?: string[] } = {}) {
    super(MESSAGES[code]);
    this.name = 'CoreError';
    this.code = code;
    this.sqlstate = detail.sqlstate;
    this.constraint = detail.constraint;
    this.fields = detail.fields;
  }
}

const BY_SQLSTATE: Record<string, CoreCode> = {
  MS001: 'refused', // book write refused (the guard)
  MS002: 'refused', // decision or draft refused
  MS003: 'refused', // verify_chain for another tenant
  MS004: 'unbalanced',
  MS005: 'refused', // audit entry refused
  MS006: 'refused', // a line or cell after its parent's transaction
  MS007: 'refused', // member refused
  '42501': 'refused', // no privilege, or a row outside the tenant (RLS)
  '25006': 'refused', // a write inside a read-only named read
  '23505': 'conflict',
  '40001': 'conflict',
  '40P01': 'conflict',
  '23503': 'invalid',
  '23502': 'invalid',
  '23514': 'invalid',
  '22P02': 'invalid',
  '22003': 'invalid',
  '22007': 'invalid',
  '22008': 'invalid',
};

export function toCoreError(err: unknown): CoreError {
  if (err instanceof CoreError) return err;
  const e = (typeof err === 'object' && err !== null ? err : {}) as { code?: unknown; constraint?: unknown };
  const sqlstate = typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : undefined;
  const code = (sqlstate && BY_SQLSTATE[sqlstate]) || 'internal';
  const constraint = typeof e.constraint === 'string' && /^[a-z0-9_]+$/.test(e.constraint) ? e.constraint : undefined;
  return new CoreError(code, { ...(sqlstate ? { sqlstate } : {}), ...(constraint ? { constraint } : {}) });
}
