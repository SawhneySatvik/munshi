// The local stand-in for a scheduled tick: POSTs the jobs tick route once a minute while the app runs,
// with the CRON_SECRET the app was started with (it must be in this process's environment too; never printed). Dev only:
// a hosted deploy's Vercel cron and the repository's workflow call the same route. Ctrl-C stops it.
// Run: node scripts/dev-ticker.ts   (MUNSHI_TICK_URL overrides http://localhost:$PORT/api/internal/tick)
const url = process.env.MUNSHI_TICK_URL ?? `http://localhost:${process.env.PORT ?? "3000"}/api/internal/tick`;
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("dev-ticker: CRON_SECRET is not set; start it with the app's CRON_SECRET in the environment");
  process.exit(1);
}

async function tick(): Promise<void> {
  try {
    const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
    // The body names jobs and outcomes only.
    console.log(`dev-ticker: ${new Date().toISOString()} ${res.status} ${res.status === 200 ? await res.text() : ""}`);
  } catch (err) {
    console.error(`dev-ticker: ${url} did not answer (${err instanceof Error ? err.message : "error"})`);
  }
}

await tick();
setInterval(tick, 60_000);
