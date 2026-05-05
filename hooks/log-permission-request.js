#!/usr/bin/env node

// PermissionRequest logger: logs every permission request to a file
// so we can see what reaches the Haiku gate and debug the flow.
// Exits 0 with no output (no opinion) — lets subsequent hooks decide.

const fs = require("fs");
const path = require("path");

const LOG_FILE = path.join(process.env.USERPROFILE || process.env.HOME, ".claude", "permission-requests.log");

const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString());
  } catch {
    process.exit(0);
  }

  const timestamp = new Date().toISOString();
  const toolName = input.tool_name || "unknown";
  const command = input.tool_input?.command || "";
  const truncatedCmd = command.length > 200 ? command.slice(0, 200) + "..." : command;

  const entry = [
    `[${timestamp}] PermissionRequest`,
    `  tool: ${toolName}`,
    `  command: ${truncatedCmd}`,
    `  permission_mode: ${input.permission_mode || "default"}`,
    "",
  ].join("\n");

  try {
    fs.appendFileSync(LOG_FILE, entry + "\n");
  } catch {
    // Don't crash if we can't write
  }

  // No output, exit 0 = no opinion, let next hook (Haiku) decide
  process.exit(0);
});
