import { existsSync, readFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { resolve } from "node:path";
import { atomicWrite, updateJsonc } from "../../lib/files.js";
import { ChartRoomError, object } from "../../lib/errors.js";
import {
  assertNative,
  identifier,
  matchesDocument,
  OMNI_SCHEMA_URL,
  validateDefinition,
  INSTANCE,
  type OmniDefinition,
  type OmniDocument,
  type Target,
} from "./definition.js";
import type { OmniClient } from "./client.js";
import { reconcile } from "./sync.js";
import { folderPermissions } from "./responses.js";

export function checkModel(client: OmniClient, model: string): void {
  const models = client.pages("models", "list", "ModelsListResponse", [
    "--model-id",
    model,
    "--explorable",
    "true",
  ]);
  if (
    !models.some(
      (row) =>
        row.id === model &&
        row.deletedAt === null &&
        ["SHARED", "SHARED_EXTENSION"].includes(String(row.modelKind)),
    )
  )
    throw new ChartRoomError(
      "MODEL_MISMATCH",
      "Selected model is not an accessible shared model allowed as a workbook base",
    );
  client.identity(model);
}

export function checkFolders(
  client: OmniClient,
  folders: string[],
): Record<string, unknown>[] {
  const ids = [...new Set(folders)];
  for (const id of ids) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new ChartRoomError(
        "INVALID_FOLDER",
        "Explicit folder UUIDs are required",
      );
  }
  // The API's default scope excludes personal folders. Resolve both scopes
  // explicitly so an approved personal location is not mistaken for absence.
  const records = client.pages("folders", "list", "FoldersListResponse", [
    "--scope",
    "restricted",
  ]);
  if (ids.some((id) => !records.some((row) => row.id === id)))
    records.push(
      ...client.pages("folders", "list", "FoldersListResponse", [
        "--scope",
        "organization",
      ]),
    );
  return ids.map((id) => {
    const folder = records.find((row) => row.id === id);
    if (!folder)
      throw new ChartRoomError(
        "NOT_FOUND",
        `Folder ${id} is not visible to this identity`,
      );
    const permissions = folderPermissions(
      client.call("folders", "get-permissions", [id]),
    );
    return {
      id,
      name: folder.name,
      path: folder.path,
      ...(folder.scope
        ? {
            scope: folder.scope,
            sharingUrl: `${client.instance}/f/${folder.path}/share`,
          }
        : {}),
      inheritedAccess: permissions,
    };
  });
}

interface Intent {
  identifier: string;
  folderId: string;
  document: OmniDocument;
  attempted: boolean;
  completed?: boolean;
}
interface Journal {
  version: 1;
  instance: string;
  model: string;
  targets: Partial<Record<Target, Intent>>;
}

function readJournal(path: string): Journal {
  try {
    const journal = object(
      JSON.parse(readFileSync(path, "utf8")),
      "creation journal",
    );
    if (
      journal.version !== 1 ||
      journal.instance !== INSTANCE ||
      typeof journal.model !== "string"
    )
      throw new Error();
    for (const [target, raw] of Object.entries(
      object(journal.targets, "creation targets"),
    )) {
      const intent = object(raw, "creation intent");
      if (
        !["prod", "test"].includes(target) ||
        typeof intent.folderId !== "string" ||
        typeof intent.attempted !== "boolean" ||
        (intent.completed !== undefined &&
          typeof intent.completed !== "boolean")
      )
        throw new Error();
      identifier(intent.identifier);
      const definition = validateDefinition(
        {
          version: 1,
          provider: "omni",
          instance: journal.instance,
          targets: {},
          _meta: {
            intent: "Creation recovery",
            audience: "Author",
            scope: "Existing model",
          },
          document: intent.document,
        },
        true,
      );
      if (definition.document.modelId !== journal.model) throw new Error();
    }
    return journal as unknown as Journal;
  } catch {
    throw new ChartRoomError(
      "RECOVERY_REQUIRED",
      `Creation journal ${path} is corrupt; inspect its intended identifiers before initializing`,
    );
  }
}

