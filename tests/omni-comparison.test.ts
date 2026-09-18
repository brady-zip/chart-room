import { expect, test } from "bun:test";
import defaults from "./fixtures/omni-readback-defaults.json";
import {
  definition,
  draft,
  fakeClient,
  policy,
  query,
  remote,
  written,
} from "./helpers.js";
import {
  drift,
  matchesDocument,
  validateDefinition,
  type NativeObject,
  type OmniDocument,
} from "../src/providers/omni/definition.js";
import { reconcile } from "../src/providers/omni/sync.js";

const filter = { type: "string", kind: "EQUALS", values: ["closed"] };
const queryDefinition = (filters: NativeObject = {}) => {
  const value = definition();
  value.document.queryPresentations.data["1"] = {
    type: "query",
    name: "Revenue",
    query: query({ fields: ["events.count"], filters }),
  };
  return value;
};
const observed = (desired: OmniDocument) =>
  remote(desired) as unknown as OmniDocument;
const tileQuery = (document: OmniDocument) =>
  document.queryPresentations.data["1"].query as NativeObject;

for (const [name, kept] of [
  ["the last filter", {}],
  [
    "one of several filters",
    { "events.region": { ...filter, values: ["west"] } },
  ],
] as const) {
  test(`removing ${name} reports drift, plans without writes, applies and then stays unchanged`, () => {
    const desired = validateDefinition(queryDefinition(kept)).document;
    const before = observed(desired);
    tileQuery(before).filters = { ...kept, "events.status": filter };
    expect(matchesDocument(before, desired)).toBe(false);
    expect(drift(before, desired)).toEqual(["queryPresentations"]);
    const dryRun = fakeClient([before, [], policy()]);
    expect(reconcile(dryRun.client, "pilot", desired, false)).toMatchObject({
      outcome: "WOULD_UPDATE",
      verified: false,
      differences: ["queryPresentations"],
    });
    expect(dryRun.calls.map((call) => call.args[7])).toEqual([
      "v2-get",
      "list-drafts",
      "get-permissions",
    ]);
    expect(dryRun.calls.every((call) => call.input === undefined)).toBe(true);
    const after = observed(desired);
    Object.assign(tileQuery(after), defaults.query);
    const applied = fakeClient([
      before,
      [],
      policy(),
      written(),
      written(),
      written(),
      written(),
      after,
      [draft()],
      written(),
      after,
      after,
      [],
    ]);
    expect(reconcile(applied.client, "pilot", desired, true)).toMatchObject({
      outcome: "UPDATED",
      verified: true,
      differences: ["queryPresentations"],
    });
    expect(
      JSON.parse(applied.calls[4].input!).queryPresentations.data["1"].query
        .filters,
    ).toEqual(kept);
    const callsBeforeRepeat = applied.calls.length;
    expect(reconcile(applied.client, "pilot", desired, true)).toMatchObject({
      outcome: "UNCHANGED",
      verified: true,
      differences: [],
      batches: [],
    });
    expect(
      applied.calls.slice(callsBeforeRepeat).map((call) => call.args[7]),
    ).toEqual(["v2-get", "list-drafts"]);
  });
  for (const stage of ["Draft", "Published"])
    test(`${stage} readback retaining ${name} fails verification`, () => {
      const desired = validateDefinition(queryDefinition(kept)).document;
      const before = observed(desired);
      tileQuery(before).filters = { ...kept, "events.status": filter };
      const fake = fakeClient([
        before,
        [],
        policy(),
        written(),
        written(),
        written(),
        written(),
        stage === "Draft" ? before : observed(desired),
        [draft()],
        written(),
        before,
      ]);
      expect(() => reconcile(fake.client, "pilot", desired, true)).toThrow(
        `${stage} readback differs from requested content`,
      );
      expect(
        fake.calls.filter((call) => call.args.includes("v2-publish-draft")),
      ).toHaveLength(stage === "Draft" ? 0 : 1);
    });
}

