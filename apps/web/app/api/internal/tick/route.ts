// The jobs tick (BLUEPRINT §4.4): the dev ticker POSTs here, and from the deploy wave the Vercel cron GETs it; either
// sends `Authorization: Bearer <CRON_SECRET>`. Anything else is a 404, as if the route did not exist (Munim gotcha 16),
// and opens no database connection. Its two settings, CRON_SECRET and JOBS_DATABASE_URL (role munshi_jobs), come
// through lib/server/config.ts, read on every request. Neither value is ever logged.
import { createHash, timingSafeEqual } from "node:crypto";
import { runBackOffice, runDueJobs } from "@munshi/core";
import { tickSettings } from "../../../../lib/server/config.ts";
import { jobsPool, wireOutbox } from "../../../../lib/server/outbox.ts";

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
  const pool = jobsPool();
  if (!pool) return Response.json({ error: "jobs_unconfigured" }, { status: 503 });
  wireOutbox();
  const runs = await runDueJobs(pool);
  // Then the back office: the watchers hourly and each branch's morning brief (templated lines until the brief's
  // narrator is wired with allow()).
  const office = await runBackOffice(pool);
  return Response.json({
    jobs: runs.map((r) => ({ job: r.job, outcome: r.outcome, ...(r.errorCode ? { errorCode: r.errorCode } : {}) })),
    backOffice: office.map((r) => ({ kind: r.kind, outcome: r.outcome })),
  });
}

export const GET = tick;
export const POST = tick;
