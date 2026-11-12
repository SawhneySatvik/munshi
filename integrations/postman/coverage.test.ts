// POSTMAN1: the collection on disk is the one build.ts makes from packages/contracts/openapi.json today, and it carries
// one request for every operation the contract states, by method and path, and no request the contract does not state.
// POSTMAN2: the hosted environment holds no secret value, and no request carries a key in its URL.
// Run: pnpm postman:check (node --test). Red-proof: docs/postman.md.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COLLECTION_FILE, collectionText, OPENAPI_FILE, type OpenApi, postmanPath } from './build.ts';

type Item = { name: string; item?: Item[]; request?: { method: string; url: { raw: string } } };
const spec = JSON.parse(readFileSync(OPENAPI_FILE, 'utf8')) as OpenApi;
const text = readFileSync(COLLECTION_FILE, 'utf8');
const collection = JSON.parse(text) as { item: Item[] };

const requests = (items: Item[]): NonNullable<Item['request']>[] => items.flatMap((i) => (i.item ? requests(i.item) : i.request ? [i.request] : []));
const folder = (name: string) => collection.item.find((i) => i.name === name) as Item;

test('POSTMAN1 every operation in openapi.json has its request, and the collection is built from it today', () => {
  assert.equal(text, collectionText(spec), 'the collection is stale: run pnpm postman:build');
  const stated = Object.entries(spec.paths)
    .flatMap(([path, ops]) => Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => `${m.toUpperCase()} {{baseUrl}}/api/v1${postmanPath(path)}`))
    .sort();
  const made = requests(folder('Public API v1').item ?? [])
    .map((r) => `${r.method} ${r.url.raw.split('?')[0]}`)
    .sort();
  assert.ok(stated.length > 0);
  assert.deepEqual(made, stated);
  for (const name of ['Integration feed', 'Public API v1', 'PayPal sandbox']) assert.ok(folder(name), name);
});

test('POSTMAN2 the environments hold no secret value, and no key rides in a URL', () => {
  for (const env of ['munshi-hosted', 'munshi-local']) {
    const values = (JSON.parse(readFileSync(fileURLToPath(new URL(`${env}.postman_environment.json`, import.meta.url)), 'utf8')) as { values: { key: string; value: string; type: string }[] }).values;
    for (const v of values.filter((x) => x.type === 'secret')) assert.equal(v.value, '', `${env} ${v.key}`);
    for (const key of ['integrationSecret', 'paypalClientId', 'paypalClientSecret']) assert.equal(values.find((v) => v.key === key)?.type, 'secret', `${env} ${key}`);
  }
  for (const r of requests(collection.item)) assert.doesNotMatch(r.url.raw, /Secret|ClientId|Key\}\}|token=/i, r.url.raw);
});
