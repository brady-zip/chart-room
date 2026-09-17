import { existsSync } from "node:fs";
import { readObject } from "../lib/files.js";
import { ChartRoomError } from "../lib/errors.js";
import { readDashboard } from "../lib/dashboard.js";
import {
  dashboardUrl,
  getDashboard,
  createDashboard,
  updateDashboard,
} from "../lib/datadog.js";
import { diffDashboards } from "../lib/diff.js";
import {
  validateDefinition,
  omniUrl,
  matchesDocument,
} from "./omni/definition.js";
import { OmniClient } from "./omni/client.js";
import { reconcile } from "./omni/sync.js";
import { validateDatadog } from "./datadog.js";

export type ProviderName = "datadog" | "omni";
export interface CommonOptions {
  provider?: ProviderName;
  profile?: string;
  format?: "human" | "json";
  json?: boolean;
  instance?: string;
}

export function selectProvider(
  file: string,
  explicit?: string,
  initializing = false,
): ProviderName {
  if (explicit && explicit !== "datadog" && explicit !== "omni")
    throw new ChartRoomError(
      "INVALID_PROVIDER",
      "Provider must be datadog or omni",
    );
  const suffix = file.endsWith(".omni.jsonc")
    ? "omni"
    : /\.dash\.jsonc?$/.test(file)
      ? "datadog"
      : undefined;
  const value = existsSync(file) ? readObject(file) : undefined;
  const envelope = value?.provider;
  if (envelope !== undefined && envelope !== "omni")
    throw new ChartRoomError(
      "PROVIDER_MISMATCH",
      "Unknown provider envelope; Datadog files use their existing format",
    );
  if (envelope === "omni" && (value!.version !== 1 || suffix !== "omni"))
    throw new ChartRoomError(
      "PROVIDER_MISMATCH",
      "Omni requires contract version 1 and the .omni.jsonc suffix",
    );
  if (value && suffix === "omni" && envelope !== "omni")
    throw new ChartRoomError(
      "PROVIDER_MISMATCH",
      "An .omni.jsonc file must contain the versioned Omni envelope",
    );
  if (value && explicit === "omni" && envelope !== "omni")
    throw new ChartRoomError(
      "PROVIDER_MISMATCH",
      "Cannot reinterpret an existing Datadog file as Omni",
    );
  const provider =
    envelope === "omni"
      ? "omni"
      : !value && initializing && explicit === "omni"
        ? "omni"
        : "datadog";
  if ((explicit && explicit !== provider) || (suffix && suffix !== provider))
    throw new ChartRoomError(
      "PROVIDER_MISMATCH",
      "Provider flag, filename and dashboard envelope conflict",
    );
  if (provider === "omni" && suffix !== "omni")
    throw new ChartRoomError(
      "PROVIDER_MISMATCH",
      "Use the .omni.jsonc extension for Omni",
    );
  return provider;
}

// Each arm retains its native payload. There is deliberately no universal widget model.
export const providers = {
  datadog: {
    kind: "datadog" as const,
    load: readDashboard,
    validate: validateDatadog,
    url: dashboardUrl,
    read: getDashboard,
    create: createDashboard,
    reconcile: updateDashboard,
    compare: diffDashboards,
  },
  omni: {
    kind: "omni" as const,
    load: (file: string, partial = false) =>
      validateDefinition(readObject(file), partial),
    validate: validateDefinition,
    url: omniUrl,
    client: (instance: string, profile?: string) =>
      new OmniClient(instance, profile),
    read: (client: OmniClient, id: string) => client.read(id),
    create: (client: OmniClient, body: Record<string, unknown>) =>
      client.documents("v2-create", [], body, true),
    reconcile,
    compare: matchesDocument,
  },
};
