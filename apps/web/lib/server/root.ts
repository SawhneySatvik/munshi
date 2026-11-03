// The repo root (server only): the directory holding pnpm-workspace.yaml. next runs with apps/web as its working
// directory, so run-time paths (.run/, the recorded model responses) are found from here rather than from a module's
// own URL, which a bundle does not keep. (turbopackIgnore: found at run time, so the build must not trace the repo.)
import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

export function repoRoot(): string {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    if (existsSync(/*turbopackIgnore: true*/ path.join(dir, "pnpm-workspace.yaml"))) return dir;
    if (path.dirname(dir) === dir) throw new Error("config: cannot find the repo root (pnpm-workspace.yaml)");
  }
}
