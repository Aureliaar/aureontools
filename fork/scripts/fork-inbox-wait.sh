#!/bin/bash
# fork-inbox-wait.sh - Stop hook for forked Claude sessions.
#
# Parks (blocks) when the fork finishes a turn, polling an inbox file. When the
# spawning session drops a message into the inbox, this emits it as the Stop
# hook's `block` reason, so the fork continues with that message as its next
# instruction. If nothing arrives before the parking window elapses, it exits 0
# and lets the fork go idle.
#
# Usage (as a Stop hook command):
#   bash fork-inbox-wait.sh <inbox-path>
#
# The hook receives the Stop event JSON on stdin (session_id, stop_hook_active,
# ...); we drain it but don't need it.
#
# Env overrides (exported by the launcher / user):
#   FORK_INBOX_MAX_WAIT  seconds to park before allowing the stop (default 1700)
#   FORK_INBOX_POLL      seconds between inbox checks (default 1)

set -uo pipefail

INBOX="${1:-}"
[[ -z "$INBOX" ]] && exit 0

# Drain the hook's stdin payload so the writer never blocks.
cat >/dev/null 2>&1 || true

DETACH_MARKER="${INBOX}.detached"
PROCESSING="${INBOX}.processing"

# Detached for this fork: never park, just allow the stop.
[[ -f "$DETACH_MARKER" ]] && exit 0

MAX_WAIT="${FORK_INBOX_MAX_WAIT:-1700}"
POLL="${FORK_INBOX_POLL:-1}"
waited=0

emit_block() {
  # $1 -> JSON {"decision":"block","reason":$1} with safe escaping.
  python - "$1" <<'PY'
import json, sys
print(json.dumps({"decision": "block", "reason": sys.argv[1]}))
PY
}

while (( waited < MAX_WAIT )); do
  if [[ -s "$INBOX" ]]; then
    # Atomically claim the inbox so a concurrent append can't be half-read.
    if mv "$INBOX" "$PROCESSING" 2>/dev/null; then
      MSG="$(cat "$PROCESSING" 2>/dev/null)"
      rm -f "$PROCESSING"
      MSG="${MSG//$'\r'/}"
      MSG="${MSG%$'\n'}"

      # Empty/whitespace-only -> keep parking.
      if [[ -z "${MSG//[$' \t\n']/}" ]]; then
        continue
      fi

      case "$MSG" in
        "::detach")
          touch "$DETACH_MARKER"
          exit 0
          ;;
        "::status"|"::ping")
          emit_block "[mailbox] heartbeat — fork is parked and listening for messages from the spawning session."
          exit 0
          ;;
      esac

      emit_block "[Message from the spawning session]
${MSG}

(Act on this, then finish your turn — the mailbox will keep listening.)"
      exit 0
    fi
  fi
  sleep "$POLL"
  (( waited += POLL ))
done

# Parking window elapsed with no message: allow the stop, go idle.
exit 0
