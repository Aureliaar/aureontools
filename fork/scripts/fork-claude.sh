#!/bin/bash
# fork-claude.sh - Launch a new AI session in a new terminal window.
#
# Usage:
#   bash scripts/fork-claude.sh <title> [--provider claude|claude-glm|gemini|codex|copilot] <<< "plan content"
#
# Plan content is read from stdin so the caller can do it in one command.
# Default provider: current session provider (falls back to claude)

set -euo pipefail

# Convert MSYS/Git-Bash paths (/e/foo, /c/Users) to mixed Windows form
# (E:/foo) that bash, native Python, and `claude --settings` all accept.
to_native() {
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -m "$1"
  else
    printf '%s' "$1"
  fi
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WAIT_SCRIPT="$(to_native "$SCRIPT_DIR/fork-inbox-wait.sh")"

TITLE=""
REQUESTED_PROVIDER=""
MODE="exec"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider)
      REQUESTED_PROVIDER="${2:-}"
      shift 2
      ;;
    --mode)
      MODE="${2:-exec}"
      shift 2
      ;;
    *)
      if [[ -z "$TITLE" ]]; then
        TITLE="$1"
      fi
      shift
      ;;
  esac
done

TITLE="${TITLE:-Fork}"

resolve_current_provider() {
  if [[ -n "${FORK_PROVIDER:-}" ]]; then
    echo "$FORK_PROVIDER"
    return
  fi

  if [[ -n "${CLAUDECODE:-}" ]]; then
    if [[ "${CLAUDE_CODE_PROVIDER:-${CLAUDECODE_PROVIDER:-}}" == "claude-glm" ]]; then
      echo "claude-glm"
    else
      echo "claude"
    fi
    return
  fi

  if [[ -n "${COPILOT_CLI:-}" || -n "${COPILOT_AGENT_SESSION_ID:-}" ]]; then
    echo "copilot"
    return
  fi

  if [[ -n "${CODEX_THREAD_ID:-}" || -n "${CODEX_MANAGED_BY_NPM:-}" ]]; then
    echo "codex"
    return
  fi

  echo "claude"
}

PROVIDER="${REQUESTED_PROVIDER:-current}"
if [[ "$PROVIDER" == "current" ]]; then
  PROVIDER="$(resolve_current_provider)"
fi

PROJECT_DIR="$(to_native "${FORK_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}")"

mkdir -p "$PROJECT_DIR/tmp/forks"

slugify() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr ' ' '-' | tr -cd 'a-z0-9-'
}

SLUG="$(slugify "$TITLE")"
DATE_PREFIX="$(date +%Y%m%d)"
PLAN_FILE="$PROJECT_DIR/tmp/forks/${DATE_PREFIX}-${SLUG}.md"
METADATA_FILE="$PROJECT_DIR/tmp/forks/${DATE_PREFIX}-${SLUG}.json"
INBOX_FILE="$PROJECT_DIR/tmp/forks/${DATE_PREFIX}-${SLUG}.inbox"
SETTINGS_FILE="$PROJECT_DIR/tmp/forks/${DATE_PREFIX}-${SLUG}.settings.json"

cat > "$PLAN_FILE"

if [[ ! -s "$PLAN_FILE" ]]; then
  echo "Error: No plan content provided on stdin" >&2
  exit 1
fi

# --- Mailbox: let the spawning session send messages to this fork ----------
# Only Claude providers support the Stop hook the mailbox relies on.
HOOK_TIMEOUT="${FORK_INBOX_TIMEOUT:-1800}"
INBOX_MAX_WAIT=$(( HOOK_TIMEOUT > 200 ? HOOK_TIMEOUT - 100 : HOOK_TIMEOUT ))
SETTINGS_ARG=""

if [[ "$PROVIDER" == "claude" || "$PROVIDER" == "claude-glm" ]]; then
  # Clear any stale inbox / detach marker from a previous same-slug fork.
  rm -f "$INBOX_FILE" "$INBOX_FILE.detached" "$INBOX_FILE.processing"
  : > "$INBOX_FILE"

  python - "$SETTINGS_FILE" "$WAIT_SCRIPT" "$INBOX_FILE" "$HOOK_TIMEOUT" <<'PY'
import json, sys
settings_path, wait_script, inbox, timeout = sys.argv[1:]
command = 'bash "%s" "%s"' % (wait_script, inbox)
settings = {
    "hooks": {
        "Stop": [
            {
                "matcher": "",
                "hooks": [
                    {"type": "command", "command": command, "timeout": int(timeout)}
                ],
            }
        ]
    }
}
with open(settings_path, "w", encoding="utf-8") as f:
    json.dump(settings, f, ensure_ascii=False, indent=2)
PY

  SETTINGS_ARG="--settings \"$SETTINGS_FILE\""
fi

LAUNCHER="$PROJECT_DIR/tmp/forks/_launcher_${SLUG}_$$.sh"

cat > "$LAUNCHER" <<'SCRIPT'
#!/bin/bash
set -euo pipefail

cd 'PROJECT_DIR_PLACEHOLDER'
export FORK_INBOX_MAX_WAIT='MAX_WAIT_PLACEHOLDER'
echo '=== Forked Session (PROVIDER_PLACEHOLDER) ==='
cat 'PLAN_FILE_PLACEHOLDER'
echo ''
echo '============================='
echo ''

PLAN_CONTENT="$(cat 'PLAN_FILE_PLACEHOLDER')"

