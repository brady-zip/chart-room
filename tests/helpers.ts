import base from "./fixtures/definition.json";
import type {
  OmniDefinition,
  OmniDocument,
  NativeObject,
} from "../src/providers/omni/definition.js";
import {
  OmniClient,
  type Runner,
  type RunResult,
} from "../src/providers/omni/client.js";

export const definition = () => structuredClone(base) as OmniDefinition;
export const success = (value: unknown): RunResult => ({
  status: 0,
  stdout: JSON.stringify(value),
  stderr: "",
});
export const query = (overrides: NativeObject = {}) => ({
  calculations: [],
  column_totals: {},
  fields: [],
  fill_fields: [],
  filters: {},
  pivots: [],
  row_totals: {},
  sorts: [],
  table: "events",
  userEditedSQL: "",
  ...overrides,
});
export function remote(document: OmniDocument): NativeObject {
  const result = structuredClone(document);
  for (const [key, tile] of Object.entries(result.queryPresentations.data)) {
    result.queryPresentations.data[key] = {
      aiConfig: null,
      automaticVis: null,
      description: null,
      filterOrder: [],
      isSql: null,
      name: `Tile ${key}`,
      prefersChart: false,
      query: null,
      resultConfig: {},
      subTitle: null,
      topicName: null,
      visConfig: null,
      sourceQueryPresentationKey: null,
      ...tile,
    };
  }
  return { ...result, workbookModelId: "00000000-0000-4000-8000-000000000099" };
}
export function draft(overrides: NativeObject = {}): NativeObject {
  return {
    branch: null,
    createdAt: "2026-09-17T00:00:00Z",
    createdBy: { name: "Fixture" },
    lastEditedBy: { name: "Fixture" },
    draftOutOfDate: false,
    identifier: "draft-1",
    publishedIdentifier: "ci-pilot",
    status: "active",
    updatedAt: "2026-09-17T00:00:00Z",
    workbookModelId: "00000000-0000-4000-8000-000000000099",
    ...overrides,
  };
}
export const policy = (requires = false) => ({
  abilities: {
    canAnalyze: true,
    canDownload: true,
    canDrill: true,
    canDuplicate: true,
    canRequestAccess: true,
    canSaveSpreadsheets: true,
    canSchedule: true,
    canUpload: true,
    canUseDashboardAi: true,
    canUseTimezoneOverride: true,
    canViewWorkbook: true,
    requirePullRequestToPublish: requires,
  },
});
export const written = (overrides: NativeObject = {}) => ({
  identifier: "ci-pilot",
  draftIdentifier: "draft-1",
  name: "Pilot",
  description: "",
  ...overrides,
});
export function fakeClient(responses: (RunResult | unknown)[]) {
  const calls: { args: string[]; input?: string; interactive?: boolean }[] = [];
  const runner: Runner = (_exe, args, input, interactive) => {
    if (args[0] === "--version")
      return { status: 0, stdout: "omni version 1.3.1\n", stderr: "" };
    if (args[0] === "documents" && args[1] === "--help")
      return {
        status: 0,
        stderr: "",
        stdout:
          "v2-create v2-get list-drafts v2-patch-draft v2-patch-draft-by-identifier v2-get-draft v2-publish-draft",
      };
    calls.push({ args, input, interactive });
    if (!responses.length)
      throw new Error(`Unexpected test transport call: ${args.join(" ")}`);
    const queued = responses.shift();
    const next = typeof queued === "function" ? queued(args, input) : queued;
    return next && typeof next === "object" && Object.hasOwn(next, "stdout")
      ? (next as RunResult)
      : success(next);
  };
  return {
    client: new OmniClient(undefined, "fixture-profile", runner, () => {}),
    calls,
  };
}

export const page = (
  records: NativeObject[],
  nextCursor: string | null = null,
) => ({
  records,
  pageInfo: {
    hasNextPage: Boolean(nextCursor),
    nextCursor,
    pageSize: 100,
    totalRecords: records.length,
  },
});
export const modelRecord = (id = definition().document.modelId) => ({
  id,
  name: "Default Model",
  modelKind: "SHARED",
  baseModelId: null,
  connectionId: null,
  deletedAt: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
});
export const identity = (model = definition().document.modelId) => ({
  keyScope: "user",
  orgRole: "MEMBER",
  user: { id: "fixture-user", membershipId: "fixture-membership" },
  rolesByModel: {
    [model]: {
      baseRole: "QUERIER",
      roleName: "QUERIER",
      connectionId: "connection",
      permissions: ["QUERY_TOPICS", "QUERY_SQL", "USE_WORKBOOKS"],
    },
  },
});
export const folderRecord = (id: string) => ({
  id,
  name: "Disposable",
  ownerId: "00000000-0000-4000-8000-000000000001",
  path: `/my/${id}`,
  url: `https://zip.omniapp.co/f/${id}`,
});
