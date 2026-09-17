import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import golden from "./fixtures/evergreen-contract.json";
import {
  definition,
  draft,
  fakeClient,
  policy,
  remote,
  query,
  written,
} from "./helpers.js";
import {
  adoptDocument,
  containsDesired,
  desiredDocument,
  drift,
  matchesDocument,
  patchBatches,
  validateDefinition,
  type NativeObject,
  type OmniDocument,
} from "../src/providers/omni/definition.js";
import { reconcile } from "../src/providers/omni/sync.js";
import {
  OmniClient,
  assertCredentials,
  transportError,
} from "../src/providers/omni/client.js";
import { provisionTarget } from "../src/providers/omni/provision.js";
import { readObject } from "../src/lib/files.js";

test("fixture is native-schema valid and Evergreen provenance is byte identical", () => {
  const value = validateDefinition(definition());
  expect(desiredDocument(value, golden.source, "test")).toEqual(golden.test);
  expect(desiredDocument(value, golden.source, "prod")).toEqual(golden.prod);
  expect(value).toEqual(definition());
  expect(
    desiredDocument(value, { ...golden.source, dirty: true }, "test")
      .description,
  ).toContain("uncommitted");
  expect(
    desiredDocument(value, { ...golden.source, dirty: true }, "test")
      .description,
  ).not.toContain("Source definition:");
});

test("normalized outgoing payloads match Evergreen above 48 entries, including controls/settings/layout", () => {
  const batches = patchBatches(
    golden.desired as OmniDocument,
    golden.current as OmniDocument,
  );
  const upserts: NativeObject = {};
  const deletes: string[] = [];
  const metadata: NativeObject[] = [];
  const sizes: number[] = [];
  for (const patch of batches.slice(0, -1)) {
    const qp = patch.queryPresentations as { data: NativeObject } | undefined;
    if (!qp) {
      metadata.push(patch);
      continue;
    }
    sizes.push(Object.keys(qp.data).length);
    for (const [key, value] of Object.entries(qp.data)) {
      if (value === null) deletes.push(key);
      else upserts[key] = value;
    }
  }
  expect({
    upserts,
    deletes: deletes.sort(),
    metadata,
    order: batches.at(-1),
  }).toEqual(golden.normalized);
  expect(sizes).toEqual(golden.batchSizes);
  expect(sizes.every((size) => size <= 48)).toBe(true);
  expect(batches[3]).toHaveProperty("containers");
  expect(batches[4]).toEqual({
    queryPresentations: { data: expect.objectContaining({ "200": null }) },
  });
});

describe("strict v1 content boundary", () => {
  const changes: [string, (v: ReturnType<typeof definition>) => void][] = [
    [
      "version",
      (v) => {
        v.version = 2 as 1;
      },
    ],
    [
      "provider",
      (v) => {
        v.provider = "datadog" as "omni";
      },
    ],
    [
      "instance",
      (v) => {
        v.instance = "https://other.omniapp.co";
      },
    ],
    [
      "duplicate target",
      (v) => {
        v.targets.test = v.targets.prod;
      },
    ],
    [
      "missing target",
      (v) => {
        delete v.targets.test;
      },
    ],
    [
      "invalid target",
      (v) => {
        v.targets.prod = "-x";
      },
    ],
    [
      "empty metadata",
      (v) => {
        v._meta.intent = " ";
      },
    ],
    [
      "invalid model",
      (v) => {
        v.document.modelId = "not-a-uuid";
      },
    ],
    [
      "missing setting",
      (v) => {
        delete v.document.settings.facetFilters;
      },
    ],
    [
      "missing layout",
      (v) => {
        v.document.containers = [];
      },
    ],
    [
      "empty workbook",
      (v) => {
        v.document.queryPresentations = { data: {}, order: [] };
      },
    ],
    [
      "tab order",
      (v) => {
        v.document.queryPresentations.order = [];
      },
    ],
    [
      "tombstone",
      (v) => {
        v.document.queryPresentations.data["1"] =
          null as unknown as NativeObject;
      },
    ],
    [
      "unsupported tile",
      (v) => {
        v.document.queryPresentations.data["1"]!.type = "spreadsheet";
      },
    ],
    [
      "query binding",
      (v) => {
        v.document.queryPresentations.data["1"]!.query = {
          model_extension_id: "draft-local",
        };
      },
    ],
    [
      "branch",
      (v) => {
        v.document.queryPresentations.data["1"]!.query = {
          branch_id: "branch",
        };
      },
    ],
    [
      "foreign model",
      (v) => {
        v.document.queryPresentations.data["1"]!.foreignModelId = "foreign";
      },
    ],
    [
      "visualization",
      (v) => {
        v.document.queryPresentations.data["1"]!.visConfig = {
          chartType: "not-a-chart",
        };
      },
    ],
    [
      "broken link",
      (v) => {
        v.document.queryPresentations.data["1"] = {
          type: "linked",
          sourceQueryPresentationKey: "2",
        };
      },
    ],
  ];
  for (const [name, mutate] of changes)
    test(name, () => {
      const value = definition();
      mutate(value);
      expect(() => validateDefinition(value)).toThrow();
    });
  test("native KPI/table settings and a date control remain typed", () => {
    const value = definition();
    value.document.queryPresentations = {
      data: {
        "1": {
          type: "query",
          query: query({ fields: ["events.count"] }),
          visConfig: {
            chartType: "kpi",
            visConfig: {
              visType: "omni-kpi",
              config: { fontSize: 36, customSetting: { preserved: true } },
            },
          },
        },
        "2": {
          type: "sql",
          query: query({ userEditedSQL: "select 1" }),
          visConfig: { chartType: "table" },
          resultConfig: { columnWidths: { count: 120 } },
        },
        "3": { type: "linked", sourceQueryPresentationKey: "1" },
      },
      order: ["1", "2", "3"],
    };
    value.document.controls = {
      data: {
        date: {
          config: {
            type: "date",
            kind: "ON_OR_AFTER",
            left_side: "2026-09-01",
            fieldName: "events.date",
            label: "Date",
          },
        },
      },
      order: ["date"],
    };
    expect(validateDefinition(value)).toEqual(value);
  });
});

