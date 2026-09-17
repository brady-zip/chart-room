import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { addToCache, scanDashboards } from "../lib/cache.js";
import { readObject, updateJsonc } from "../lib/files.js";
import { ChartRoomError, asError } from "../lib/errors.js";
import { sourceFor } from "../lib/provenance.js";
import { lastVerification, recordVerification } from "../lib/verification.js";
import {
  providers,
  selectProvider,
  type CommonOptions,
} from "../providers/index.js";
import { OmniClient } from "../providers/omni/client.js";
import {
  adoptDocument,
  assertTarget,
  desiredDocument,
  drift,
  identifier,
  INSTANCE,
  matchesDocument,
  OMNI_SCHEMA_URL,
  omniUrl,
  validateDefinition,
  type OmniDefinition,
  type Target,
} from "../providers/omni/definition.js";
import {
  canonicalTarget,
  checkFolders,
  checkModel,
  provisionTarget,
  pendingProvision,
} from "../providers/omni/provision.js";
import { validateRemote } from "../providers/omni/discovery.js";

export interface FileOptions extends CommonOptions {
  model?: string;
  prodFolder?: string;
  testFolder?: string;
  test?: boolean;
  dryRun?: boolean;
  remote?: boolean;
  retryCreate?: boolean;
}
export function output(result: unknown, options: CommonOptions = {}): void {
  if (options.format === "json" || options.json)
    console.log(JSON.stringify(result));
  else if (typeof result === "string") console.log(result);
  else console.log(JSON.stringify(result, null, 2));
}
function cache(file: string, definition: OmniDefinition): void {
  addToCache({
    path: resolve(file),
    provider: "omni",
    instance: definition.instance,
    title: definition.document.name,
    prodId: definition.targets.prod,
    testId: definition.targets.test,
  });
}
export function newOmniDefinition(
  file: string,
  model: string,
  instance = INSTANCE,
): OmniDefinition {
  return {
    version: 1,
    provider: "omni",
    instance,
    targets: {},
    _meta: {
      intent: "Describe the questions this dashboard answers",
      audience: "Describe its intended audience",
      scope: "Describe the existing shared model and data",
    },
    document: {
      name: basename(file, ".omni.jsonc").replace(/[-_]/g, " "),
      description: "",
      modelId: model,
      queryPresentations: {
        data: { "1": { type: "blank", name: "Notes" } },
        order: ["1"],
      },
      controls: { data: {}, order: [] },
      settings: {
        crossfilterEnabled: false,
        customText: null,
        facetFilters: true,
        refreshInterval: null,
        runQueriesOn: "current-page",
      },
      containers: [
        {
          containerType: "page",
          instanceKey: "page",
          name: "Dashboard",
          container: {
            containerType: "stack",
            instanceKey: "root",
            children: [],
          },
        },
      ],
    },
  };
}

export function assertUniqueTargets(
  file: string,
  definition: OmniDefinition,
  client?: OmniClient,
): void {
  const inventory = scanDashboards(dirname(resolve(file))).filter(
    (row) =>
      row.provider === "omni" &&
      row.instance === definition.instance &&
      row.path !== resolve(file),
  );
  const entries = [
    ...inventory.flatMap((row) =>
      [row.prodId, row.testId]
        .filter((id): id is string => Boolean(id))
        .map((id) => ({ file: row.path, id })),
    ),
    ...Object.values(definition.targets).map((id) => ({
      file: resolve(file),
      id: identifier(id),
    })),
  ];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.id))
      throw new ChartRoomError(
        "DUPLICATE_TARGET",
        `Omni target ${entry.id} is linked more than once in this repository`,
      );
    seen.add(entry.id);
  }
  if (client) {
    const identities = new Set<string>();
    for (const entry of entries) {
      const identity = client.read(entry.id).workbookModelId;
      if (identities.has(identity))
        throw new ChartRoomError(
          "DUPLICATE_TARGET",
          "Different target aliases refer to the same published Omni document",
        );
      identities.add(identity);
    }
  }
}

