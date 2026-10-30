// The schema files (no migrations while building, D-043): db/schema/NN_name.sql in name order, each beside its
// hand-written NN_name.manifest.json fragment. 00_bootstrap.sql is the admin's (bootstrap.ts); 01–90 are the build's
// (build.ts), 90_seal last. The merged manifest is the independent list the gates count against.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA_DIR = fileURLToPath(new URL('../schema/', import.meta.url));
export const BOOTSTRAP_FILE = '00_bootstrap.sql';

export type SchemaFile = { name: string; sql: string };
export type Manifest = Record<string, unknown[] | Record<string, unknown>>;
export type Schema = { bootstrap: SchemaFile | undefined; files: SchemaFile[]; manifest: Manifest; sha256: string };

const SQL_NAME = /^(\d{2})_[a-z0-9_]+\.sql$/;
const FRAGMENT_NAME = /^\d{2}_[a-z0-9_]+\.manifest\.json$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// Lists and fragments concatenate, objects merge by key; an entry or key named twice is refused, so no count doubles.
function merge(into: Manifest, fragment: unknown, file: string): void {
  if (!isObject(fragment)) throw new Error(`${file}: a manifest fragment is a JSON object`);
  for (const [key, value] of Object.entries(fragment)) {
    const have = into[key];
    if (Array.isArray(value) && (have === undefined || Array.isArray(have))) {
      const list = have ?? [];
      for (const v of value) {
        if (list.some((x) => JSON.stringify(x) === JSON.stringify(v))) throw new Error(`${file}: ${key} lists ${JSON.stringify(v)} twice`);
        list.push(v);
      }
      into[key] = list;
    } else if (isObject(value) && (have === undefined || isObject(have))) {
      const object = have ?? {};
      for (const [k, v] of Object.entries(value)) {
        if (k in object) throw new Error(`${file}: ${key}.${k} is named twice`);
        object[k] = v;
      }
      into[key] = object;
    } else {
      throw new Error(`${file}: ${key} must be a list or an object in every fragment`);
    }
  }
}

// Throws on a missing directory: a mistyped path must never build an empty set.
export function readSchema(dir = SCHEMA_DIR): Schema {
  const names = readdirSync(dir).sort();
  const files: SchemaFile[] = [];
  let bootstrap: SchemaFile | undefined;
  for (const name of names.filter((n) => n.endsWith('.sql'))) {
    const nn = SQL_NAME.exec(name)?.[1];
    if (nn === undefined || Number(nn) > 90 || (nn === '00' && name !== BOOTSTRAP_FILE)) {
      throw new Error(`schema file ${name}: names are NN_name.sql, 00 only for ${BOOTSTRAP_FILE}, and nothing after 90`);
    }
    const file = { name, sql: readFileSync(path.join(dir, name), 'utf8') };
    if (nn === '00') bootstrap = file;
    else files.push(file);
  }
  const manifest: Manifest = {};
  for (const name of names.filter((n) => FRAGMENT_NAME.test(n))) {
    merge(manifest, JSON.parse(readFileSync(path.join(dir, name), 'utf8')), name);
  }
  // The .sql files only: the manifests change no database.
  const hash = createHash('sha256');
  for (const f of bootstrap ? [bootstrap, ...files] : files) hash.update(`${f.name}\0${f.sql}\0`);
  return { bootstrap, files, manifest, sha256: hash.digest('hex') };
}

// One file in one transaction; the error names the file.
export async function applyFile(client: { query(sql: string): Promise<unknown> }, file: SchemaFile): Promise<void> {
  await client.query('begin');
  try {
    await client.query(file.sql);
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw new Error(`schema file ${file.name} failed: ${(err as Error).message}`);
  }
}
