import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { selectProvider } from "../src/providers/index.js";
import { readObject, updateJsonc } from "../src/lib/files.js";
import { readCache, refreshCache, getCachePath } from "../src/lib/cache.js";
import {
  completionCandidates,
  completionScript,
  COMMANDS,
} from "../src/commands/completion.js";
import { writeDashboard } from "../src/lib/dashboard.js";
import { definition } from "./helpers.js";
import {
  lastVerification,
  recordVerification,
} from "../src/lib/verification.js";
import { commentBody } from "../src/commands/comment.js";
import { assertUniqueTargets, initializeOmni } from "../src/commands/omni.js";
import type { DashboardDefinition } from "../src/types.js";

let root: string;
let originalConfig: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chart-room-files-"));
  mkdirSync(join(root, ".git"));
  originalConfig = process.env.CHART_ROOM_CONFIG_DIR;
  process.env.CHART_ROOM_CONFIG_DIR = join(root, "config");
});
afterEach(() => {
  process.env.CHART_ROOM_CONFIG_DIR = originalConfig;
  rmSync(root, { recursive: true, force: true });
});
const file = (name: string, value: unknown) => {
  const path = join(root, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
};
const dd = (): DashboardDefinition => ({
  title: "Existing",
  description: "",
  layout_type: "ordered",
  widgets: [],
  notify_list: [],
});

test("existing Datadog formats/defaults never route by credentials", () => {
  for (const name of ["old.dash.json", "current.dash.jsonc", "explicit.json"]) {
    const path = file(name, dd());
    expect(selectProvider(path)).toBe("datadog");
    expect(selectProvider(path, "datadog")).toBe("datadog");
    expect(() => selectProvider(path, "omni")).toThrow("reinterpret");
  }
  expect(selectProvider(join(root, "new.dash.jsonc"), undefined, true)).toBe(
    "datadog",
  );
  expect(selectProvider(join(root, "new.omni.jsonc"), "omni", true)).toBe(
    "omni",
  );
  expect(() =>
    selectProvider(join(root, "new.omni.jsonc"), undefined, true),
  ).toThrow("conflict");
});
test("suffix, envelope, version and explicit provider must agree before transport", () => {
  const omni = file("pilot.omni.jsonc", definition());
  expect(selectProvider(omni)).toBe("omni");
  expect(() => selectProvider(omni, "datadog")).toThrow("conflict");
  for (const name of ["wrong.dash.jsonc", "wrong.json"])
    expect(() => selectProvider(file(name, definition()))).toThrow("suffix");
  expect(() => selectProvider(file("wrong.omni.jsonc", dd()))).toThrow(
    "envelope",
  );
  expect(() =>
    selectProvider(file("v2.omni.jsonc", { ...definition(), version: 2 })),
  ).toThrow("version 1");
});
test("syntax tree edits retain user comments, trailing commas, and special keys", () => {
  const path = join(root, "a space.omni.jsonc");
  writeFileSync(
    path,
    '// header\n{\n  // own intent\n  "_meta": {"intent":"keep"},\n  "$schema": "old", // schema context\n  "targets": {\n    // do not lose\n    "prod":"one",\n  },\n  "text": "https://host/a//b /*literal*/",\n}\n',
  );
  updateJsonc(path, [[["targets", "test"], "two"]], "https://schema/new");
  const source = readFileSync(path, "utf8");
  for (const comment of [
    "// header",
    "// own intent",
    "// schema context",
    "// do not lose",
    "/*literal*/",
  ])
    expect(source).toContain(comment);
  expect(Object.keys(readObject(path))[0]).toBe("$schema");
  expect(readObject(path).targets).toEqual({ prod: "one", test: "two" });
});
test("Datadog writes keep its original schema URL and preserve all comments", () => {
  const path = file("legacy.dash.jsonc", dd());
  writeFileSync(
    path,
    `// KEEP THIS\n${readFileSync(path, "utf8").replace('"widgets":[]', '"widgets": [ /* widget comment */ ]')}`,
  );
  writeDashboard(path, { ...dd(), zip_dashboard_id: "prod-id" });
  expect(readFileSync(path, "utf8")).toContain("/* widget comment */");
  expect(readFileSync(path, "utf8")).toContain("// KEEP THIS");
  expect(readObject(path).$schema).toBe(
    "https://raw.githubusercontent.com/brady-zip/chart-room/main/schema/datadog-dashboard.schema.json",
  );
});
test("mixed scans prune stale entries and stay scoped by repository/provider", () => {
  file("one.dash.jsonc", dd());
  file("a space.omni.jsonc", definition());
  file("old.dash.json", dd());
  mkdirSync(join(root, "node_modules"));
  writeFileSync(join(root, "node_modules", "skip.omni.jsonc"), "bad");
  expect(refreshCache(root)).toHaveLength(3);
  rmSync(join(root, "one.dash.jsonc"));
  refreshCache(root, "datadog");
  expect(readCache().entries).toHaveLength(2);
  expect(completionCandidates(["test", ""], root)).toContain(
    "a space.omni.jsonc",
  );
  expect(
    completionCandidates(["--provider", "omni", "test", ""], root),
  ).not.toContain("old.dash.json");
  expect(
    completionCandidates(["--provider", "datadog", "test", ""], root),
  ).not.toContain("a space.omni.jsonc");
  const elsewhere = mkdtempSync(join(tmpdir(), "other-room-"));
  mkdirSync(join(elsewhere, ".git"));
  expect(completionCandidates(["test", ""], elsewhere)).not.toContain(
    "a space.omni.jsonc",
  );
  rmSync(elsewhere, { recursive: true, force: true });
});
test("v1 cache entries migrate as Datadog; corrupt and unsupported caches rebuild without file writes", () => {
  const path = file("old.dash.json", dd());
  const before = readFileSync(path, "utf8");
  mkdirSync(process.env.CHART_ROOM_CONFIG_DIR!, { recursive: true });
  writeFileSync(
    getCachePath(),
    JSON.stringify({
      version: 1,
      entries: [{ path, title: "Old", lastScanned: "yesterday" }],
    }),
  );
  expect(readCache().entries[0]).toMatchObject({
    provider: "datadog",
    repository: root,
  });
  for (const corrupt of [
    "{",
    '{"version":999,"entries":[]}',
    '{"version":2,"entries":null}',
  ]) {
    writeFileSync(getCachePath(), corrupt);
    expect(readCache().entries).toEqual([]);
    expect(refreshCache(root)).toHaveLength(1);
    expect(readFileSync(path, "utf8")).toBe(before);
  }
});
test("completion includes new commands/options and paths containing spaces", () => {
  file("my dashboard.omni.jsonc", definition());
  refreshCache(root);
  expect(completionCandidates([""], root)).toEqual([...COMMANDS].sort());
  expect(completionCandidates(["prod", "--"], root)).toContain("--dry-run");
  expect(completionCandidates(["status", "--"], root)).toContain("--json");
  expect(completionCandidates(["init", "--provider", ""], root)).toEqual([
    "datadog",
    "omni",
  ]);
  expect(completionCandidates(["test", "my"], root)).toEqual([
    "my dashboard.omni.jsonc",
  ]);
  for (const shell of ["bash", "zsh", "fish"]) {
    const script = completionScript(shell);
    expect(script).toContain("__complete");
    expect(script).not.toMatch(/curl|whoami|OMNI_API_TOKEN|jq/);
    const executable = shell === "fish" ? Bun.which("fish") : `/bin/${shell}`;
    if (executable)
      expect(
        spawnSync(executable, ["-n"], { input: script, encoding: "utf8" })
          .status,
      ).toBe(0);
  }
});
test("bash, zsh and fish completion preserve a filename as one candidate", () => {
  const candidate = "my dashboard.omni.jsonc";
  const bash = `chart-room() { printf '%s\\n' 'my dashboard.omni.jsonc'; }\n${completionScript("bash")}\nCOMP_WORDS=(chart-room test my); COMP_CWORD=2; _chart_room_completions; printf '<%s>\\n' "\${COMPREPLY[@]}"`;
  expect(
    spawnSync("/bin/bash", ["-c", bash], { encoding: "utf8" }).stdout.trim(),
  ).toBe(`<${candidate}>`);
  const zsh = `compdef() {}\nchart-room() { printf '%s\\n' 'my dashboard.omni.jsonc'; }\ncompadd() { shift; shift; printf '<%s>\\n' "\${candidates[@]}"; }\n${completionScript("zsh")}\nwords=(chart-room test my); CURRENT=3; _chart_room`;
  expect(
    spawnSync("/bin/zsh", ["-f", "-c", zsh], {
      encoding: "utf8",
    }).stdout.trim(),
  ).toBe(`<${candidate}>`);
  const fish = Bun.which("fish");
  expect(fish).not.toBeNull();
  const fishScript = `function chart-room; printf '%s\\n' 'my dashboard.omni.jsonc'; end\n${completionScript("fish")}\ncomplete -C 'chart-room test my'`;
  expect(
    spawnSync(fish!, ["--no-config", "-c", fishScript], {
      encoding: "utf8",
    }).stdout.trim(),
  ).toBe(candidate);
});
test("completion skips option values before and after commands", () => {
  file("my dashboard.omni.jsonc", definition());
  file("my dashboard.dash.jsonc", dd());
  refreshCache(root);
  expect(completionCandidates(["--provider=o"], root)).toEqual([
    "--provider=omni",
  ]);
  expect(completionCandidates(["status", "--format=j"], root)).toEqual([
    "--format=json",
  ]);
  expect(
    completionCandidates(
      ["--provider=omni", "test", "--provider", "datadog", "my"],
      root,
    ),
  ).toEqual(["my dashboard.dash.jsonc"]);
  for (const provider of ["omni", "datadog"]) {
    const expected = `my dashboard.${provider === "omni" ? "omni" : "dash"}.jsonc`;
    for (const options of [
      ["--provider", provider, "--profile", "omni", "--instance", "test"],
      [`--provider=${provider}`, "--profile=omni", "--instance=test"],
    ]) {
      for (const words of [
        [...options, "test", "my"],
        ["test", ...options, "my"],
        [...options.slice(0, 2), "test", ...options.slice(2), "my"],
      ])
        expect(completionCandidates(words, root)).toEqual([expected]);
      expect(
        completionCandidates([...options, "status", "--"], root),
      ).toContain("--json");
      expect(completionCandidates(["prod", ...options, "--"], root)).toContain(
        "--dry-run",
      );
      expect(completionCandidates([...options, ""], root)).toEqual(
        [...COMMANDS].sort(),
      );
    }
  }
  // Values that happen to name a command are never commands themselves.
  for (const flag of ["--profile", "--instance", "--model", "--topic"])
    expect(completionCandidates([flag, "omni", "test", "my"], root)).toEqual([
      "my dashboard.dash.jsonc",
      "my dashboard.omni.jsonc",
    ]);
  for (const options of [
    ["--provider", "omni", "--profile", "test"],
    ["--provider=omni", "--profile=test"],
  ]) {
    expect(completionCandidates([...options, "omni", ""], root)).toEqual([
      "fields",
      "models",
      "topics",
    ]);
    expect(completionCandidates(["omni", ...options, "f"], root)).toEqual([
      "fields",
    ]);
    for (const subcommand of ["models", "topics", "fields"])
      expect(
        completionCandidates([...options, "omni", subcommand, "--"], root),
      ).toContain("--refresh");
  }
});
test("duplicate targets fail offline, and init with both IDs never creates", () => {
  const first = file("one.omni.jsonc", definition());
  expect(initializeOmni(first, {})).toMatchObject({
    outcome: "ALREADY_LINKED",
    verified: false,
  });
  file("two.omni.jsonc", definition());
  expect(() => assertUniqueTargets(first, definition())).toThrow(
    "linked more than once",
  );
});
test("PR comment distinguishes file IDs, verified publication, stale content, and failed attempts", () => {
  const path = file("pilot.omni.jsonc", definition());
  expect(
    commentBody(path, "omni", "Pilot", "https://zip.omniapp.co/dashboards/test")
      .body,
  ).toContain("No local publication verification");
  recordVerification(path, "omni", "test", {
    outcome: "UPDATED",
    verified: true,
    id: "test",
  });
  expect(
    commentBody(path, "omni", "Pilot", "https://zip.omniapp.co/dashboards/test")
      .body,
  ).toContain("published readback verified");
  writeFileSync(path, readFileSync(path, "utf8") + "\n");
  expect(lastVerification(path, "omni", "test")?.matchesLocalFile).toBe(false);
  expect(
    commentBody(path, "omni", "Pilot", "https://zip.omniapp.co/dashboards/test")
      .body,
  ).toContain("file changed");
  recordVerification(path, "omni", "test", {
    outcome: "FAILED",
    verified: false,
  });
  expect(
    commentBody(path, "omni", "Pilot", "https://zip.omniapp.co/dashboards/test")
      .body,
  ).toContain("publication not verified");
});