/** A durable create intent makes even a lost HTTP response recoverable by one unique ID. */
export function provisionTarget(
  client: OmniClient,
  file: string,
  definition: OmniDefinition,
  target: Target,
  folderId: string,
  desired: OmniDocument,
  retryCreate = false,
): { id: string; recovered: boolean } {
  if (!desired.queryPresentations.order.length)
    throw new ChartRoomError(
      "EMPTY_DOCUMENT",
      "Omni creation requires at least one workbook tab. Add a named blank tile before initializing",
    );
  const journalPath = `${resolve(file)}.provision.json`;
  let journal: Journal = {
    version: 1,
    instance: definition.instance,
    model: definition.document.modelId,
    targets: {},
  };
  if (existsSync(journalPath)) {
    journal = readJournal(journalPath);
    if (
      journal.instance !== definition.instance ||
      journal.model !== definition.document.modelId
    )
      throw new ChartRoomError(
        "RECOVERY_REQUIRED",
        "Creation journal conflicts with the file's instance/model",
      );
  }
  const saved = journal.targets[target];
  const intent = saved ?? {
    identifier: `cr-${target}-${randomUUID()}`,
    folderId,
    document: desired,
    attempted: false,
  };
  identifier(intent.identifier);
  if (
    intent.folderId !== folderId ||
    !matchesDocument(intent.document, desired) ||
    !matchesDocument(desired, intent.document)
  )
    throw new ChartRoomError(
      "RECOVERY_REQUIRED",
      "Creation intent differs from current content or folder. Restore the attempted definition, recover its ID, then edit with test/prod",
    );
  journal.targets[target] = intent;
  const saveJournal = () =>
    atomicWrite(journalPath, JSON.stringify(journal, null, 2) + "\n");
  saveJournal();
  const createDocument: OmniDocument =
    Object.keys(desired.queryPresentations.data).length <= 48
      ? desired
      : {
          ...desired,
          // Omni requires at least one workbook tab during creation. An empty
          // tab order can fail after allocating and archiving the identifier.
          queryPresentations: {
            data: {
              [desired.queryPresentations.order[0]!]:
                desired.queryPresentations.data[
                  desired.queryPresentations.order[0]!
                ]!,
            },
            order: [desired.queryPresentations.order[0]!],
          },
          controls: { data: {}, order: [] },
          containers: [
            {
              containerType: "stack",
              instanceKey: "chart-room-provisioning",
              children: [],
            },
          ],
        };
  const persistId = (id: string) => {
    definition.targets[target] = id;
    updateJsonc(file, [[["targets", target], id]], OMNI_SCHEMA_URL);
  };
  if (saved?.attempted) {
    try {
      const observed = client.read(intent.identifier);
      if (
        !matchesDocument(observed, intent.document) &&
        !matchesDocument(observed, createDocument)
      )
        throw new ChartRoomError(
          "RECOVERY_REQUIRED",
          `Existing intended target ${intent.identifier} differs in model/content; inspect it before linking`,
        );
      persistId(intent.identifier);
      if (!matchesDocument(observed, intent.document))
        reconcile(client, intent.identifier, intent.document, true);
      intent.completed = true;
      saveJournal();
      return { id: intent.identifier, recovered: true };
    } catch (error) {
      if (!(error instanceof ChartRoomError) || error.code !== "NOT_FOUND")
        throw error;
      if (!retryCreate)
        throw new ChartRoomError(
          "RECOVERY_REQUIRED",
          `Attempted create ${intent.identifier} is not visible. Inspect Omni, then explicitly rerun init with --retry-create to reuse this same unique identifier`,
          { target: intent.identifier, journalPath },
        );
    }
  }
  intent.attempted = true;
  saveJournal();
  try {
    const response = client.documents(
      "v2-create",
      [],
      { ...createDocument, identifier: intent.identifier, folderId },
      true,
    );
    assertNative("DocumentsV2CreateResponse", response);
    const created = identifier(object(response, "create response").identifier);
    if (created !== intent.identifier)
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        "Omni returned a different identifier than the durable create intent",
      );
    persistId(created);
    if (!matchesDocument(client.read(created), createDocument))
      throw new ChartRoomError(
        "VERIFICATION_FAILED",
        "Created document readback differs from requested content; the ID was saved",
      );
    if (createDocument !== desired)
      reconcile(client, created, intent.document, true);
    intent.completed = true;
    saveJournal();
    return { id: created, recovered: false };
  } catch (error) {
    if (error instanceof ChartRoomError)
      throw new ChartRoomError(
        error.code,
        `${error.message}. Recovery identifier: ${intent.identifier}; journal: ${journalPath}`,
        { ...error.details, target: intent.identifier, journalPath },
      );
    throw error;
  }
}

export function pendingProvision(
  file: string,
): Partial<Record<Target, { folderId: string; document: OmniDocument }>> {
  if (!existsSync(`${resolve(file)}.provision.json`)) return {};
  const journal = readJournal(`${resolve(file)}.provision.json`);
  return Object.fromEntries(
    Object.entries(journal.targets).filter(([, intent]) => !intent.completed),
  );
}

export function contentDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** V2 reads omit the identifier; resolve UUID aliases through the official catalog. */
export function canonicalTarget(client: OmniClient, input: string) {
  const remote = client.read(identifier(input));
  const records = client.pages("documents", "list", "DocumentsListResponse");
  const direct = records.find(
    (row) => row.identifier === input && row.deleted === false,
  );
  if (direct) return { id: identifier(direct.identifier), remote };
  const matching = records.filter(
    (row) => row.name === remote.name && row.deleted === false,
  );
  for (const row of matching) {
    const id = identifier(row.identifier);
    if (client.read(id).workbookModelId === remote.workbookModelId)
      return { id, remote };
  }
  throw new ChartRoomError(
    "ALIAS_UNRESOLVED",
    "Cannot resolve this target to its canonical catalog identifier; use an identifier from omni documents list",
  );
}
