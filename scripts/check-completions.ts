#!/usr/bin/env npx tsx
/**
 * Pre-commit hook to check if shell completions need updating.
 * Warns if command files changed but completion.ts didn't.
 */

import { execSync } from "child_process";

const stagedFiles = execSync("git diff --cached --name-only", {
  encoding: "utf-8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const commandFiles = stagedFiles.filter(
  (f) => f.startsWith("src/commands/") && f.endsWith(".ts"),
);

const completionChanged = commandFiles.includes("src/commands/completion.ts");

// Check for new command files (added, not modified)
const newFiles = execSync("git diff --cached --name-only --diff-filter=A", {
  encoding: "utf-8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

const newCommandFiles = newFiles.filter(
  (f) =>
    f.startsWith("src/commands/") &&
    f.endsWith(".ts") &&
    f !== "src/commands/completion.ts",
);

if (newCommandFiles.length > 0 && !completionChanged) {
  console.warn("\n⚠️  New command file(s) added but completions not updated:");
  newCommandFiles.forEach((f) => console.warn(`   - ${f}`));
  console.warn("\nDid you forget to update src/commands/completion.ts?\n");
  process.exit(1);
}
