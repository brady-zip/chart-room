import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { readObject } from "../src/lib/files.js";
import { definition } from "./helpers.js";

const cli = resolve("src/index.ts");
const fake = resolve("tests/fixtures/fake-datadog.ts");
const updaterStub = resolve("tests/fixtures/stub-updater.ts");
let root: string;
let env: NodeJS.ProcessEnv;
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chart-room-cli-"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, ".git"));
  for (const name of ["uvx", "gh", "omni"])
    writeFileSync(
      join(root, "bin", name),
      `#!/bin/sh\nFAKE_EXECUTABLE=${name} exec ${quote(process.execPath)} ${quote(fake)} "$@"\n`,
      { mode: 0o755 },
    );
  env = {
    ...process.env,
    CHART_ROOM_NO_UPDATE: "1",
    CHART_ROOM_CONFIG_DIR: join(root, "config"),
    OMNI_CONFIG_PATH: join(root, "no-config.json"),
    OMNI_API_TOKEN: "",
    OMNI_BASE_URL: "",
    CHART_ROOM_OMNI_BIN: join(root, "bin", "omni"),
    PATH: `${join(root, "bin")}:${process.env.PATH}`,
    FAKE_STATE: join(root, "state.json"),
    FAKE_CALLS: join(root, "calls.jsonl"),
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));
const run = (args: string[], input = "", extraEnv = {}) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...env, ...extraEnv },
    input,
    encoding: "utf8",
    timeout: 30_000,
  });
const calls = () =>
  existsSync(env.FAKE_CALLS!)
    ? readFileSync(env.FAKE_CALLS!, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
const state = () => JSON.parse(readFileSync(env.FAKE_STATE!, "utf8"));
function dd(file = "original.dash.jsonc") {
  writeFileSync(
    join(root, file),
    `// keep this comment\n${JSON.stringify({ title: 'literal "quotes" $(echo no) `no`', description: 'description "quoted"\nline two', layout_type: "ordered", widgets: [{ definition: { type: "note", content: "Author text" }, layout: { x: 0, y: 4, width: 12, height: 2 } }], template_variables: [{ name: "env", default: "prod" }], notify_list: [] })}`,
  );
  return file;
}

test("legacy Datadog init, test, prod, status and dry-run preserve payloads and exact argv", () => {
  const file = dd("a dashboard.dash.jsonc");
  let result = run(["init", file]);
  expect(result.status).toBe(0);
  const value = readObject(join(root, file));
  expect(value.zip_dashboard_id).toBe("dd-1");
  expect(value.zip_test_dashboard_id).toBe("dd-2");
  expect(readFileSync(join(root, file), "utf8")).toContain(
    "// keep this comment",
  );
  let observed = calls();
  expect(observed[0].args.slice(0, 6)).toEqual([
    "--from",
    "datadog",
    "dogshell",
    "dashboard",
    "post",
    value.title,
  ]);
  expect(observed[0].args[observed[0].args.indexOf("--description") + 1]).toBe(
    value.description,
  );
  const prodBefore = structuredClone(state().dashboards["dd-1"]);
  result = run(["test", file, "--format", "json"]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).id).toBe("dd-2");
  expect(state().dashboards["dd-1"]).toEqual(prodBefore);
  const preview = state().dashboards["dd-2"];
  expect(preview.title).toBe(`[TEST] ${value.title}`);
  expect(preview.widgets[0].definition.content).toContain("TEST DASHBOARD");
  expect(preview.widgets[1].layout.y).toBe(6);
  expect(preview.widgets.at(-1).definition.text).toContain(
    "Source definition:",
  );
  observed = calls();
  const upload = observed.at(-1);
  expect(JSON.parse(upload.input)).toEqual(preview.widgets);
  expect(upload.args).toContain(JSON.stringify(value.template_variables));
  const count = observed.length;
  result = run(["prod", file, "--dry-run"]);
  expect(result.status).toBe(0);
  expect(calls()).toHaveLength(count);
  result = run(["prod", file]);
  expect(result.status).toBe(0);
  expect(state().dashboards["dd-1"].title).toBe(value.title);
  result = run(["status", file, "--json"]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).targets.prod.outcome).toBe("IN_SYNC");
  expect(JSON.parse(result.stdout).targets.test.outcome).toBe("IN_SYNC");
}, 30_000);

