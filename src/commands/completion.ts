import { Command } from "commander";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  getConfigDir,
  readCache,
  repositoryRoot,
  isDefinitionFile,
} from "../lib/cache.js";
import { ChartRoomError } from "../lib/errors.js";
import { createHash } from "node:crypto";

export const COMMANDS = [
  "auth",
  "comment",
  "completion",
  "import",
  "init",
  "link",
  "omni",
  "prod",
  "scan",
  "status",
  "test",
  "validate",
];
const OPTIONS: Record<string, string[]> = {
  init: ["--model", "--prod-folder", "--test-folder", "--retry-create"],
  import: ["--test-folder"],
  link: ["--test"],
  prod: ["--dry-run"],
  status: ["--json"],
  validate: ["--remote"],
  scan: ["--quiet"],
  auth: ["--model"],
  omni: ["--model", "--topic", "--refresh"],
};
export function completionCandidates(
  words: string[],
  cwd = process.cwd(),
): string[] {
  const current = words.at(-1) || "";
  const previous = words.at(-2) || "";
  const before = words.slice(0, -1);
  const value = (flag: string) => {
    const at = before.indexOf(flag);
    return at >= 0
      ? before[at + 1]
      : before.find((w) => w.startsWith(`${flag}=`))?.slice(flag.length + 1);
  };
  const provider = value("--provider");
  const command = before.find((w) => COMMANDS.includes(w));
  let candidates: string[] = [];
  if (previous === "--provider") candidates = ["datadog", "omni"];
  else if (previous === "--format") candidates = ["human", "json"];
  else if (previous === "--instance") candidates = ["https://zip.omniapp.co"];
  else if (previous === "--model" || previous === "--topic") {
    const parts = [
      repositoryRoot(cwd),
      "omni",
      value("--instance") || "https://zip.omniapp.co",
      value("--profile") || "default",
      previous === "--topic" ? value("--model") : undefined,
      undefined,
    ];
    const key = createHash("sha256")
      .update(JSON.stringify(parts))
      .digest("hex");
    try {
      const saved = JSON.parse(
        readFileSync(join(getConfigDir(), "catalog", `${key}.json`), "utf8"),
      );
      if (Array.isArray(saved.names))
        candidates = saved.names.filter((v: unknown) => typeof v === "string");
    } catch {
      /* Catalog refresh is explicit and never runs while completing. */
    }
  } else if (["--profile", "--prod-folder", "--test-folder"].includes(previous))
    candidates = [];
  else if (current.startsWith("-"))
    candidates = [
      "--help",
      "--version",
      "--provider",
      "--profile",
      "--format",
      "--instance",
      ...(OPTIONS[command || ""] || []),
    ];
  else if (!command) candidates = COMMANDS;
  else if (command === "completion") candidates = ["bash", "zsh", "fish"];
  else if (command === "auth") candidates = ["login", "status"];
  else if (command === "omni") candidates = ["models", "topics", "fields"];
  else {
    const root = repositoryRoot(cwd);
    candidates = readCache()
      .entries.filter(
        (e) =>
          e.repository === root &&
          (!provider || e.provider === provider) &&
          existsSync(e.path),
      )
      .map((e) =>
        current.startsWith("/")
          ? e.path
          : `${current.startsWith("./") ? "./" : ""}${relative(cwd, e.path)}`,
      );
    // Files created since the last scan, and directories en route to nested definitions.
    const directory = dirname(current || ".");
    try {
      for (const entry of readdirSync(resolve(cwd, directory), {
        withFileTypes: true,
      })) {
        if (
          entry.isDirectory() &&
          ["node_modules", ".git"].includes(entry.name)
        )
          continue;
        const matchesProvider =
          !provider ||
          (provider === "omni"
            ? entry.name.endsWith(".omni.jsonc")
            : /\.dash\.jsonc?$/.test(entry.name));
        if (
          entry.isDirectory() ||
          (isDefinitionFile(entry.name) && matchesProvider)
        )
          candidates.push(
            `${directory === "." ? (current.startsWith("./") ? "./" : "") : `${directory}/`}${entry.name}${entry.isDirectory() ? "/" : ""}`,
          );
      }
    } catch {
      /* An unfinished path is normal during completion. */
    }
  }
  return [...new Set(candidates)]
    .filter((c) => c.startsWith(current) && !/[\n\r\t]/.test(c))
    .sort();
}

export function completionScript(shell: string): string {
  if (shell === "bash")
    return `# chart-room bash completion: all candidates are local; scan/--refresh populate caches.
_chart_room_completions() {
  local candidate
  COMPREPLY=()
  while IFS= read -r candidate; do
    COMPREPLY+=("$candidate")
  done < <(chart-room __complete "\${COMP_WORDS[@]:1:COMP_CWORD}")
  compopt -o filenames 2>/dev/null || true
}
complete -F _chart_room_completions chart-room
`;
  if (shell === "zsh")
    return `# chart-room zsh completion
_chart_room() {
  local -a candidates
  candidates=("\${(@f)$(chart-room __complete "\${words[@]:1:$((CURRENT-1))}")}")
  compadd -a candidates
}
compdef _chart_room chart-room
`;
  if (shell === "fish")
    return `# chart-room fish completion
function __chart_room_candidates
  set -l words (commandline -opc)
  chart-room __complete $words[2..-1] (commandline -ct)
end
complete -c chart-room -f -a '(__chart_room_candidates)'
`;
  throw new ChartRoomError(
    "INVALID_SHELL",
    "Supported shells: bash, zsh, fish",
  );
}
export const completionCommand = new Command("completion")
  .description("Print offline bash, zsh or fish completion")
  .argument("<shell>")
  .action((shell) => console.log(completionScript(shell)));