test("readback allows server defaults but requires exact owned keys and order", () => {
  const desired = definition().document;
  const actual = remote(desired) as unknown as OmniDocument;
  expect(matchesDocument(actual, desired)).toBe(true);
  actual.queryPresentations.data["2"] = { type: "blank" };
  expect(matchesDocument(actual, desired)).toBe(false);
  delete actual.queryPresentations.data["2"];
  actual.controls.data.stale = { config: {} };
  expect(matchesDocument(actual, desired)).toBe(false);
  expect(containsDesired(true, 1)).toBe(false);
  expect(drift(actual, desired)).toEqual(["controls"]);
});

test("successful native lifecycle verifies before and after publishing; JSON travels only on stdin", () => {
  const desired = definition().document;
  desired.description =
    'literal `$(touch SHOULD_NOT_EXIST)` "quotes"\nnext line';
  const { client, calls } = fakeClient([
    remote({ ...desired, name: "Before" }),
    [],
    policy(),
    written(),
    written(),
    written(),
    written(),
    remote(desired),
    [draft()],
    written(),
    remote(desired),
  ]);
  expect(reconcile(client, "ci-pilot", desired, true).outcome).toBe("UPDATED");
  expect(calls.map((c) => c.args[7])).toEqual([
    "v2-get",
    "list-drafts",
    "get-permissions",
    "v2-patch-draft",
    "v2-patch-draft-by-identifier",
    "v2-patch-draft-by-identifier",
    "v2-patch-draft-by-identifier",
    "v2-get-draft",
    "list-drafts",
    "v2-publish-draft",
    "v2-get",
  ]);
  for (const call of calls) {
    expect(call.args.slice(0, 6)).toEqual([
      "--base-url",
      "https://zip.omniapp.co",
      "--format",
      "json",
      "--profile",
      "fixture-profile",
    ]);
    expect(call.args).not.toContain("--token");
    expect(call.args.join(" ")).not.toContain("SHOULD_NOT_EXIST");
    if (call.input !== undefined) {
      expect(call.args.slice(-2)).toEqual(["--body", "-"]);
      expect(() => JSON.parse(call.input!)).not.toThrow();
    }
  }
  expect(calls[5]!.input).toContain("SHOULD_NOT_EXIST");
});

for (const apply of [true, false])
  test(`unchanged never writes (apply=${apply})`, () => {
    const desired = definition().document;
    const { client, calls } = fakeClient([remote(desired), []]);
    expect(reconcile(client, "ci-pilot", desired, apply).outcome).toBe(
      "UNCHANGED",
    );
    expect(calls).toHaveLength(2);
  });