test("Datadog init persists first ID before a second create fails", () => {
  const file = dd();
  const result = run(["init", file], "", { FAIL_SECOND_CREATE: "1" });
  expect(result.status).toBe(1);
  expect(readObject(join(root, file)).zip_dashboard_id).toBe("dd-1");
  expect(readObject(join(root, file)).zip_test_dashboard_id).toBeUndefined();
  expect(result.stderr).not.toContain("secret");
});
test("JSON status skips the updater while human status still checks", () => {
  const file = dd("a dashboard.dash.jsonc");
  const status = (args: string[]) =>
    spawnSync(process.execPath, ["--preload", updaterStub, cli, ...args], {
      cwd: root,
      env: { ...env, CHART_ROOM_NO_UPDATE: "" },
      encoding: "utf8",
      timeout: 30_000,
    });
  const human = status(["status", file]);
  expect(human.status).toBe(0);
  expect(human.stdout).toContain("STUB_UPDATE_SUCCEEDED");
  for (const args of [
    ["status", file, "--json"],
    ["status", "--json", file],
    ["status", file, "--format", "json"],
    ["--format=json", "status", file],
    ["status", file, "--json", "--format=human"],
  ]) {
    const result = status(args);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).not.toContain("STUB_UPDATE_SUCCEEDED");
    expect(JSON.parse(result.stdout)).toEqual({
      provider: "datadog",
      targets: {
        prod: { outcome: "NOT_LINKED" },
        test: { outcome: "NOT_LINKED" },
      },
    });
  }
  expect(calls()).toEqual([]);
}, 30_000);
test("Datadog init template, both-ID refusal, link prod/test and overwrite refusal stay available", () => {
  expect(run(["init", "new.dash.jsonc"]).status).toBe(0);
  const count = calls().length;
  expect(run(["init", "new.dash.jsonc"]).status).toBe(1);
  expect(calls()).toHaveLength(count);
  const file = dd("linked.dash.json");
  expect(run(["link", file, "dd-1"]).status).toBe(0);
  expect(run(["link", "--test", file, "dd-2"]).status).toBe(0);
  expect(run(["link", file, "dd-2"], "n\n").status).toBe(1);
  expect(readObject(join(root, file)).zip_dashboard_id).toBe("dd-1");
}, 30_000);
test("legacy comment is upserted with provider marker; IDs alone never imply verified publish", () => {
  const file = dd();
  expect(run(["init", file]).status).toBe(0);
  expect(run(["comment", file]).status).toBe(0);
  expect(run(["comment", file]).status).toBe(0);
  expect(state().comments).toHaveLength(1);
  expect(state().comments[0].body).toContain("<!-- chart-room:datadog:");
  expect(state().comments[0].body).toContain(
    "No local publication verification",
  );
  expect(state().comments[0].body).toContain("/dd-1");
  expect(state().comments[0].body).toContain("/dd-2");
  expect(calls().at(-1).args).toContain("PATCH");
  expect(calls().at(-1).args.slice(-2)).toEqual(["--input", "-"]);
}, 30_000);
test("status keeps API failures separate from absence, and redacts stderr", () => {
  const file = dd();
  expect(run(["init", file]).status).toBe(0);
  for (const [status, outcome, code] of [
    [401, "FAILED", "UNAUTHENTICATED"],
    [403, "FAILED", "PERMISSION_DENIED"],
    [404, "NOT_FOUND", undefined],
    [429, "FAILED", "RATE_LIMITED"],
  ] as const) {
    const result = run(["status", file, "--json"], "", {
      FAKE_ERROR: String(status),
    });
    const prod = JSON.parse(result.stdout).targets.prod;
    expect(prod.outcome).toBe(outcome);
    if (code) expect(prod.error.code).toBe(code);
    expect(result.stdout + result.stderr).not.toContain(
      "SECRET_SHOULD_BE_REDACTED",
    );
  }
}, 30_000);
test("mismatch and invalid Omni definition fail before any subprocess API invocation", () => {
  const file = dd();
  const result = run(["test", file, "--provider", "omni", "--format", "json"]);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr).error.code).toBe("PROVIDER_MISMATCH");
  expect(calls()).toEqual([]);
  writeFileSync(
    join(root, "invalid.omni.jsonc"),
    JSON.stringify({ ...definition(), version: 9 }),
  );
  expect(run(["test", "invalid.omni.jsonc"]).status).toBe(1);
  writeFileSync(join(root, "pilot.omni.jsonc"), JSON.stringify(definition()));
  for (const command of ["test", "init", "link", "comment", "validate"]) {
    const mismatch = run([
      command,
      "pilot.omni.jsonc",
      ...(command === "link" ? ["example"] : []),
      "--instance",
      "https://wrong.omniapp.co",
      "--format",
      "json",
    ]);
    expect(mismatch.status).toBe(1);
    expect(JSON.parse(mismatch.stderr).error.code).toBe("WRONG_INSTANCE");
  }
  expect(calls()).toEqual([]);
}, 30_000);
test("offline validation, mixed scan and completion never call a provider or updater", () => {
  dd();
  writeFileSync(join(root, "pilot.omni.jsonc"), JSON.stringify(definition()));
  let result = run(["validate", "pilot.omni.jsonc", "--format", "json"]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).outcome).toBe("VALIDATED");
  result = run(["scan", "--format", "json"]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout).dashboards).toHaveLength(2);
  result = run(["__complete", "test", "p"]);
  expect(result.status).toBe(0);
  expect(result.stdout.trim()).toBe("pilot.omni.jsonc");
  for (const shell of ["bash", "zsh", "fish"])
    expect(run(["completion", shell]).status).toBe(0);
  expect(calls()).toEqual([]);
}, 30_000);
test("auth status is routed as authentication and reports missing credentials before any API call", () => {
  const result = run([
    "auth",
    "status",
    "--provider",
    "omni",
    "--profile",
    "missing",
    "--model",
    definition().document.modelId,
    "--format",
    "json",
  ]);
  expect(result.status).toBe(1);
  expect(JSON.parse(result.stderr).error.code).toBe("MISSING_CREDENTIALS");
  expect(calls().map((call) => call.args)).toEqual([
    ["--version"],
    ["documents", "--help"],
  ]);
});

test("all command and subcommand help is available", () => {
  for (const args of [
    ["--help"],
    ["init", "--help"],
    ["import", "--help"],
    ["auth", "login", "--help"],
    ["omni", "models", "--help"],
    ["omni", "topics", "--help"],
    ["omni", "fields", "--help"],
  ]) {
    const result = run(args);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage:");
  }
}, 30_000);
