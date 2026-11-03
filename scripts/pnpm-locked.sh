#!/usr/bin/env bash
# Parallel sessions on one checkout share one pnpm-lock.yaml: run every pnpm install/add/remove through this so only
# one runs at a time.
# Usage: scripts/pnpm-locked.sh add zod --filter @munshi/agent
set -euo pipefail
lock="${TMPDIR:-/tmp}/munshi-pnpm.lock"
until mkdir "$lock" 2>/dev/null; do sleep 2; done
trap 'rmdir "$lock"' EXIT
cd "$(dirname "$0")/.."
pnpm "$@"
