#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TEAM=${TEAMCLAY_ROOT:-"$HOME/Downloads/TeamClay"}
STORE=${WHATSAPP_SESSION_ROOT:-"$TEAM/data/whatsapp-session"}
if [ -z "${WHATSAPP_SESSION_ROOT:-}" ] && [ -d "$ROOT/../whatsapp-mcp/whatsapp-bridge/store" ]; then STORE="$ROOT/../whatsapp-mcp/whatsapp-bridge"; fi
mkdir -p "$STORE"
exec node "$ROOT/scripts/start-staff-bridge.mjs" \
  --users "${VOICE_USERS_CSV:-$TEAM/data/users.csv}" \
  --session-root "$STORE"
