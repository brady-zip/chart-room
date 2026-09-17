import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  definition,
  fakeClient,
  page,
  modelRecord,
  identity,
  query,
  folderRecord,
} from "./helpers.js";
import {
  discover,
  readCatalog,
  validateRemote,
} from "../src/providers/omni/discovery.js";
import { checkFolders, checkModel } from "../src/providers/omni/provision.js";
import { completionCandidates } from "../src/commands/completion.js";

let root: string;
let previous: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chart-room-discovery-"));
  previous = process.env.CHART_ROOM_CONFIG_DIR;
  process.env.CHART_ROOM_CONFIG_DIR = root;
});
afterEach(() => {
  process.env.CHART_ROOM_CONFIG_DIR = previous;
  rmSync(root, { recursive: true, force: true });
});

test("paginated model discovery caches explicitly and a rejected refresh keeps the last known catalog", () => {
  const { client, calls } = fakeClient([
    page([modelRecord()], "cursor literal $()"),
    page([{ ...modelRecord(), id: "second" }]),
  ]);
  const result = discover(client, "models", undefined, undefined, true);
  expect(result.entries).toHaveLength(2);
  expect(calls[1]!.args.slice(-2)).toEqual(["--cursor", "cursor literal $()"]);
  const saved = readCatalog(client.instance, client.profile);
  expect(saved?.names).toEqual([modelRecord().id, "second"]);
  expect(
    completionCandidates([
      "omni",
      "topics",
      "--profile",
      "fixture-profile",
      "--model",
      "",
    ]),
  ).toEqual([modelRecord().id, "second"]);
  const expired = fakeClient([
    { status: 1, stdout: "", stderr: '{"status":401,"error":"secret"}' },
  ]);
  expect(() =>
    discover(expired.client, "models", undefined, undefined, true),
  ).toThrow("rejected");
  expect(readCatalog(client.instance, client.profile)).toEqual(saved);
});

test("topic and native field discovery preserve field metadata and use the selected model", () => {
  const model = modelRecord().id;
  const topics = fakeClient([
    { success: true, topics: [{ name: "events", base_view_name: "events" }] },
  ]);
  discover(topics.client, "topics", model, undefined, true);
  expect(topics.calls[0]!.args.slice(-3)).toEqual([
    "models",
    "list-topics",
    model,
  ]);
  expect(
    completionCandidates([
      "omni",
      "fields",
      "--profile",
      "fixture-profile",
      "--model",
      model,
      "--topic",
      "",
    ]),
  ).toEqual(["events"]);
  const fields = fakeClient([
    {
      success: true,
      topic: {
        name: "events",
        base_view_name: "events",
        relationships: [],
        views: [
          {
            name: "events",
            ide_file_name: "events.view",
            yaml_path: null,
            dimensions: [
              { field_name: "date", label: "Event date", sql: "${TABLE}.date" },
            ],
            measures: [{ field_name: "events.count", label: "Count" }],
            filter_only_fields: [],
          },
        ],
      },
    },
  ]);
  const result = discover(fields.client, "fields", model, "events", true);
  expect(result.entries).toEqual([
    {
      view: "events",
      kind: "dimensions",
      field_name: "date",
      label: "Event date",
      sql: "${TABLE}.date",
    },
    {
      view: "events",
      kind: "measures",
      field_name: "events.count",
      label: "Count",
    },
  ]);
  expect(
    readCatalog(fields.client.instance, fields.client.profile, model, "events")
      ?.names,
  ).toEqual(["events.date", "events.count"]);
  expect(() =>
    discover(fakeClient([]).client, "fields", model, "--token=secret"),
  ).toThrow("not a CLI option");
  expect(() => discover(fakeClient([]).client, "topics", "--base-url")).toThrow(
    "identifier",
  );
});

