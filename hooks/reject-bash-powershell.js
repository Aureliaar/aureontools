#!/usr/bin/env node

// PreToolUse hook for Bash: rejects commands that invoke powershell/pwsh.
// Tells Claude to use the PowerShell tool directly instead.

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  const cmd = (input.tool_input?.command || "").trimStart();
  if (!/^(powershell|pwsh)\b/i.test(cmd)) process.exit(0);

  process.stdout.write(
    "BLOCKED: You are using Bash to run a PowerShell command. " +
    "Use the PowerShell tool directly instead of invoking powershell/pwsh through Bash."
  );
  process.exit(2);
});