export function initializeOmni(
  file: string,
  options: FileOptions,
  existing?: OmniDefinition,
  suppliedClient?: OmniClient,
): unknown {
  let definition =
    existing ||
    (existsSync(file) ? validateDefinition(readObject(file), true) : undefined);
  if (!definition) {
    if (!options.model)
      throw new ChartRoomError(
        "MISSING_OPTION",
        "New Omni dashboards require --model, --prod-folder, and --test-folder",
      );
    definition = newOmniDefinition(file, options.model, options.instance);
  }
  validateDefinition(definition, true);
  if (options.model && options.model !== definition.document.modelId)
    throw new ChartRoomError(
      "MODEL_MISMATCH",
      "--model conflicts with the file's immutable base model",
    );
  if (options.instance && options.instance !== definition.instance)
    throw new ChartRoomError(
      "WRONG_INSTANCE",
      "--instance conflicts with the dashboard file",
    );
  assertUniqueTargets(file, definition);
  const pending = pendingProvision(file);
  if (
    definition.targets.prod &&
    definition.targets.test &&
    !Object.keys(pending).length
  )
    return {
      provider: "omni",
      outcome: "ALREADY_LINKED",
      targets: definition.targets,
      verified: false,
    };
  options = {
    ...options,
    prodFolder: options.prodFolder || pending.prod?.folderId,
    testFolder: options.testFolder || pending.test?.folderId,
  };
  if (
    (!definition.targets.prod && !options.prodFolder) ||
    (!definition.targets.test && !options.testFolder)
  )
    throw new ChartRoomError(
      "MISSING_OPTION",
      "Explicit --prod-folder and --test-folder are required for each missing target",
    );
  const client =
    suppliedClient || new OmniClient(definition.instance, options.profile);
  checkModel(client, definition.document.modelId);
  const folders = checkFolders(
    client,
    [
      !definition.targets.prod || pending.prod
        ? options.prodFolder!
        : undefined,
      !definition.targets.test || pending.test
        ? options.testFolder!
        : undefined,
    ].filter((v): v is string => Boolean(v)),
  );
  console.error(
    JSON.stringify(
      {
        provisioning:
          "Creation publishes immediately; targets inherit their folder access",
        folders,
      },
      null,
      2,
    ),
  );
  assertUniqueTargets(file, definition, client);
  if (!existsSync(file))
    updateJsonc(
      file,
      Object.entries(definition).map(([k, v]) => [[k], v]),
      OMNI_SCHEMA_URL,
    );
  const created = [];
  for (const target of ["prod", "test"] as const) {
    if (definition.targets[target] && !pending[target]) continue;
    const desired = desiredDocument(definition, sourceFor(file), target);
    const result = provisionTarget(
      client,
      file,
      definition,
      target,
      target === "prod" ? options.prodFolder! : options.testFolder!,
      desired,
      options.retryCreate,
    );
    cache(file, definition);
    created.push({
      target,
      ...result,
      url: omniUrl(definition.instance, result.id),
    });
  }
  validateDefinition(definition);
  cache(file, definition);
  for (const result of created)
    recordVerification(file, "omni", result.target, {
      outcome: result.recovered ? "RECOVERED" : "CREATED",
      verified: true,
      id: result.id,
      url: result.url,
    });
  return {
    provider: "omni",
    outcome: "PROVISIONED",
    created,
    targets: definition.targets,
    verified: true,
  };
}

export function linkOmni(
  file: string,
  id: string,
  options: FileOptions,
): unknown {
  const definition = validateDefinition(readObject(file), true);
  const client = new OmniClient(definition.instance, options.profile);
  const canonical = canonicalTarget(client, id);
  assertTarget(canonical.remote, definition.document);
  const target = options.test ? "test" : "prod";
  definition.targets[target] = canonical.id;
  validateDefinition(definition, true);
  assertUniqueTargets(file, definition, client);
  updateJsonc(file, [[["targets", target], canonical.id]], OMNI_SCHEMA_URL);
  cache(file, definition);
  return {
    provider: "omni",
    outcome: "LINKED",
    target,
    id: canonical.id,
    url: omniUrl(definition.instance, canonical.id),
    verified: false,
  };
}

