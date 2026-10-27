// Runs the project's pinned HyperFrames CLI (package.json) through npx, retrying the registry fetch: npx on this machine
// fails now and then with ERR_SSL_CIPHER_OPERATION_FAILED before the CLI starts.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const PIN = /hyperframes@([\d.]+)/.exec(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).scripts.check)[1];

export function hyperframes(argv, env = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return execFileSync("npx", ["--yes", `hyperframes@${PIN}`, ...argv], { cwd: ROOT, env: { ...process.env, ...env }, stdio: "pipe" }).toString();
    } catch (e) {
      const said = `${e.stdout ?? ""}${e.stderr ?? ""}`.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "").trim();
      if (attempt < 4 && said.includes("ERR_SSL")) continue;
      throw new Error(`hyperframes ${argv[0]} failed: ${said.slice(-600)}`);
    }
  }
}
