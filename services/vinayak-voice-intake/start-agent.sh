#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -z "${TEAMCLAY_ROOT:-}" ]; then
  if [ -f "$ROOT/../../db/schema.sql" ]; then TEAMCLAY_ROOT=$(cd "$ROOT/../.." && pwd); else TEAMCLAY_ROOT="$HOME/Downloads/TeamClay"; fi
fi
export TEAMCLAY_ROOT
exec sh "$ROOT/start-local.sh" --enable-chat --auto-reply --case-root "$TEAMCLAY_ROOT" "$@"
