// Run before a hosted deploy, from a clean checkout of the commit being deployed:
//   node --env-file=.env.production scripts/deploy-check.ts
// The variables are the deploy's own (the six pool URLs, MUNSHI_DEPLOYMENT, and any channel settings) plus
// MIGRATOR_DATABASE_URL. Exits 1 with the problems (variable, role and schema names only, never a URL, a password or a
// server message) unless every check in db/src/deploy-check.ts passes. See deploy/supabase.md.
import { databaseTls, applyDatabaseTls } from '../packages/core/src/pool.ts';
import { deployCheck } from '../db/src/deploy-check.ts';

applyDatabaseTls(databaseTls(process.env.MUNSHI_DB_CA)); // a hosted database is verified against its root

const { problems, notes } = await deployCheck(process.env);
for (const note of notes) console.log(`deploy-check: ${note}`);
if (problems.length) {
  console.error(`deploy-check: refused\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('deploy-check: ok (each URL is its own role, the database is this commit\'s build and its deployment, and Supabase\'s roles reach nothing of ours)');
process.exit(0);
