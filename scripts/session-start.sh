#!/usr/bin/env bash
# Runs at the start of every Claude Code session (the repo's .claude/settings.json SessionStart hook), locally and in
# cloud sessions. It installs the workspace from the lockfile and, on a Linux VM, starts the preinstalled Redis. It never
# reads .env or .run/. Each step may fail without stopping the session; the session's own checks then say what is missing.
set -u
cd "$(dirname "$0")/.."
if command -v pnpm >/dev/null 2>&1; then
  pnpm install --frozen-lockfile --offline >/dev/null 2>&1 || pnpm install --frozen-lockfile >/dev/null 2>&1 || echo "session-start: pnpm install failed"
else
  echo "session-start: pnpm is missing (the cloud setup script installs pnpm@11.9.0)"
fi
if [ "$(uname -s)" = "Linux" ] && command -v service >/dev/null 2>&1; then
  service redis-server start >/dev/null 2>&1 || echo "session-start: redis-server did not start"
fi
exit 0
