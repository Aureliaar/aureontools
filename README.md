# aureontools

Claude Code extensions: MCP servers, hooks, statusline, and skills.

## Components

| Directory | What |
|-----------|------|
| `everything-mcp/` | MCP server wrapping voidtools Everything for filesystem search |
| `statusline/` | Status line showing context %, cost, and 5h/7d usage windows |
| `fork/` | Skill to launch side AI sessions in new terminal windows |
| `hooks/` | PreToolUse / PermissionRequest hooks for safety and auto-approval |
| `hub/` | Local project hub: one index of every `localhost:port`, with start/stop |

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

### Hub

Answers "which localhost port was that thing again?" — one page listing every local
project, whether it's up, and how to start it.

Describe your projects in a `ports.json` (see `hub/ports.example.json`); the registry
lives with your projects, the code stays here. Then either:

```
node hub/hubd.mjs --registry E:\experiments\ports.json
```

for the live version at `http://localhost:7777` — real TCP liveness, Start/Stop/Log
buttons per project, and anything flagged `"autostart": true` booted on launch. Run it
at logon with `hub\install-hubd.ps1` (Task Scheduler, current user, no admin).

Or:

```
node hub/build-hub.mjs --registry E:\experiments\ports.json
```

for a static `hub.html` next to the registry that needs nothing running — openable off
disk, but no buttons, and its liveness probe is a best-effort `no-cors` fetch that some
browsers block.

Once you have more than a screenful of projects, the list tiers itself by use: anything
touched in the last `recentDays` (default 14) sits up top newest-first, the rest folds
away under "Everything else". Usage is recorded three ways — clicking a project, starting
it from the hub, or the daemon noticing its port come up, which catches servers you
started from a terminal. Ports claimed by more than one project are skipped there, since
there's no telling which one came up. `"pin": true` forces a project into the top tier,
`"archive": true` holds it down.

For a taskbar entry, `hub\New-HubShortcut.ps1` creates a Start Menu shortcut that opens
the hub as a Chromium `--app` window — no tabs, no omnibox — with a generated icon
(`make-icon.mjs` writes `hub.ico` with no image libraries). It also stamps the shortcut's
AppUserModelID to match the one Chrome gives the app window, so the pinned icon and the
running window are a single taskbar button rather than two. Windows won't let a script
pin anything, so the final right-click → Pin to taskbar is yours.

Usage lands in `hub-state.json` beside the registry — separate on purpose, so a
hand-edited `ports.json` and a machine-written log never fight over the same file.

`hubd` binds loopback only and refuses cross-origin requests, since its API can run any
command in the registry.

### Statusline

The statusline script reads from stdin (Claude Code pipes status data) and requires the OAuth credentials at `~/.claude/.credentials.json` for usage window display.
