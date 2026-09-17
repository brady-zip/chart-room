import { ChartRoomError, object } from "../../lib/errors.js";
import { assertNative, type NativeObject } from "./definition.js";

/** The live documents-only endpoint omits its schema's constant discriminator. */
export function documentPage(value: unknown): NativeObject {
  const page = object(value, "document page");
  if (!Array.isArray(page.records))
    throw new ChartRoomError(
      "INVALID_RESPONSE",
      "Document page records must be an array",
    );
  const records = page.records.map((raw) => {
    const record = object(raw, "document");
    return record.type === undefined ? { ...record, type: "document" } : record;
  });
  const normalized = { ...page, records };
  assertNative("DocumentsListResponse", normalized);
  return normalized;
}

/** Observed on Zip 2026-09-17. Preserve the pinned schema; adapt only known wire differences. */
export function folderPage(value: unknown): NativeObject {
  const page = object(value, "folder page");
  if (!Array.isArray(page.records))
    throw new ChartRoomError(
      "INVALID_RESPONSE",
      "Folder page records must be an array",
    );
  const records = page.records.map((raw) => {
    const record = object(raw, "folder");
    if (record.ownerId !== undefined) return record;
    const owner = object(record.owner, "folder owner");
    if (
      typeof owner.name !== "string" ||
      !["restricted", "organization"].includes(String(record.scope))
    )
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        "Folder owner/scope does not match the observed API shape",
      );
    return { ...record, ownerId: owner.id };
  });
  const normalized = { ...page, records };
  assertNative("FoldersListResponse", normalized);
  return normalized;
}

export function folderPermissions(value: unknown): NativeObject {
  const response = object(value, "folder permissions");
  if (!Array.isArray(response.permits))
    throw new ChartRoomError(
      "INVALID_RESPONSE",
      "Folder permissions must contain permits",
    );
  for (const raw of response.permits) {
    const permit = object(raw, "folder permit");
    if (permit.role !== undefined) {
      assertNative("FoldersGetPermissionsResponse", { permits: [permit] });
      continue;
    }
    if (
      !["id", "name", "type"].every(
        (key) => typeof permit[key] === "string" && permit[key],
      ) ||
      typeof permit.isEmbed !== "boolean"
    )
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        "Folder permit identity does not match the observed API shape",
      );
    const grants = ["direct", "folder"].filter(
      (key) => permit[key] !== undefined,
    );
    if (!grants.length)
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        "Folder permit has no direct or inherited grant",
      );
    for (const key of grants) {
      const grant = object(permit[key], "folder grant");
      if (
        typeof grant.role !== "string" ||
        !grant.role ||
        typeof grant.accessBoost !== "boolean" ||
        typeof grant.isOwner !== "boolean"
      )
        throw new ChartRoomError(
          "INVALID_RESPONSE",
          "Invalid direct/inherited folder grant",
        );
    }
    if (permit.folder !== undefined) {
      const source = object(permit.folderInfo, "inherited folder");
      if (
        !["id", "name", "path"].every(
          (key) => typeof source[key] === "string" && source[key],
        )
      )
        throw new ChartRoomError(
          "INVALID_RESPONSE",
          "Inherited folder grant is missing its source",
        );
    }
  }
  return response;
}
