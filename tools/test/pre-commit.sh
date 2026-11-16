#!/bin/sh
# Opt-in pre-commit hook (Skyler, 2026-11-16: opt-in, never installed by default).
# Runs `run.mjs quick --hook`: prettier --check on the STAGED web files, then typecheck (~15 s).
# It never runs ng test (too slow for a commit). Bypass once with `git commit --no-verify`.
# Install: sh tools/test/install-hook.sh     Remove: rm .git/hooks/pre-commit
ROOT="$(git rev-parse --show-toplevel)" || exit 1
NODE_BIN="$HOME/.nvm/versions/node/v26.5.0/bin"
[ -d "$NODE_BIN" ] && PATH="$NODE_BIN:$PATH"
exec node "$ROOT/tools/test/run.mjs" quick --hook
