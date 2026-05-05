# aureontools

Claude Code extensions: MCP servers, hooks, statusline, and skills.

## Components

| Directory | What |
|-----------|------|
| `everything-mcp/` | MCP server wrapping voidtools Everything for filesystem search |
| `statusline/` | Status line showing context %, cost, and 5h/7d usage windows |
| `fork/` | Skill to launch side AI sessions in new terminal windows |
| `hooks/` | PreToolUse / PermissionRequest hooks for safety and auto-approval |

## Setup

1. Clone this repo somewhere permanent (e.g. `~/.claude/aureontools`)
2. Copy the relevant sections from `settings-snippet.json` into `~/.claude/settings.json`
3. Replace `PATH_TO_AUREONTOOLS` with the actual path

### Everything MCP

Requires [Everything](https://www.voidtools.com/) running + `es.exe` (the CLI tool).
Download `es.exe` from https://www.voidtools.com/downloads/#cli and place it in the Everything install directory.

Install the Python dependency:
```
pip install mcp
```

### Fork skill

Symlink or copy `fork/` into `~/.claude/skills/fork/` (or `~/.codex/skills/fork/`).

### Statusline

The statusline script reads from stdin (Claude Code pipes status data) and requires the OAuth credentials at `~/.claude/.credentials.json` for usage window display.
