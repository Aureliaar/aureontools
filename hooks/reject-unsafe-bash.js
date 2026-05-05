#!/usr/bin/env node

// PreToolUse hook for Bash: rejects commands that trigger
// "simple_expansion" or "newline + #" shell validation prompts.
// Advises the agent to use proper tool alternatives.

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  const cmd = input.tool_input?.command;
  if (typeof cmd !== "string") process.exit(0);

  const errors = [];

  // Check for shell variable expansions ($VAR, ${VAR})
  // Ignore $? and $( which are subshell/status patterns, and $' which is ANSI-C quoting
  // Ignore $null which is PowerShell's null literal, not a shell variable
  // Only flag $LETTER or ${
  if (/\$(?!null\b)[A-Za-z_]|\$\{/.test(cmd)) {
    errors.push("SHELL VARIABLE EXPANSION ($VAR) detected.");
  }

  // Check for newline followed by # (comment hiding arguments)
  if (/\n\s*#/.test(cmd)) {
    errors.push("NEWLINE FOLLOWED BY # (comment after newline) detected.");
  }

  if (errors.length === 0) process.exit(0);

  const msg = [
    "BLOCKED by pre-tool-use hook: " + errors.join(" "),
    "",
    "Your Bash command uses patterns that trigger permission prompts. Fix it:",
    "",
    "- SHELL VARIABLES ($USERPROFILE, $APPDATA, $HOME, etc.):",
    "  Use literal paths instead. Resolve env vars yourself before building the command.",
    "  Example: instead of `cat \"$USERPROFILE/.config/foo\"`, use `cat \"C:\\Users\\jacop\\.config\\foo\"`",
    "",
    "- MULTILINE SCRIPTS WITH # COMMENTS:",
    "  Don't inline multiline scripts via `python -c` or `node -e` with comments.",
    "  Instead: use the Write tool to write a temp script, then run it.",
    "  Or: remove the comments from the inline script.",
    "",
    "- FOR FILE READS/WRITES: prefer Read, Write, and Edit tools over Bash.",
  ].join("\n");

  process.stdout.write(msg);
  process.exit(2);
});
