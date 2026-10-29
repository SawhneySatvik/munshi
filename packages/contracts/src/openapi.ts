// The OpenAPI 3.1 document of API v1 (BLUEPRINT §5.6): zod 4's own JSON Schema output for the components, and the route
// table for the paths. Pure and deterministic: components and paths are sorted, nothing reads the clock or the disk.
import { z } from 'zod';
import { ERRORS, type ErrorCodeName } from './v1/errors.ts';
import { type RouteDef, routes } from './v1/routes.ts';
import { idOf, registry } from './v1/schemas.ts';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

export const COMPONENT = '#/components/schemas/';
const ref = (schema: z.ZodType): JsonObject => ({ $ref: COMPONENT + idOf(schema) });
const header = (name: string): JsonObject => ({ $ref: `#/components/headers/${name}` });
const SCHEME = { publishable: 'publishableKey', secret: 'secretKey' } as const;

export function buildOpenApi(): JsonObject {
  const out = z.toJSONSchema(registry, { uri: (id) => COMPONENT + id, unrepresentable: 'throw' });
  const schemas: JsonObject = {};
  for (const id of Object.keys(out.schemas).sort()) {
    // A fragment $id is not a valid JSON Schema 2020-12 id, and the dialect is declared once, below.
    const { $id: _id, $schema: _schema, ...rest } = out.schemas[id] as JsonObject;
    schemas[id] = rest;
  }

  const paths: { [path: string]: JsonObject } = {};
  const table = Object.entries(routes) as [string, RouteDef][];
  table.sort(([a, x], [b, y]) => (x.path === y.path ? x.method.localeCompare(y.method) : x.path.localeCompare(y.path)) || a.localeCompare(b));
  for (const [operationId, r] of table) {
    paths[r.path] ??= {};
    (paths[r.path] as JsonObject)[r.method.toLowerCase()] = operation(operationId, r, schemas);
  }

  return {
    openapi: '3.1.1',
    info: {
      title: 'Munshi API',
      version: '1',
      description: [
        "A small public API that serves only what a shop's owner published, takes requests only with a publishable key,",
        'and never changes the books: every figure is a ledger row (a snapshot cell with its ref), and nothing you send',
        'changes the books until a person at the shop approves it. Simulated data on the demo deployment is labelled.',
        'A path parameter that fails its schema is an unknown route (404 not_found). Every POST and DELETE carries',
        'Idempotency-Key. A bad, revoked or wrong-origin key answers 404 as an unknown route; the member session cookie',
        'is never read here. Every response carries Munshi-Api-Version: 1.',
      ].join(' '),
    },
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    servers: [{ url: '/api/v1' }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        publishableKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'mpk_<slug>_<43 base64url characters>',
          description: "A site's publishable key, for the public writes of that slug's site. Never in a URL, never logged.",
        },
        secretKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'msk_<slug>_<43 base64url characters>',
          description: 'Deferred: specified, not built. Server to server only; a request with an Origin header is refused.',
          'x-munshi-deferred': true,
        },
      },
      headers: {
        MunshiApiVersion: { description: 'The major version, on every response.', schema: { type: 'string', const: '1' } },
        RequestId: { description: 'The request id, also in an error body.', schema: { type: 'string' } },
        ETag: { description: 'The release id the response was built from.', schema: { type: 'string' } },
        RetryAfter: { description: 'Seconds to wait.', schema: { type: 'integer', minimum: 1 } },
      },
    },
  };
}

function operation(operationId: string, r: RouteDef, schemas: JsonObject): JsonObject {
  const named = (s: z.ZodType | undefined) => (s ? idOf(s) : null);
  const parameters = [...parametersOf(r.params, 'path', schemas), ...parametersOf(r.query, 'query', schemas), ...parametersOf(r.headers, 'header', schemas)];
  const inPath = [...r.path.matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]);
  const declared = parameters.filter((p) => p.in === 'path').map((p) => p.name);
  if (inPath.join() !== declared.join()) throw new Error(`contracts: ${operationId}'s path and its params disagree`);

  const always = { 'Munshi-Api-Version': header('MunshiApiVersion'), 'x-request-id': header('RequestId') };
  const content: JsonObject =
    typeof r.response === 'string' ? { [r.response]: { schema: { type: 'string', contentMediaType: r.response } } } : { 'application/json': { schema: ref(r.response) } };
  const responses: JsonObject = {
    [r.status]: {
      description: { 200: 'OK', 201: 'Created', 202: 'Accepted' }[r.status],
      headers: r.cache === 'public, s-maxage=60' ? { ...always, ETag: header('ETag') } : always,
      content,
    },
  };
  const byStatus = new Map<number, ErrorCodeName[]>();
  for (const code of r.errors) byStatus.set(ERRORS[code].status, [...(byStatus.get(ERRORS[code].status) ?? []), code]);
  for (const [status, codes] of [...byStatus].sort(([a], [b]) => a - b)) {
    responses[status] = {
      description: codes.join(', '),
      headers: status === 429 ? { ...always, 'Retry-After': header('RetryAfter') } : always,
      content: { 'application/json': { schema: { $ref: `${COMPONENT}ErrorBody` } } },
      'x-munshi-error-codes': codes,
    };
  }

  return {
    operationId,
    summary: r.summary,
    security: r.auth === 'none' ? [] : [{ [SCHEME[r.auth]]: [] }],
    parameters,
    ...(r.body ? { requestBody: { required: true, content: { 'application/json': { schema: ref(r.body) } } } } : {}),
    responses,
    'x-munshi-schemas': {
      params: named(r.params),
      query: named(r.query),
      headers: named(r.headers),
      body: named(r.body),
      response: typeof r.response === 'string' ? null : idOf(r.response),
    },
    'x-munshi-cache': r.cache,
    'x-munshi-writes': r.writes ?? null,
    'x-munshi-deferred': r.deferred,
  };
}

// An object schema's properties as OpenAPI parameters, each with its own JSON Schema.
function parametersOf(s: z.ZodType | undefined, where: 'path' | 'query' | 'header', schemas: JsonObject): { name: string; in: string; required: boolean; schema: Json }[] {
  if (!s) return [];
  const component = schemas[idOf(s)] as { properties?: JsonObject; required?: string[] };
  if (!component.properties) throw new Error(`contracts: ${idOf(s)} is not an object schema`);
  return Object.entries(component.properties).map(([name, schema]) => {
    const required = component.required?.includes(name) ?? false;
    if (where === 'path' && !required) throw new Error(`contracts: path parameter ${name} must be required`);
    return { name, in: where, required, schema };
  });
}
