#!/usr/bin/env bash
# The gate. Nonzero exit means the current task is not done, whatever anyone
# claims. Run before every commit.
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

failed=()
run() {
  local name=$1; shift
  echo "── $name ─────────────────────────────────────────"
  if "$@"; then
    echo "✓ $name"
  else
    echo "✗ $name"
    failed+=("$name")
  fi
  echo
}

# Skip gracefully until phase 1 creates the workspace.
if [[ ! -f package.json ]]; then
  echo "no package.json yet — scaffold not built (phase 1). Nothing to verify."
  exit 0
fi

run typecheck bun run typecheck
run lint      bun run lint
run test      bun test

if ((${#failed[@]})); then
  echo "FAILED: ${failed[*]}"
  exit 1
fi

echo "all checks passed"
