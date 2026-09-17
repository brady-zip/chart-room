import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../schema/omni-dashboard.schema.json" with { type: "json" };
import apiSchema from "../../../schema/omni-api.schema.json" with { type: "json" };
import { ChartRoomError, object } from "../../lib/errors.js";

export const INSTANCE = "https://zip.omniapp.co";
export const OMNI_SCHEMA_URL = schema.$id;
export const DOCUMENT_FIELDS = [
  "name",
  "description",
  "modelId",
  "queryPresentations",
  "controls",
  "settings",
  "containers",
] as const;
export type NativeObject = Record<string, unknown>;
export interface NativeCollection {
  data: Record<string, NativeObject>;
  order: string[];
}
export interface OmniDocument {
  name: string;
  description: string | null;
  modelId: string;
  queryPresentations: NativeCollection;
  controls: NativeCollection;
  settings: NativeObject;
  containers: NativeObject[];
}
export interface OmniDefinition {
  $schema?: string;
  version: 1;
  provider: "omni";
  instance: string;
  targets: { prod?: string; test?: string };
  _meta: { intent: string; audience: string; scope: string };
  document: OmniDocument;
}
export type Target = "prod" | "test";
export type RemoteDocument = OmniDocument & {
  workbookModelId: string;
  app?: unknown;
};
const ajv = new Ajv2020({
  strict: false,
  allErrors: false,
  validateFormats: true,
});
(addFormats as unknown as (ajv: Ajv2020) => void)(ajv);
ajv.addSchema(schema);
ajv.addSchema(apiSchema);
const validate = ajv.getSchema(schema.$id)!;
const partialSchema = structuredClone(schema);
partialSchema.properties.targets.required = [];
partialSchema.$id += ".provisioning";
const validatePartial = ajv.compile(partialSchema);

export function assertNative(name: string, value: unknown): void {
  const check = ajv.getSchema(`${apiSchema.$id}#/components/schemas/${name}`);
  if (!check || !check(value)) {
    const location = check?.errors?.[0]?.instancePath ?? "/";
    throw new ChartRoomError(
      "INVALID_RESPONSE",
      `Omni ${name} response does not match pinned schema at ${location}`,
    );
  }
}

export function identifier(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value))
    throw new ChartRoomError(
      "INVALID_ID",
      "Expected a nonempty Omni identifier",
    );
  return value;
}
export function omniUrl(instance: string, id: string): string {
  return `${instance}/dashboards/${identifier(id)}`;
}

export function validateDefinition(
  value: unknown,
  allowMissingTargets = false,
): OmniDefinition {
  const check = allowMissingTargets ? validatePartial : validate;
  if (!check(value)) {
    const error = check.errors?.[0];
    throw new ChartRoomError(
      "INVALID_DEFINITION",
      `Invalid Omni contract v1 at ${error?.instancePath || "/"}: ${error?.message ?? "invalid definition"}`,
    );
  }
  const definition = value as OmniDefinition;
  if (
    definition.targets.prod &&
    definition.targets.prod === definition.targets.test
  )
    throw new ChartRoomError(
      "DUPLICATE_TARGET",
      "Test and production identifiers must differ",
    );
  for (const name of ["queryPresentations", "controls"] as const) {
    const { data, order } = definition.document[name];
    if (
      order.length !== Object.keys(data).length ||
      new Set(order).size !== order.length ||
      order.some((key) => !Object.hasOwn(data, key))
    )
      throw new ChartRoomError(
        "INVALID_DEFINITION",
        `${name}.order must include every data key exactly once`,
      );
  }
  for (const tile of Object.values(
    definition.document.queryPresentations.data,
  )) {
    if (
      tile.type === "linked" &&
      (typeof tile.sourceQueryPresentationKey !== "string" ||
        !Object.hasOwn(
          definition.document.queryPresentations.data,
          tile.sourceQueryPresentationKey,
        ))
    )
      throw new ChartRoomError(
        "INVALID_DEFINITION",
        "Linked tile must reference an existing stable record key",
      );
  }
  return definition;
}

