// Red-proofs of the API v1 contracts and the SDK (packages/contracts/test, packages/sdk/test): each breaks one
// protection and its named test must fail. They run in each package's own vitest (no database), with the v2 plugin.
import type { Case } from './case.ts';

const CONTRACTS = 'packages/contracts';
const SDK = 'packages/sdk';
const V1 = `${CONTRACTS}/src/v1`;

const FRESH1 = 'openapi.json is byte for byte a fresh generation from the zod schemas';
const FRESH2 = 'the SDK schema.gen.ts is byte for byte a fresh generation from openapi.json';
const FRESH3 = 'two generations give identical bytes';
const FIG1 = 'no response of any route carries a number outside a figure';
const FIG2 = 'each route reaches exactly the figures its resource holds, and nothing else';
const FIG3 = 'the walker finds a planted bare number, a number constant and an untyped node';
const FIG4 = 'a figure is refused without its ref, and a derived figure without the refs it came from';
const CV1 = 'a ref that cannot be traced answers exactly "Cannot verify", and a verified one carries its cell and source';
const ERR1 = 'every error answers the one body, its message fixed per code, never a database message or a value';
const IDEM1 = 'every POST and DELETE requires Idempotency-Key, 8 to 128 of A-Z a-z 0-9 _ -, and no GET takes one';
const AUTH1 = 'published reads take no key, the public writes take the publishable key, the secret-key routes are deferred';
const PAGE1 = 'every list answers a cursor page and takes cursor and limit, at most 100';
const STRICT1 = 'every params, query, header and body schema refuses an unknown field';
const LIM1 = "the contract's limits are the SQL's";
const TYPE1 = 'the SDK types and the zod-inferred types are identical, both ways, for every component and every route';
const SDK1 = 'the package.json names no dependency of any kind';
const SDK2 = 'the source imports only its own files: no package, no node: builtin, nothing outside src';
const SDK3 = 'every route the SDK serves has its method, and each sends its route method to its path';
const SDK4 = 'every write sends a fresh Idempotency-Key, or the one the form render made, and no read sends one';
const SDK5 = "an error surfaces as its error code, status and request id, never the server's text";
const SDK6 =
  'the key travels only in the Authorization header of a write, the hold token only where the contract puts it, and neither in a URL, an error or the console';
const SDK7 = 'formatMoney works in whole minor units with Indian grouping, and a figure that cannot trace says "Cannot verify"';

const con = (sabotage: string, file: string, test: string, source: string, from: string, to: string): Case => ({
  sabotage,
  file: `test/${file}`,
  test,
  dir: CONTRACTS,
  config: 'vitest.config.ts',
  ts: { file: source, from, to },
});
const sdk = (sabotage: string, file: string, test: string, from: string, to: string, source = `${SDK}/src/index.ts`): Case => ({
  sabotage,
  file: `test/${file}`,
  test,
  dir: SDK,
  config: 'vitest.config.ts',
  ts: { file: source, from, to },
});
// Harness-level: the test plants the breach in what it reads (tsc and package.json are read from disk, out of the
// plugin's reach).
const planted = (sabotage: string, dir: string, file: string, test: string): Case => ({ sabotage, file: `test/${file}`, test, dir, config: 'vitest.config.ts' });

