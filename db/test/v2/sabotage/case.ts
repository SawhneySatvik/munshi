// A red-proof case (test/redproof.ts): it breaks exactly one protection and names the gate test that must then fail.
//   sql  — run as superuser in the test file's fresh database, at the end of its beforeAll (TestDb.sabotage);
//   ts   — a source-text mutation applied as vitest loads the module (sabotagePlugin, in each vitest config);
//   none — harness-level: the code under test asks sabotageIs(name).
export type Mutation = { file: string; from: string; to: string }; // file relative to the repo root
export type Case = { sabotage: string; file: string; test: string; dir?: string; config?: string; sql?: string; ts?: Mutation }; // dir: default 'db'; config: relative to dir
