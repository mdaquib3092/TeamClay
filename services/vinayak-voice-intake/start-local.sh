#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEAM=${TEAMCLAY_ROOT:-"$HOME/Downloads/TeamClay"}
STORE=${WHATSAPP_SESSION_ROOT:-"$TEAM/data/whatsapp-session"}
if [ -z "${WHATSAPP_SESSION_ROOT:-}" ] && [ -d "$ROOT/../whatsapp-mcp/whatsapp-bridge/store" ]; then STORE="$ROOT/../whatsapp-mcp/whatsapp-bridge"; fi
exec node "$ROOT/src/cli.mjs" \
  --env-file "${VOICE_ENV_FILE:-$TEAM/.env}" \
  --users "${VOICE_USERS_CSV:-$TEAM/data/users.csv}" \
  --whatsapp-store "${WHATSAPP_STORE_DIR:-$STORE/store}" \
  --data-dir "${VOICE_DATA_DIR:-$TEAM/data/voice_notes}" \
  "$@"