export function desiredDocument(
  definition: OmniDefinition,
  source: { path: string; sha: string; repo: string; dirty?: boolean },
  target: Target,
): OmniDocument {
  if (
    !/^[0-9a-f]{40}$/.test(source.sha) ||
    !/^[\w.-]+\/[\w.-]+$/.test(source.repo)
  )
    throw new ChartRoomError(
      "PROVENANCE",
      "Source provenance requires a full commit SHA and owner/repo",
    );
  const document = structuredClone(definition.document);
  const encodedPath = source.path
    .split("/")
    .map((p) =>
      encodeURIComponent(p).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join("/");
  const url = `https://github.com/${source.repo}/blob/${source.sha}/${encodedPath}`;
  let description = document.description ?? "";
  if (target === "test") {
    document.name = `[TEST] ${document.name}`;
    description = `TEST DASHBOARD. Production: ${omniUrl(definition.instance, identifier(definition.targets.prod))}\n\n${description}`;
  }
  // A dirty preview must not assert that the blob is its exact source.
  const provenance = source.dirty
    ? `Local working tree preview (uncommitted); base revision: ${url}`
    : `Source definition: ${url}`;
  document.description = `${description}\n\n${provenance}`.trim();
  if (document.description.length > 1024 || document.name.length > 254)
    throw new ChartRoomError(
      "PROVENANCE",
      "Name or description exceeds Omni limits after adding provenance",
    );
  return document;
}

export function assertTarget(
  current: OmniDocument & { app?: unknown },
  desired: OmniDocument,
): void {
  if (current.modelId !== desired.modelId)
    throw new ChartRoomError(
      "MODEL_MISMATCH",
      "Base model differs; deployment cannot rebase a document",
    );
  if (current.app !== undefined && current.app !== null)
    throw new ChartRoomError(
      "UNSUPPORTED_RESOURCE",
      "Refusing to overwrite an Omni app with a dashboard",
    );
}

export function patchBatches(
  desired: OmniDocument,
  current: OmniDocument & { app?: unknown },
): NativeObject[] {
  assertTarget(current, desired);
  const patch = structuredClone(desired) as unknown as NativeObject;
  const desiredTiles = desired.queryPresentations.data;
  const additions = Object.entries(desiredTiles);
  const removals = Object.keys(current.queryPresentations.data)
    .filter((k) => !Object.hasOwn(desiredTiles, k))
    .map((k) => [k, null]);
  patch.controls = {
    data: {
      ...Object.fromEntries(
        Object.keys(current.controls.data)
          .filter((k) => !Object.hasOwn(desired.controls.data, k))
          .map((k) => [k, null]),
      ),
      ...desired.controls.data,
    },
    order: desired.controls.order,
  };
  delete patch.queryPresentations;
  const batches: NativeObject[] = [];
  for (let i = 0; i < additions.length; i += 48)
    batches.push({
      queryPresentations: {
        data: Object.fromEntries(additions.slice(i, i + 48)),
      },
    });
  batches.push(patch);
  for (let i = 0; i < removals.length; i += 48)
    batches.push({
      queryPresentations: {
        data: Object.fromEntries(removals.slice(i, i + 48)),
      },
    });
  batches.push({
    queryPresentations: { order: desired.queryPresentations.order },
  });
  return batches;
}

export function containsDesired(actual: unknown, desired: unknown): boolean {
  if (Array.isArray(desired))
    return (
      Array.isArray(actual) &&
      actual.length === desired.length &&
      desired.every((v, i) => containsDesired(actual[i], v))
    );
  if (desired !== null && typeof desired === "object")
    return (
      actual !== null &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(desired).every(
        ([k, v]) =>
          Object.hasOwn(actual, k) &&
          containsDesired((actual as NativeObject)[k], v),
      )
    );
  return actual === desired;
}

export function matchesDocument(
  actual: OmniDocument,
  desired: OmniDocument,
): boolean {
  return (
    containsDesired(actual, desired) &&
    ["queryPresentations", "controls"].every((name) => {
      const a = actual[name as "controls"].data;
      const d = desired[name as "controls"].data;
      return (
        Object.keys(a).length === Object.keys(d).length &&
        Object.keys(d).every((k) => Object.hasOwn(a, k))
      );
    })
  );
}

export function drift(actual: OmniDocument, desired: OmniDocument): string[] {
  return DOCUMENT_FIELDS.filter(
    (key) =>
      !containsDesired(actual[key], desired[key]) ||
      ((key === "controls" || key === "queryPresentations") &&
        Object.keys(actual[key].data).length !==
          Object.keys(desired[key].data).length),
  );
}

export function adoptDocument(remote: unknown): OmniDocument {
  assertNative("DocumentsV2ReadResponse", remote);
  const data = object(remote, "document");
  if (data.app !== undefined && data.app !== null)
    throw new ChartRoomError(
      "UNSUPPORTED_RESOURCE",
      "Omni apps require a separate resource migration",
    );
  const unknown = Object.keys(data).filter(
    (key) => ![...DOCUMENT_FIELDS, "workbookModelId", "app"].includes(key),
  );
  if (unknown.length)
    throw new ChartRoomError(
      "UNSUPPORTED_RESOURCE",
      `Unrecognized remote resources: ${unknown.join(", ")}; import would lose content`,
    );
  const document = Object.fromEntries(
    DOCUMENT_FIELDS.map((key) => [key, structuredClone(data[key])]),
  ) as unknown as OmniDocument;
  for (const [key, tile] of Object.entries(document.queryPresentations.data)) {
    const query = object(tile.query ?? {}, "query");
    if (
      query.model_extension_id ||
      query.branch_id ||
      tile.foreignModelId ||
      !["blank", "query", "sql", "linked"].includes(String(tile.type))
    )
      throw new ChartRoomError(
        "UNSUPPORTED_RESOURCE",
        `Tile ${key} uses an unsupported resource or draft-bound query model. Keep this dashboard in Omni until dependent-resource migration is available; query-model IDs cannot be copied between documents.`,
      );
  }
  // Only our exact trailing provenance is removable. User descriptions stay intact.
  if (document.description)
    document.description = document.description.replace(
      /\n\nSource definition: https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/blob\/[0-9a-f]{40}\/[^\n]+$/,
      "",
    );
  return document;
}