if [[ "MODE_PLACEHOLDER" == "plan" ]]; then
  SYSTEM_PROMPT="You were forked from another conversation to explore this task. Read the context below, then enter plan mode (use /plan). Present what you understand and your proposed approach, then WAIT for the user to discuss, refine, or approve before taking any action.

${PLAN_CONTENT}"
else
  SYSTEM_PROMPT="You were forked from another conversation to handle this task. Read the plan below and get started immediately.

${PLAN_CONTENT}"
fi

case "PROVIDER_PLACEHOLDER" in
  claude)
    unset CLAUDECODE
    echo '[mailbox] This fork listens for messages from the spawning session.'
    echo '[mailbox] When a turn ends it parks and waits; press Esc to take manual control.'
    echo ''
    claude --name "FORK_NAME_PLACEHOLDER" SETTINGS_ARG_PLACEHOLDER "${SYSTEM_PROMPT}"
    ;;
  claude-glm)
    unset CLAUDECODE
    echo '[mailbox] This fork listens for messages from the spawning session.'
    echo '[mailbox] When a turn ends it parks and waits; press Esc to take manual control.'
    echo ''
    claude-glm --name "FORK_NAME_PLACEHOLDER" SETTINGS_ARG_PLACEHOLDER "${SYSTEM_PROMPT}"
    ;;
  gemini)
    gemini "${SYSTEM_PROMPT}"
    ;;
  codex)
    codex "${SYSTEM_PROMPT}"
    ;;
  copilot)
    copilot -i "${SYSTEM_PROMPT}"
    ;;
  *)
    echo "Unknown provider: PROVIDER_PLACEHOLDER" >&2
    exit 1
    ;;
esac

echo ''
echo 'Session ended. Press Enter to close.'
read -r
SCRIPT

escape_for_sed() {
  printf '%s' "$1" | sed -e 's/[\/&]/\\&/g'
}

sed -i "s|PROJECT_DIR_PLACEHOLDER|$(escape_for_sed "$PROJECT_DIR")|g" "$LAUNCHER"
sed -i "s|PLAN_FILE_PLACEHOLDER|$(escape_for_sed "$PLAN_FILE")|g" "$LAUNCHER"
sed -i "s|FORK_NAME_PLACEHOLDER|$(escape_for_sed "$TITLE")|g" "$LAUNCHER"
sed -i "s|PROVIDER_PLACEHOLDER|$(escape_for_sed "$PROVIDER")|g" "$LAUNCHER"
sed -i "s|MODE_PLACEHOLDER|$(escape_for_sed "$MODE")|g" "$LAUNCHER"
sed -i "s|SETTINGS_ARG_PLACEHOLDER|$(escape_for_sed "$SETTINGS_ARG")|g" "$LAUNCHER"
sed -i "s|MAX_WAIT_PLACEHOLDER|$(escape_for_sed "$INBOX_MAX_WAIT")|g" "$LAUNCHER"

chmod +x "$LAUNCHER"

python - "$METADATA_FILE" "$TITLE" "$PROVIDER" "$PROJECT_DIR" "$PLAN_FILE" "$INBOX_FILE" <<'PY'
import json
import sys
from datetime import datetime, timezone

metadata_path, title, provider, project_dir, plan_file, inbox_file = sys.argv[1:]
has_mailbox = provider in ("claude", "claude-glm")
with open(metadata_path, "w", encoding="utf-8") as f:
    json.dump(
        {
            "title": title,
            "provider": provider,
            "project_dir": project_dir,
            "plan_file": plan_file,
            "inbox_file": inbox_file if has_mailbox else None,
            "launched_at": datetime.now(timezone.utc).isoformat(),
        },
        f,
        ensure_ascii=False,
        indent=2,
    )
PY

launch_in_terminal() {
  local title="$1"
  local launcher="$2"

  if [[ -n "${FORK_TERMINAL:-}" ]]; then
    case "$FORK_TERMINAL" in
      alacritty)
        alacritty --title "$title" -e bash "$launcher" &
        return 0
        ;;
      wt|wt.exe|windows-terminal)
        wt.exe new-tab --title "$title" bash -lc "\"$launcher\"" &
        return 0
        ;;
      *)
        echo "Unsupported FORK_TERMINAL: $FORK_TERMINAL" >&2
        return 1
        ;;
    esac
  fi

  if command -v alacritty >/dev/null 2>&1; then
    alacritty --title "$title" -e bash "$launcher" &
    return 0
  fi

  if command -v wt.exe >/dev/null 2>&1; then
    wt.exe new-tab --title "$title" bash -lc "\"$launcher\"" &
    return 0
  fi

  if command -v gnome-terminal >/dev/null 2>&1; then
    gnome-terminal -- bash "$launcher" &
    return 0
  fi

  if command -v x-terminal-emulator >/dev/null 2>&1; then
    x-terminal-emulator -e bash "$launcher" &
    return 0
  fi

  return 1
}

if ! launch_in_terminal "$TITLE" "$LAUNCHER"; then
  echo "Error: No supported terminal launcher found. Tried alacritty, wt.exe, gnome-terminal, and x-terminal-emulator." >&2
  echo "Set FORK_TERMINAL=alacritty or FORK_TERMINAL=wt to override." >&2
  exit 1
fi

echo "Forked session launched: $TITLE (provider: $PROVIDER)"
echo "Plan: $PLAN_FILE"
echo "Metadata: $METADATA_FILE"
if [[ -n "$SETTINGS_ARG" ]]; then
  echo "Inbox: $INBOX_FILE"
  echo "Send a message: python \"$SCRIPT_DIR/fork_send.py\" --by-name \"$TITLE\" \"<message>\""
fi
