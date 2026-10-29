// The jobs tick (BLUEPRINT §4.4): the dev ticker POSTs here, and from the deploy wave the Vercel cron GETs it; either
// sends `Authorization: Bearer <CRON_SECRET>`. Anything else is a 404, as if the route did not exist (Munim gotcha 16),
// and opens no database connection. Its two settings, CRON_SECRET and JOBS_DATABASE_URL (role munshi_jobs), come
// through lib/server/config.ts, read on every request. Neither value is ever logged.
import { createHash, timingSafeEqual } from "node:crypto";
// By path until the orchestrator exports jobs.ts from @munshi/core (BP-JOBS-1's merge).
import { createJobsPool, runDueJobs } from "@munshi/core";
import { tickSettings } from "../../../../lib/server/config.ts";

type Pool = ReturnType<typeof createJobsPool>;

// Kept on globalThis so next dev's module reloads reuse one pool instead of opening a new one per edit.
const held = globalThis as typeof globalThis & { munshiJobsPool?: { url: string; pool: Pool } | undefined };

const digest = (s: string) => createHash("sha256").update(s).digest();

// Both sides hashed to 32 bytes, so timingSafeEqual compares equal lengths and the time taken says nothing about the
// secret. An unset or empty CRON_SECRET admits no one.
function authorized(request: Request): boolean {
  const secret = tickSettings().cronSecret;
  const given = request.headers.get("authorization") ?? "";
  return secret !== "" && timingSafeEqual(digest(given), digest(`Bearer ${secret}`));
}

async function tick(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response(null, { status: 404 });
  const url = tickSettings().jobsDatabaseUrl;
  if (!url) return Response.json({ error: "jobs_unconfigured" }, { status: 503 });
  if (held.munshiJobsPool?.url !== url) held.munshiJobsPool = { url, pool: createJobsPool(url) };
  const runs = await runDueJobs(held.munshiJobsPool.pool);
  return Response.json({ jobs: runs.map((r) => ({ job: r.job, outcome: r.outcome, ...(r.errorCode ? { errorCode: r.errorCode } : {}) })) });
}

export const GET = tick;
export const POST = tick;