export const CORE_CONTRACTS_CASES: Case[] = [
  // a schema edited without regenerating: openapi.json is stale
  con('v2-con-fresh-schema', 'freshness.test.ts', FRESH1, `${V1}/orders.ts`, 'lines: z.array(OrderLineInput).min(1).max(20),', 'lines: z.array(OrderLineInput).min(1).max(21),'),
  // the emitter changed alone: openapi.json still fresh, schema.gen.ts stale
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of typescript.ts, not a template
  con('v2-con-fresh-emitter', 'freshness.test.ts', FRESH2, `${CONTRACTS}/src/typescript.ts`, '`${inner}${key(k)}?: ${t} | undefined;`', '`${inner}${key(k)}?: ${t};`'),
  // a clock in the output: two runs differ
  con('v2-con-fresh-clock', 'freshness.test.ts', FRESH3, `${CONTRACTS}/src/openapi.ts`, "title: 'Munshi API',", "title: 'Munshi API', 'x-built': String(process.hrtime.bigint()),"),
  // a bare count in a response
  con('v2-con-bare-number', 'figures.test.ts', FIG1, `${V1}/slots.ts`, 'slots: z.array(Slot).max(2000) });', 'slots: z.array(Slot).max(2000), count: z.int() });'),
  // a figure turned into text: no bare number, but a duration's digits now travel with no ref
  con('v2-con-figure-dropped', 'figures.test.ts', FIG2, `${V1}/services.ts`, 'duration: IntFigure,', 'duration: z.string(),'),
  // the walker stops seeing integers, so FIG1 would pass on anything
  con('v2-con-walker-blind', 'figures.test.ts', FIG3, `${CONTRACTS}/src/figures.ts`, "    case 'number':\n      found.add(at);", "    case 'number':"),
  con('v2-con-ref-nullable', 'figures.test.ts', FIG4, `${V1}/common.ts`, 'currency: Currency, ref: Ref });\nexport const IntFigure', 'currency: Currency, ref: Ref.nullable() });\nexport const IntFigure'),
  con('v2-con-cannot-verify', 'figures.test.ts', CV1, `${V1}/refs.ts`, "label: z.literal('Cannot verify')", 'label: z.string()'),
  // an error message that takes any text, a database message included
  con('v2-con-error-free-text', 'contracts.test.ts', ERR1, `${V1}/common.ts`, "message: z.literal<(typeof ERRORS)[C]['message']>(ERRORS[code].message),", 'message: z.string(),'),
  con('v2-con-idempotency-dropped', 'contracts.test.ts', IDEM1, `${V1}/holds.ts`, "z.strictObject({ 'Idempotency-Key': IdempotencyKey, 'X-Munshi-Device': DeviceToken })", "z.strictObject({ 'X-Munshi-Device': DeviceToken })"),
  con('v2-con-write-without-key', 'contracts.test.ts', AUTH1, `${V1}/routes.ts`, "const write = { method: 'POST', auth: 'publishable',", "const write = { method: 'POST', auth: 'none',"),
  con('v2-con-page-limit', 'contracts.test.ts', PAGE1, `${V1}/common.ts`, 'z.coerce.number().int().min(1).max(100);', 'z.coerce.number().int().min(1).max(500);'),
  con('v2-con-loose-body', 'contracts.test.ts', STRICT1, `${V1}/bookings.ts`, 'export const BookingBody = z.strictObject({', 'export const BookingBody = z.object({'),
  con('v2-con-sql-limit', 'contracts.test.ts', LIM1, `${V1}/common.ts`, 'export const PersonName = z.string().min(1).max(80);', 'export const PersonName = z.string().min(1).max(81);'),
  // the SDK's type gains an optional field the zod type lacks, or loses one it has
  planted('v2-con-types-sdk-wider', CONTRACTS, 'types.test.ts', TYPE1),
  planted('v2-con-types-sdk-narrower', CONTRACTS, 'types.test.ts', TYPE1),

  planted('v2-sdk-dependency', SDK, 'package.test.ts', SDK1),
  planted('v2-sdk-import', SDK, 'package.test.ts', SDK2),
  sdk('v2-sdk-wrong-path', 'client.test.ts', SDK3, "get<'services'>('/sites/{slug}/services',", "get<'services'>('/sites/{slug}/service',"),
  sdk('v2-sdk-idempotency-reused', 'client.test.ts', SDK4, 'options.idempotencyKey ?? newIdempotencyKey();', "options.idempotencyKey ?? 'fixed-key-0001';"),
  // the server's fields kept as sent, a phone number among them
  sdk('v2-sdk-server-text', 'client.test.ts', SDK5, "e.fields.filter((f): f is string => typeof f === 'string' && FIELD.test(f))", '(e.fields as string[])'),
  sdk('v2-sdk-key-in-url', 'client.test.ts', SDK6, 'const qs = search.toString();', "if (key) search.set('key', key);\n    const qs = search.toString();"),
  // back to URLSearchParams.size, which Safari 16 lacks: every query silently dropped there
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the source text of index.ts, not a template
  sdk('v2-sdk-query-size', 'client.test.ts', SDK3, 'const qs = search.toString();\n    if (qs) url += `?${qs}`;', 'if (search.size) url += `?${search}`;'),
  sdk('v2-sdk-unverified-figure', 'client.test.ts', SDK7, 'if (!traces(figure)) return CANNOT_VERIFY;', '', `${SDK}/src/money.ts`),
];
