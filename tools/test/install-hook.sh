#!/bin/sh
# Installs the opt-in pre-commit hook (tools/test/pre-commit.sh) as .git/hooks/pre-commit.
# Nothing installs it automatically. It refuses to replace a hook that is not this one.
set -e
ROOT="$(git rev-parse --show-toplevel)"
HOOK="$(git rev-parse --git-path hooks)/pre-commit"
case "$HOOK" in /*) ;; *) HOOK="$ROOT/$HOOK" ;; esac
TARGET="$ROOT/tools/test/pre-commit.sh"
if [ -e "$HOOK" ] && ! grep -q "tools/test/run.mjs\" quick --hook" "$HOOK" 2>/dev/null; then
  echo "A different pre-commit hook already exists at $HOOK; not replacing it." >&2
  exit 1
fi
mkdir -p "$(dirname "$HOOK")"
cp "$TARGET" "$HOOK"
chmod +x "$HOOK"
echo "Installed $HOOK (format check on staged web files + typecheck). Remove it with: rm \"$HOOK\""