test("dry-run and required Omni PR perform no mutations", () => {
  const desired = definition().document;
  const { client, calls } = fakeClient([
    remote({ ...desired, name: "Before" }),
    [],
    policy(),
  ]);
  expect(reconcile(client, "ci-pilot", desired, false).outcome).toBe(
    "WOULD_UPDATE",
  );
  expect(calls.every((c) => c.input === undefined)).toBe(true);
  const locked = fakeClient([
    remote({ ...desired, name: "Before" }),
    [],
    policy(true),
  ]);
  expect(() => reconcile(locked.client, "ci-pilot", desired, true)).toThrow(
    "pull request",
  );
  expect(locked.calls.every((c) => c.input === undefined)).toBe(true);
});
test("pre-existing main draft blocks even unchanged deployment", () => {
  const desired = definition().document;
  const { client, calls } = fakeClient([remote(desired), [draft()]]);
  expect(() => reconcile(client, "ci-pilot", desired, true)).toThrow(
    "existing main draft",
  );
  expect(calls).toHaveLength(2);
});

for (const failure of [
  "draft-content",
  "stale",
  "multiple-drafts",
  "publish-timeout",
  "published-content",
  "create-timeout",
])
  test(`failed verification: ${failure}`, () => {
    const desired = definition().document;
    const before = remote({ ...desired, name: "Before" });
    const timeout = {
      status: null,
      stdout: "",
      stderr: "secret-token",
      error: { code: "ETIMEDOUT" },
    };
    const responses = [
      before,
      [],
      policy(),
      failure === "create-timeout" ? timeout : written(),
      written(),
      written(),
      written(),
      failure === "draft-content" ? before : remote(desired),
      failure === "multiple-drafts"
        ? [draft(), draft({ identifier: "other" })]
        : [draft({ draftOutOfDate: failure === "stale" })],
      failure === "publish-timeout" ? timeout : written(),
      failure === "published-content" ? before : remote(desired),
    ];
    const { client, calls } = fakeClient(responses);
    expect(() => reconcile(client, "ci-pilot", desired, true)).toThrow(
      "Deployment did not verify",
    );
    expect(
      calls.filter((c) => c.args.includes("v2-publish-draft")),
    ).toHaveLength(
      ["publish-timeout", "published-content"].includes(failure) ? 1 : 0,
    );
    expect(calls.some((c) => c.args.includes("discard-draft"))).toBe(false);
  });

for (const [status, code] of [
  [401, "UNAUTHENTICATED"],
  [403, "PERMISSION_DENIED"],
  [404, "NOT_FOUND"],
  [409, "CONFLICT"],
  [429, "RATE_LIMITED"],
  [500, "API_ERROR"],
] as const)
  test(`redacted HTTP ${status}`, () => {
    const error = transportError(
      {
        status: 1,
        stdout: "",
        stderr: JSON.stringify({ status, error: "TOKEN_SUPER_SECRET" }),
      },
      "v2-get",
    );
    expect(error.code).toBe(code);
    expect(JSON.stringify(error)).not.toContain("TOKEN_SUPER_SECRET");
  });
test("archived targets and reserved identifiers are distinct from absence", () => {
  for (const [status, detail, code] of [
    [404, "Document has been archived", "TARGET_ARCHIVED"],
    [
      400,
      'Identifier "reserved" is already in use for another document',
      "CONFLICT",
    ],
  ] as const) {
    const error = transportError(
      {
        status: 1,
        stdout: "",
        stderr: JSON.stringify({ status, error: detail }),
      },
      "v2-create",
      true,
    );
    expect(error.code).toBe(code);
  }
});
test("missing CLI, unsupported pin, missing command, malformed output, and missing draft context are distinct", () => {
  expect(() =>
    new OmniClient(undefined, undefined, () => ({
      status: null,
      stdout: "",
      stderr: "",
      error: { code: "ENOENT" },
    })).capabilities(),
  ).toThrow("not found on PATH");
  expect(() =>
    new OmniClient(undefined, undefined, () => ({
      status: 0,
      stdout: "omni version 9.0.0",
      stderr: "",
    })).capabilities(),
  ).toThrow("1.3.1");
  let n = 0;
  expect(() =>
    new OmniClient(undefined, undefined, () => ({
      status: 0,
      stdout: n++ ? "v2-get" : "omni version 1.3.1",
      stderr: "",
    })).capabilities(),
  ).toThrow("missing documents");
  expect(() =>
    fakeClient([
      { status: 0, stdout: "not-json", stderr: "secret" },
    ]).client.read("x"),
  ).toThrow("malformed JSON");
  expect(() => fakeClient([{}]).client.read("x")).toThrow("pinned schema");
  expect(() =>
    fakeClient([[{ identifier: "draft-1" }]]).client.mainDrafts("x"),
  ).toThrow("pinned schema");
});

