---
name: fork
description: "Fork or check forks. `/fork <task>` launches a side session. `/fork status <name>` checks what a fork concluded. Use when the user says /fork, asks to handle something in a side session, or asks to check on a fork."
user-invocable: true
---

# Fork Skill

Opens a new AI session in a separate terminal window for a side-task, so the current conversation can continue uninterrupted. Can also check what a forked session concluded.

## Core principle

**`/fork` is a command, not a request.** Launch immediately — never ask clarifying questions.

**Pass context, don't fetch it.** Write what you already know from this conversation into the plan file. Do NOT make tool calls (reads, greps, etc.) to gather info for the fork — that's the fork's job. If you read a file 30 messages ago and remember something relevant, write it. If you haven't looked at something, don't — just mention it and move on.

## Two modes

| Syntax | Mode | What happens |
|--------|------|-------------|
| `/fork <task>` | **exec** (default) | Fork starts working immediately |
| `/fork plan <task>` | **plan** | Fork receives context, enters plan mode, and waits for the user to talk before doing anything |

**When to use plan mode:** The user wants to open a side conversation to explore/discuss something interactively — they'll drive the fork themselves. The fork presents what it understands and proposes an approach, then waits.

**When to use exec mode:** Fire-and-forget. The fork has enough info to just go.

## Launching a fork

When invoked with `/fork [plan] <task description>`:

1. **Detect the mode.** If the first word after `/fork` (and after any provider keyword) is `plan`, strip it and pass `--mode plan`. Otherwise default to `--mode exec`.

2. **Write the plan and launch in a single Bash call** — so the user only needs one `/undo` to roll back the fork from the caller's context:
   ```bash
   SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/fork"
   if [[ ! -f "$SKILL_DIR/scripts/fork-claude.sh" ]]; then
     SKILL_DIR="$HOME/.claude/skills/fork"
   fi
   bash "$SKILL_DIR/scripts/fork-claude.sh" "<short title>" [--provider claude|claude-glm|gemini|codex|copilot] [--mode plan|exec] <<'EOF'
   # Fork: <short title>

   ## Do
   <task>

   ## Context
   <what you know>
   EOF
   ```
   The script reads the plan from stdin and writes it to `tmp/forks/` automatically.

   Default provider is the current provider. If the first word of the task matches a provider name, use that provider:
   - `/fork fix the curves` → exec mode, current provider
   - `/fork plan fix the curves` → plan mode, current provider
   - `/fork gemini fix the curves` → exec mode, gemini
   - `/fork gemini plan fix the curves` → plan mode, gemini
   - `/fork plan gemini fix the curves` → plan mode, gemini
   - `/fork copilot fix the curves` → exec mode, copilot
   - `/fork plan copilot fix the curves` → plan mode, copilot

3. **Report back** in one line with the fork name and mode, and continue the current conversation.

## Plan file format

```markdown
# Fork: <short title>

## Do
<what needs to be done — one or two sentences>

## Context
<freeform dump of what the caller already knows that's relevant —
things learned during this conversation, decisions made, patterns noticed,
specific values or signatures encountered, current state of things.
No structure required. Don't pad it, don't fetch new info. Just write what's in your head.>
```

That's it. No "Key Files" section, no "Discover" section. The fork has full access to the codebase, MCP tools, and debugger — it can find what it needs.

## Checking fork results

**Always run the check script directly via Bash — never ask the user to invoke `/fork status`.** This applies both when the user asks and when you want to proactively report on a fork you launched earlier.

```bash
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/fork"
if [[ ! -f "$SKILL_DIR/scripts/fork_last_response.py" ]]; then
  SKILL_DIR="$HOME/.claude/skills/fork"
fi
python "$SKILL_DIR/scripts/fork_last_response.py" --by-name "<fork title>"
```

The script outputs:
- The last text the forked session produced (truncated to 5000 chars)
- `[still running]` if the fork hasn't finished yet
- An error if no matching session was found

You can also check by session UUID if known:
```bash
python "$SKILL_DIR/scripts/fork_last_response.py" <session-uuid-or-path>
```

**When to check proactively (without being asked):**
- After reporting that a fork was launched, if the conversation naturally reaches a point where the fork's result is needed, check it yourself.
- If a fork is blocking next steps, poll it and report back rather than saying "check with `/fork status`".
- If the user asks "what happened with X?" or "did the fork finish?" — run the script immediately, don't redirect them.

## Important

- **Never ask the user for more info before launching.**
- **Never make tool calls to prepare the plan file.** Write from memory only.
- Keep the plan file concise — enough for the fork to orient, not a full brief.
- Use a slugified version of the first few words as the filename (e.g., `fix-widget-layout.md`).
- The launcher resolves the current project root dynamically and stores its plan under that project's `tmp/forks/`.
- The packaged scripts live under the skill itself, so the skill works across projects once synced into `~/.claude/skills/` or `~/.codex/skills/`.
- After launching, continue the current conversation normally — don't wait for the fork to finish.
- Report the fork launch in one line, not a paragraph.
