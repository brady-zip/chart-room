import { join } from "node:path";
import { readFileSync } from "node:fs";
import { getConfigDir, repositoryRoot } from "../../lib/cache.js";
import { atomicWrite } from "../../lib/files.js";
import { ChartRoomError, object } from "../../lib/errors.js";
import {
  assertNative,
  identifier,
  type OmniDefinition,
  type NativeObject,
} from "./definition.js";
import { contentDigest, checkModel } from "./provision.js";
import type { OmniClient } from "./client.js";

function catalogPath(
  instance: string,
  profile: string | undefined,
  model?: string,
  topic?: string,
): string {
  return join(
    getConfigDir(),
    "catalog",
    `${contentDigest([repositoryRoot(), "omni", instance, profile || "default", model, topic])}.json`,
  );
}
export function readCatalog(
  instance: string,
  profile?: string,
  model?: string,
  topic?: string,
): { names: string[]; refreshedAt: string } | null {
  try {
    const catalog = JSON.parse(
      readFileSync(catalogPath(instance, profile, model, topic), "utf8"),
    );
    if (
      !catalog ||
      !Array.isArray(catalog.names) ||
      !catalog.names.every((v: unknown) => typeof v === "string") ||
      typeof catalog.refreshedAt !== "string"
    )
      return null;
    return catalog;
  } catch {
    return null;
  }
}
export function discover(
  client: OmniClient,
  command: "models" | "topics" | "fields",
  model?: string,
  topic?: string,
  refresh = false,
): NativeObject {
  if (model) identifier(model);
  if (
    topic &&
    (topic.startsWith("-") || /[\r\n]/.test(topic) || topic.includes("\0"))
  )
    throw new ChartRoomError(
      "INVALID_TOPIC",
      "Expected an Omni topic name, not a CLI option",
    );
  let entries: unknown[];
  let names: string[];
  if (command === "models") {
    entries = client.pages("models", "list", "ModelsListResponse", [
      "--explorable",
      "true",
    ]);
    names = (entries as NativeObject[]).map((e) => String(e.id));
  } else if (command === "topics") {
    if (!model)
      throw new ChartRoomError("MISSING_OPTION", "topics requires --model");
    const response = client.call("models", "list-topics", [model]);
    assertNative("ModelsListTopicsResponse", response);
    const value = object(response, "topics");
    if (value.success !== true)
      throw new ChartRoomError(
        "DISCOVERY_FAILED",
        "Omni topic discovery did not succeed",
      );
    entries = value.topics as unknown[];
    names = entries.map((e) => String(object(e, "topic").name));
  } else {
    if (!model || !topic)
      throw new ChartRoomError(
        "MISSING_OPTION",
        "fields requires --model and --topic",
      );
    const response = client.call("models", "get-topic", [model, topic]);
    assertNative("ModelsGetTopicResponse", response);
    const value = object(response, "topic response");
    if (value.success !== true)
      throw new ChartRoomError(
        "DISCOVERY_FAILED",
        "Omni field discovery did not succeed",
      );
    const views = object(value.topic, "topic").views as NativeObject[];
    entries = views.flatMap((view) =>
      ["dimensions", "measures", "filter_only_fields"].flatMap((kind) =>
        (view[kind] as NativeObject[]).map((field) => ({
          view: view.name,
          kind,
          ...field,
        })),
      ),
    );
    names = (entries as NativeObject[]).map((e) =>
      String(e.field_name).includes(".")
        ? String(e.field_name)
        : `${e.view}.${e.field_name}`,
    );
  }
  const refreshedAt = new Date().toISOString();
  if (refresh)
    atomicWrite(
      catalogPath(client.instance, client.profile, model, topic),
      JSON.stringify({ names, refreshedAt }) + "\n",
    );
  return {
    provider: "omni",
    command,
    entries,
    ...(refresh ? { cached: true, refreshedAt } : {}),
  };
}

export function validateRemote(
  client: OmniClient,
  definition: OmniDefinition,
): NativeObject {
  checkModel(client, definition.document.modelId);
  const queries: NativeObject[] = [];
  for (const [key, tile] of Object.entries(
    definition.document.queryPresentations.data,
  )) {
    if (tile.type !== "query" && tile.type !== "sql") continue;
    if (!tile.query)
      throw new ChartRoomError(
        "QUERY_FAILED",
        `Tile ${key} has no query to validate`,
      );
    const stream = client.call(
      "query",
      "run",
      [],
      {
        query: {
          ...object(tile.query, "query"),
          modelId: definition.document.modelId,
        },
        planOnly: true,
      },
      { stream: true },
    ) as unknown[];
    let complete = 0;
    let footer = false;
    for (const raw of stream) {
      const line = object(raw, "query stream");
      if (Object.hasOwn(line, "job_id")) {
        assertNative("QueryStreamJobLine", line);
        if (line.status !== "PLANNED" || line.error || line.error_message)
          throw new ChartRoomError(
            "QUERY_FAILED",
            `Tile ${key} failed remote model/field/query validation`,
          );
        complete++;
      } else if (Object.hasOwn(line, "remaining_job_ids")) {
        assertNative("QueryStreamFooterLine", line);
        if (
          line.timed_out !== "false" ||
          (line.remaining_job_ids as unknown[]).length
        )
          throw new ChartRoomError(
            "QUERY_TIMEOUT",
            `Tile ${key} query validation is incomplete; retry validation explicitly`,
          );
        footer = true;
      } else if (Object.hasOwn(line, "jobs_submitted"))
        assertNative("QueryStreamJobsSubmittedLine", line);
      else
        throw new ChartRoomError(
          "INVALID_RESPONSE",
          "Unrecognized query stream record",
        );
    }
    if (!complete || !footer)
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        "Omni query plan stream did not include successful completion and a footer",
      );
    queries.push({ key, outcome: "PLAN_VALIDATED" });
  }
  return {
    outcome: "REMOTE_VALIDATED",
    model: definition.document.modelId,
    queries,
    queryResultsVerified: false,
  };
}