test("discovery rejects repeated pagination cursors and schema-invalid records", () => {
  expect(() =>
    discover(
      fakeClient([page([], "again"), page([], "again")]).client,
      "models",
    ),
  ).toThrow("repeated");
  expect(() =>
    discover(fakeClient([page([{ id: "missing-fields" }])]).client, "models"),
  ).toThrow("pinned schema");
});

test("provisioning validates the shared model, resolved permissions, folder visibility and inherited access", () => {
  const folder = "00000000-0000-4000-8000-000000000123";
  const permissions = {
    permits: [
      {
        role: "OWNER",
        accessBoost: false,
        userId: "00000000-0000-4000-8000-000000000001",
      },
    ],
  };
  const valid = fakeClient([
    page([modelRecord()]),
    identity(),
    page([folderRecord(folder)]),
    permissions,
  ]);
  checkModel(valid.client, modelRecord().id);
  expect(checkFolders(valid.client, [folder, folder])).toEqual([
    {
      id: folder,
      name: "Disposable",
      path: `/my/${folder}`,
      inheritedAccess: permissions,
    },
  ]);
  expect(valid.calls.every((call) => call.input === undefined)).toBe(true);
  expect(valid.calls[2]!.args).toContain("restricted");
  expect(() =>
    checkModel(
      fakeClient([page([{ ...modelRecord(), modelKind: "QUERY" }])]).client,
      modelRecord().id,
    ),
  ).toThrow("shared model");
  expect(() =>
    checkModel(
      fakeClient([page([modelRecord()]), { ...identity(), rolesByModel: {} }])
        .client,
      modelRecord().id,
    ),
  ).toThrow("permissions");
  expect(() =>
    checkFolders(fakeClient([page([]), page([])]).client, [folder]),
  ).toThrow("not visible");
  expect(() =>
    checkFolders(fakeClient([page([])]).client, ["slug-not-uuid"]),
  ).toThrow("UUID");
  const organization = fakeClient([
    page([]),
    page([folderRecord(folder)]),
    permissions,
  ]);
  expect(checkFolders(organization.client, [folder])).toHaveLength(1);
  expect(organization.calls[1]!.args).toContain("organization");
});

test("remote validation sends native queries with the base model and never claims actual results", () => {
  const value = definition();
  value.document.queryPresentations.data["1"] = {
    type: "query",
    query: query({ fields: ["events.count"] }),
  };
  const stream = [
    { jobs_submitted: { job: null } },
    { job_id: "job", status: "PLANNED" },
    { remaining_job_ids: [], timed_out: "false" },
  ];
  const { client, calls } = fakeClient([
    page([modelRecord()]),
    identity(),
    {
      status: 0,
      stderr: "",
      stdout: stream.map((v) => JSON.stringify(v)).join("\n"),
    },
  ]);
  expect(validateRemote(client, value)).toMatchObject({
    outcome: "REMOTE_VALIDATED",
    queryResultsVerified: false,
    queries: [{ key: "1", outcome: "PLAN_VALIDATED" }],
  });
  expect(JSON.parse(calls[2]!.input!)).toEqual({
    query: {
      ...(value.document.queryPresentations.data["1"]!.query as object),
      modelId: value.document.modelId,
    },
    planOnly: true,
  });
  for (const lines of [
    [{ job_id: "job", status: "ERROR", error_message: "private diagnostic" }],
    [{ job_id: "job", status: "PLANNED" }],
    [
      { job_id: "job", status: "COMPLETE" },
      { remaining_job_ids: [], timed_out: "false" },
    ],
    [{ remaining_job_ids: ["job"], timed_out: "true" }],
    [{ unknown: true }],
  ]) {
    const failed = fakeClient([
      page([modelRecord()]),
      identity(),
      {
        status: 0,
        stderr: "",
        stdout: lines.map((v) => JSON.stringify(v)).join("\n"),
      },
    ]);
    expect(() => validateRemote(failed.client, value)).toThrow();
  }
});