test("credentials stay in official storage; host conflicts fail before transport", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-profile-"));
  const path = join(dir, "config.json");
  const env = { OMNI_CONFIG_PATH: path };
  expect(() =>
    assertCredentials("https://zip.omniapp.co", undefined, env),
  ).toThrow("No Omni credential");
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      defaultProfile: "zip",
      profiles: {
        zip: {
          apiEndpoint: "https://other.omniapp.co",
          authMethod: "api-key",
          apiKey: "SECRET",
        },
      },
    }),
  );
  expect(() => assertCredentials("https://zip.omniapp.co", "zip", env)).toThrow(
    "different instance",
  );
  writeFileSync(
    path,
    readFileSync(path, "utf8").replace("other.omniapp", "zip.omniapp"),
  );
  expect(() =>
    assertCredentials("https://zip.omniapp.co", "zip", env),
  ).not.toThrow();
  expect(() =>
    assertCredentials("https://zip.omniapp.co", "missing", env),
  ).toThrow("does not exist");
  expect(() =>
    assertCredentials("https://zip.omniapp.co", "zip", {
      ...env,
      OMNI_BASE_URL: "https://wrong.omniapp.co",
    }),
  ).toThrow("conflicts");
});

test("login delegates interactive setup to the official CLI with argv and no token argument", () => {
  const { client, calls } = fakeClient([{}]);
  client.login();
  expect(calls).toEqual([
    {
      args: [
        "config",
        "init",
        "--endpoint",
        "https://zip.omniapp.co",
        "--name",
        "fixture-profile",
      ],
      input: undefined,
      interactive: true,
    },
  ]);
});

test("adoption preserves stable keys, layout and config; refuses draft models and unknown resources", () => {
  const desired = definition().document;
  const adopted = adoptDocument(remote(desired));
  expect(adopted.containers).toEqual(desired.containers);
  expect(adopted.queryPresentations.order).toEqual(["1"]);
  expect(adopted).not.toHaveProperty("workbookModelId");
  validateDefinition({ ...definition(), document: adopted });
  const bound = remote(desired);
  (bound.queryPresentations as { data: NativeObject }).data["1"] = {
    ...(bound.queryPresentations as { data: Record<string, NativeObject> })
      .data["1"],
    query: query({ model_extension_id: "draft-only" }),
  };
  expect(() => adoptDocument(bound)).toThrow("cannot be copied");
  expect(() =>
    adoptDocument({ ...remote(desired), unknownResource: {} }),
  ).toThrow("lose content");
});

test("ambiguous create persists intent, recovers the same ID and never creates a second target", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-create-"));
  const file = join(dir, "pilot.omni.jsonc");
  const value = definition();
  value.targets = {};
  writeFileSync(file, "// preserve me\n" + JSON.stringify(value));
  const timeout = fakeClient([
    {
      status: null,
      stdout: "",
      stderr: "SECRET",
      error: { code: "ETIMEDOUT" },
    },
  ]);
  expect(() =>
    provisionTarget(
      timeout.client,
      file,
      value,
      "prod",
      "folder",
      value.document,
    ),
  ).toThrow("Recovery identifier");
  const intent = JSON.parse(readFileSync(`${file}.provision.json`, "utf8"))
    .targets.prod;
  expect(readObject(file).targets).toEqual({});
  const recovery = fakeClient([remote(value.document)]);
  expect(
    provisionTarget(
      recovery.client,
      file,
      value,
      "prod",
      "folder",
      value.document,
    ),
  ).toEqual({ id: intent.identifier, recovered: true });
  expect(recovery.calls).toHaveLength(1);
  expect(readObject(file).targets).toEqual({ prod: intent.identifier });
  expect(readFileSync(file, "utf8")).toContain("// preserve me");
});

test("ambiguous create followed by 404 requires explicit recovery, never an automatic retry", () => {
  const dir = mkdtempSync(join(tmpdir(), "omni-recover-"));
  const file = join(dir, "pilot.omni.jsonc");
  const value = definition();
  value.targets = {};
  writeFileSync(file, JSON.stringify(value));
  const first = fakeClient([
    { status: null, stdout: "", stderr: "", error: { code: "ETIMEDOUT" } },
  ]);
  expect(() =>
    provisionTarget(
      first.client,
      file,
      value,
      "prod",
      "folder",
      value.document,
    ),
  ).toThrow();
  const again = fakeClient([
    { status: 1, stdout: "", stderr: '{"status":404}' },
  ]);
  expect(() =>
    provisionTarget(
      again.client,
      file,
      value,
      "prod",
      "folder",
      value.document,
    ),
  ).toThrow("--retry-create");
  expect(again.calls).toHaveLength(1);
});
