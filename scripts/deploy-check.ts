// Run before a hosted deploy: node --env-file=.env.production scripts/deploy-check.ts
// Exits 1 with the problems (variable names only, never a URL) unless the app connects as munshi_app, the migrator is a
// separate munshi_migrator login, and neither is a superuser. See deploy/neon.md.
import { deployCheck } from '../db/src/deploy-check.ts';

const problems = await deployCheck(process.env);
if (problems.length) {
  console.error(`deploy-check: refused\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('deploy-check: ok (app is munshi_app, migrator is a separate non-superuser login)');
