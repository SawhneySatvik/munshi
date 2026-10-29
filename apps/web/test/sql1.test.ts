// SQL1 (BLUEPRINT §4.1), the web half: the app reads and writes the books only through core's views and commands, so no
// shipped file under apps/web carries SQL, outside the four that hold a connection or a session of their own
// (lib/server/{agent-port,session,config,db}.ts). Scanned as source text, with whole-line and block comments blanked
// (prose names tables): a query call, an import of pg, an SQL statement's opening words, and any schema-qualified
// table of the v2 schema (its manifests are the list). The tests are not shipped: their SQL is the independent check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { sabotageIs } from "../../../db/test/v2/sabotage/index.ts";

const ROOT = path.join(import.meta.dirname, "..", "..", "..");
const WEB = path.join(ROOT, "apps", "web");
const SKIP = new Set(["node_modules", ".next", ".screenshots", "test"]);
const ALLOWED = ["agent-port", "session", "config", "db"].map((f) => `apps/web/lib/server/${f}.ts`);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const at = path.join(dir, name);
    if (statSync(at).isDirectory()) return SKIP.has(name) ? [] : walk(at);
    return /\.(ts|tsx|mts|js|mjs|cjs)$/.test(name) ? [at] : [];
  });
}

// Whole-line `//` comments and block comments that open a line, blanked; code (strings included) is left as it is, so a
// comment after code is still read (a false alarm is visible, a blanked query would not be).
const uncommented = (text: string) =>
  text.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/.*$/gm, (m) => " ".repeat(m.length));

const TABLES = readdirSync(path.join(ROOT, "db", "schema"))
  .filter((f) => f.endsWith(".manifest.json"))
  .flatMap((f) => {
    const m = JSON.parse(readFileSync(path.join(ROOT, "db", "schema", f), "utf8")) as { tables?: string[]; views?: string[] };
    return [...(m.tables ?? []), ...(m.views ?? [])];
  });
const SCHEMAS = [...new Set(TABLES.map((t) => t.split(".")[0] as string))];
const qualified = new RegExp(`\\b(${TABLES.map((t) => t.replace(".", "\\s*\\.\\s*")).join("|")})\\b`, "i");
const DETECTORS: [string, RegExp][] = [
  ["a query call", /\.query\s*[<(]/],
  ["an import of pg", /\bfrom\s*["']pg["']|\b(require|import)\s*\(\s*["']pg["']\s*\)|^\s*import\s+["']pg["']/m],
  ["insert into", /\binsert\s+into\b/i],
  ["delete from", /\bdelete\s+from\b/i],
  ["update … set", /\bupdate\s+[a-z_."]+\s+set\b/i],
  ["from or join a schema's table", new RegExp(`\\b(from|join)\\s+"?(${SCHEMAS.join("|")})"?\\s*\\.`, "i")],
  ["a schema-qualified table", qualified],
];

test("SQL1 no file under apps/web runs SQL or names a table, outside lib/server/{agent-port,session,config,db}.ts", () => {
  const srcs = walk(WEB).map((file) => ({ file: path.relative(ROOT, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));
  if (sabotageIs("v2-sql1-planted")) srcs.push({ file: "apps/web/lib/server/ledger.ts", text: "await c.query('select 1 from books.sale')" });
  const scanned = srcs.filter((s) => !ALLOWED.includes(s.file));
  const files = new Set(scanned.map((s) => s.file));
  console.log(`SQL1 scanned ${scanned.length} source files under apps/web (${TABLES.length} tables from the v2 manifests)`);
  expect(TABLES.length).toBeGreaterThan(50);
  expect(scanned.length).toBeGreaterThan(50);
  // The screens whose SQL moved into core's views are in the scan, so a miss in the walk cannot pass for clean.
  for (const f of ["hero", "home", "ledger", "ops", "bills", "counter", "credit", "suppliers", "stock", "reports"]) expect(files, f).toContain(`apps/web/lib/server/${f}.ts`);
  for (const f of ["bills", "counter", "credit", "stock"]) expect(files, f).toContain(`apps/web/app/app/${f}/actions.ts`);
  const hits = scanned.flatMap((s) => {
    const text = uncommented(s.text);
    return DETECTORS.flatMap(([what, re]) => {
      const m = re.exec(text);
      return m ? [`${s.file}: ${what}: ${m[0]}`] : [];
    });
  });
  expect(hits).toEqual([]);
});