test("observed Omni defaults normalize without hiding authored values or new remote fields", () => {
  const desired = definition().document;
  const actual = observed(desired);
  // Sanitized default shapes from the retained 2026-09-17 acceptance readback.
  actual.queryPresentations.data["1"] = structuredClone(
    defaults.blankPresentation,
  );
  expect(matchesDocument(actual, desired)).toBe(true);
  expect(drift(actual, desired)).toEqual([]);
  const queryValue = queryDefinition();
  const withDefaults = observed(queryValue.document);
  Object.assign(tileQuery(withDefaults), defaults.query, {
    executableSQL: "select count(*) from events",
  });
  expect(matchesDocument(withDefaults, queryValue.document)).toBe(true);
  expect(drift(withDefaults, queryValue.document)).toEqual([]);
  tileQuery(withDefaults).limit = 10;
  expect(matchesDocument(withDefaults, queryValue.document)).toBe(false);
  tileQuery(withDefaults).limit = 1000;
  queryValue.document.queryPresentations.data["1"].automaticVis = false;
  withDefaults.queryPresentations.data["1"].automaticVis = true;
  expect(matchesDocument(withDefaults, queryValue.document)).toBe(false);
  actual.queryPresentations.data["1"].unknownSetting = {};
  expect(matchesDocument(actual, desired)).toBe(false);
  expect(drift(actual, desired)).toEqual(["queryPresentations"]);
});

test("blank-query defaults cannot hide remote filters or authored nulls", () => {
  const desired = definition().document;
  const actual = observed(desired);
  actual.queryPresentations.data["1"] = structuredClone(
    defaults.blankPresentation,
  );
  tileQuery(actual).filters = { "events.status": filter };
  expect(matchesDocument(actual, desired)).toBe(false);
  expect(drift(actual, desired)).toEqual(["queryPresentations"]);
  tileQuery(actual).filters = {};
  desired.queryPresentations.data["1"].query = null;
  expect(matchesDocument(actual, desired)).toBe(false);
});

test("known visualization and container defaults preserve explicit content and input objects", () => {
  const value = queryDefinition();
  const tile = value.document.queryPresentations.data["1"];
  delete tile.name;
  tile.visConfig = { chartType: "table", visConfig: { config: {} } };
  value.document.containers = [
    {
      containerType: "page",
      instanceKey: "page",
      container: { containerType: "stack", instanceKey: "empty", children: [] },
    },
  ];
  const desired = validateDefinition(value).document;
  const actual = observed(desired);
  actual.queryPresentations.data["1"].visConfig = {
    chartType: "table",
    fields: [],
    version: 0,
    visConfig: { config: {}, visType: null },
  };
  actual.containers[0].children = [];
  const before = structuredClone({ actual, desired });
  expect(matchesDocument(actual, desired)).toBe(true);
  expect(drift(actual, desired)).toEqual([]);
  expect({ actual, desired }).toEqual(before);
  actual.containers[0].children = [
    { type: "query", id: "1", instanceKey: "visible" },
  ];
  expect(drift(actual, desired)).toEqual(["containers"]);
});

const ownedMaps: [
  string,
  string,
  (document: OmniDocument, populated: boolean) => void,
][] = [
  ...[
    ["column_totals", { "events.count": { type: "aggregation" } }],
    ["row_totals", { "events.count": { type: "aggregation" } }],
    ["custom_summary_types", { "events.count": "SUM" }],
    ["join_via_map", { events: ["users"] }],
    ["metadata", { "events.count": { label: "Count" } }],
    ["filtersUsedInSql", { "events.status": filter }],
  ].map(
    ([key, entry]) =>
      [
        `query.${key}`,
        "queryPresentations",
        (d: OmniDocument, populated: boolean) => {
          tileQuery(d)[key as string] = populated ? entry : {};
        },
      ] as [string, string, (d: OmniDocument, populated: boolean) => void],
  ),
  [
    "resultConfig.columnWidths",
    "queryPresentations",
    (d, populated) => {
      d.queryPresentations.data["1"].resultConfig = {
        columnWidths: populated ? { count: 120 } : {},
      };
    },
  ],
  [
    "visConfig",
    "queryPresentations",
    (d, populated) => {
      d.queryPresentations.data["1"].visConfig = {
        chartType: "kpi",
        visConfig: {
          visType: "omni-kpi",
          config: populated ? { fontSize: 36 } : {},
        },
      };
    },
  ],
  [
    "controls.map",
    "controls",
    (d, populated) => {
      d.controls = {
        data: {
          status: { config: filter, map: populated ? { "1": false } : {} },
        },
        order: ["status"],
      };
    },
  ],
  [
    "settings.customText",
    "settings",
    (d, populated) => {
      d.settings.customText = populated ? { queryNoResults: "No rows" } : {};
    },
  ],
];
for (const [name, field, mutate] of ownedMaps)
  test(`removing authored ${name} entries is drift`, () => {
    const value = queryDefinition();
    mutate(value.document, false);
    const desired = validateDefinition(value).document;
    const retained = structuredClone(value);
    mutate(retained.document, true);
    const before = observed(validateDefinition(retained).document);
    expect(matchesDocument(before, desired)).toBe(false);
    expect(drift(before, desired)).toEqual([field]);
    expect(matchesDocument(observed(desired), desired)).toBe(true);
  });