export function importOmni(
  id: string,
  file: string,
  options: FileOptions,
): unknown {
  selectProvider(file, options.provider, true);
  if (options.provider !== "omni" || !file.endsWith(".omni.jsonc"))
    throw new ChartRoomError(
      "PROVIDER_MISMATCH",
      "Import requires --provider omni and a new .omni.jsonc path",
    );
  if (existsSync(file))
    throw new ChartRoomError(
      "FILE_EXISTS",
      "Import destination already exists; use link to adopt an existing target",
    );
  if (!options.testFolder)
    throw new ChartRoomError(
      "MISSING_OPTION",
      "Import requires --test-folder for its separate preview target",
    );
  const client = new OmniClient(options.instance || INSTANCE, options.profile);
  const canonical = canonicalTarget(client, id);
  const document = adoptDocument(canonical.remote);
  const definition = newOmniDefinition(file, document.modelId, client.instance);
  definition.document = document;
  definition.targets.prod = canonical.id;
  validateDefinition(definition, true);
  checkModel(client, document.modelId);
  checkFolders(client, [options.testFolder]);
  if (client.mainDrafts(canonical.id).length)
    throw new ChartRoomError(
      "DRAFT_CONFLICT",
      "Reconcile the existing production main draft before adoption",
    );
  assertUniqueTargets(file, definition, client);
  updateJsonc(
    file,
    Object.entries(definition).map(([k, v]) => [[k], v]),
    OMNI_SCHEMA_URL,
  );
  return initializeOmni(file, options, definition, client);
}

export function omniFileAction(
  command: string,
  file: string,
  options: FileOptions,
  id?: string,
): boolean {
  if (selectProvider(file, options.provider, command === "init") !== "omni")
    return false;
  if (
    existsSync(file) &&
    options.instance &&
    options.instance !== readObject(file).instance
  )
    throw new ChartRoomError(
      "WRONG_INSTANCE",
      "--instance conflicts with the dashboard file",
    );
  if (command === "init") {
    output(initializeOmni(file, options), options);
    return true;
  }
  if (command === "link") {
    output(linkOmni(file, identifier(id), options), options);
    return true;
  }
  const definition = providers.omni.load(file, command === "status");
  if (options.instance && options.instance !== definition.instance)
    throw new ChartRoomError(
      "WRONG_INSTANCE",
      "--instance conflicts with the file",
    );
  assertUniqueTargets(file, definition);
  if (command === "validate" && !options.remote) {
    output(
      {
        provider: "omni",
        outcome: "VALIDATED",
        contractVersion: 1,
        remote: false,
      },
      options,
    );
    return true;
  }
  const client = new OmniClient(definition.instance, options.profile);
  if (command === "validate") {
    output(validateRemote(client, definition), options);
    return true;
  }
  if (command === "status") {
    const states: Record<string, unknown> = {};
    for (const target of ["test", "prod"] as const) {
      const targetId = definition.targets[target];
      if (!targetId) {
        states[target] = { outcome: "NOT_LINKED" };
        continue;
      }
      try {
        const remote = client.read(targetId);
        assertTarget(remote, definition.document);
        const desired = desiredDocument(definition, sourceFor(file), target);
        const drafts = client.mainDrafts(targetId);
        states[target] = {
          id: targetId,
          url: omniUrl(definition.instance, targetId),
          outcome: matchesDocument(remote, desired) ? "IN_SYNC" : "DRIFT",
          differences: drift(remote, desired),
          ...client.publicationPolicy(targetId),
          draftConflicts: drafts.map((d) => ({
            identifier: d.identifier,
            outOfDate: d.draftOutOfDate,
          })),
          lastVerification: lastVerification(file, "omni", target),
        };
      } catch (error) {
        const failure = asError(error);
        states[target] = {
          id: targetId,
          outcome: failure.code === "NOT_FOUND" ? "NOT_FOUND" : "FAILED",
          error: failure.toJSON(),
        };
        process.exitCode = 1;
      }
    }
    output({ provider: "omni", file, targets: states }, options);
    return true;
  }
  if (command === "test" || command === "prod") {
    const target: Target = command;
    const targetId = identifier(definition.targets[target]);
    const desired = desiredDocument(
      definition,
      sourceFor(file, target === "prod" && !options.dryRun),
      target,
    );
    assertUniqueTargets(file, definition, client);
    try {
      const result = providers.omni.reconcile(
        client,
        targetId,
        desired,
        !options.dryRun,
      );
      const summary = {
        ...result,
        provider: "omni",
        target,
        id: targetId,
        url: omniUrl(definition.instance, targetId),
      };
      if (!options.dryRun)
        recordVerification(file, "omni", target, {
          outcome: result.outcome,
          verified: result.verified,
          id: targetId,
          url: summary.url,
        });
      output(summary, options);
    } catch (error) {
      if (!options.dryRun)
        recordVerification(file, "omni", target, {
          outcome: "FAILED",
          verified: false,
          id: targetId,
          error: asError(error).toJSON(),
        });
      throw error;
    }
    return true;
  }
  throw new ChartRoomError(
    "UNSUPPORTED_COMMAND",
    `Omni does not implement ${command}`,
  );
}
