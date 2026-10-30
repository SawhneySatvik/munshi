// db/test/v2's cluster, shared by both page projects: its setup may run once per process (it counts the exit hooks
// embedded-postgres adds on its first import), so the first project starts the cluster and every project is given its
// port; the cluster stops when the last project is done.
import type { TestProject } from "vitest/node";
import setup from "../../../db/test/v2/global-setup.ts";

// On globalThis: each project loads this module in its own module runner.
type Shared = { started?: Promise<{ port: number; stop: () => Promise<void> }>; users: number };
const shared = ((globalThis as { munshiSitesCluster?: Shared }).munshiSitesCluster ??= { users: 0 });

export default async function sharedSetup(project: TestProject) {
  shared.users++;
  shared.started ??= (async () => {
    let port = 0;
    const stop = await setup({ provide: (_key: string, value: number) => void (port = value) } as unknown as TestProject);
    return { port, stop };
  })();
  const { port, stop } = await shared.started;
  project.provide("pg17Port", port);
  return async () => {
    if (--shared.users === 0) await stop();
  };
}
