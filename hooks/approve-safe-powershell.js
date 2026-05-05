#!/usr/bin/env node

// PreToolUse hook for PowerShell: auto-approves safe read-only commands.
// Analyzes pipelines segment by segment. Falls through (no opinion) on unknowns.

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  const cmd = (input.tool_input?.command || "").trim();
  if (!cmd) process.exit(0);

  const APPROVE = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "allow",
      permissionDecisionReason: "safe PowerShell command",
    },
  });

  // Block destructive patterns anywhere in the command
  const destructive = [
    /\bRemove-Item\b/i,
    /\bClear-Content\b/i,
    /\bStop-Process\b/i,
    /\bStop-Service\b/i,
    /\bRestart-Computer\b/i,
    /\bStop-Computer\b/i,
    /\bFormat-Volume\b/i,
    /\bFormat-Disk\b/i,
    /\bNew-Item\b/i,
    /\bSet-Content\b/i,
    /\bOut-File\b/i,
    /\bAdd-Content\b/i,
    /\brm\s+-r/i,
    /\brmdir\b/i,
    /\bInvoke-WebRequest\b.*-Method\s+(POST|PUT|DELETE|PATCH)/i,
    /\bInvoke-RestMethod\b.*-Method\s+(POST|PUT|DELETE|PATCH)/i,
  ];

  for (const pat of destructive) {
    if (pat.test(cmd)) process.exit(0);
  }

  // Split by ; to get independent statements, then check each
  const statements = cmd.split(/\s*;\s*/);
  let allSafe = true;

  for (const stmt of statements) {
    if (!stmt.trim()) continue;
    if (!isStatementSafe(stmt.trim())) {
      allSafe = false;
      break;
    }
  }

  if (allSafe) {
    process.stdout.write(APPROVE);
  }
  process.exit(0);

  function isStatementSafe(statement) {
    // Split pipeline segments (rough — ignores pipes inside strings/blocks, but good enough)
    const segments = splitPipeline(statement);
    return segments.every(isSegmentSafe);
  }

  function splitPipeline(statement) {
    const segments = [];
    let depth = 0;
    let current = "";
    for (let i = 0; i < statement.length; i++) {
      const ch = statement[i];
      if (ch === "{" || ch === "(") depth++;
      else if (ch === "}" || ch === ")") depth--;
      else if (ch === "|" && depth === 0) {
        segments.push(current.trim());
        current = "";
        continue;
      }
      current += ch;
    }
    if (current.trim()) segments.push(current.trim());
    return segments;
  }

  function isSegmentSafe(segment) {
    // Get the first meaningful token (skip variable assignments like $x = ...)
    const firstToken = segment.split(/[\s({]/)[0].trim();

    // $env:Foo reads — safe
    if (/^\$env:/i.test(firstToken)) return true;

    // $variable reads/splits — safe
    if (/^\$\w/.test(firstToken)) return true;

    // Safe PowerShell cmdlet verbs (read-only)
    const safeVerbPrefixes = [
      "Get-", "Test-", "Select-", "Where-", "Sort-", "Group-",
      "Measure-", "Compare-", "ConvertTo-", "ConvertFrom-",
      "Format-List", "Format-Table", "Format-Wide", "Format-Custom",
      "Out-String", "Out-Null", "Out-Host",
      "Write-Host", "Write-Output", "Write-Verbose",
      "Join-Path", "Split-Path", "Resolve-Path", "Convert-Path",
      "ForEach-Object", "%",
      "Where-Object", "?",
    ];
    for (const prefix of safeVerbPrefixes) {
      if (segment.startsWith(prefix) || firstToken === prefix) return true;
      if (firstToken.toLowerCase() === prefix.toLowerCase()) return true;
      if (prefix.endsWith("-") && firstToken.toLowerCase().startsWith(prefix.toLowerCase())) return true;
    }

    // Common safe commands/aliases
    const safeCmds = /^(git|cd|Set-Location|ls|dir|Get-ChildItem|pwd|Get-Location|echo|Write-Output|type|cat|Get-Content|hostname|whoami|python|py|node|dotnet|where\.exe|npm|npx|pnpm|yarn|uv|pip|cargo|go|rustc|gcc|java|javac|ruby|perl)\b/i;
    if (safeCmds.test(firstToken)) return true;

    // Version/help flags on any command
    if (/\s+--version\s*$/.test(segment) || /\s+--help\s*$/.test(segment)) return true;

    // String literals / expressions like "text", 'text', @(), [type]::method
    if (/^["'@\[]/.test(firstToken)) return true;

    return false;
  }
});
