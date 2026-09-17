import { expect, test } from "bun:test";
import {
  documentPage,
  folderPage,
  folderPermissions,
} from "../src/providers/omni/responses.js";
import { page } from "./helpers.js";

test("live document catalog adds only the omitted constant discriminator", () => {
  const row = {
    connectionId: "connection",
    deleted: false,
    folder: null,
    hasDashboard: true,
    identifier: "pilot",
    name: "Pilot",
    owner: { id: "owner", name: "Fixture" },
    scope: "restricted",
    updatedAt: "2026-09-17T00:00:00Z",
    url: "https://zip.omniapp.co/dashboards/pilot",
  };
  expect(documentPage(page([row])).records).toEqual([
    { ...row, type: "document" },
  ]);
  expect(() => documentPage(page([{ ...row, type: "folder" }]))).toThrow(
    "pinned schema",
  );
  expect(() => documentPage(page([{ ...row, owner: null }]))).toThrow(
    "pinned schema",
  );
});

test("live folder catalog owner object adapts without discarding access scope", () => {
  const row = {
    id: "00000000-0000-4000-8000-000000000101",
    name: "Disposable",
    owner: { id: "00000000-0000-4000-8000-000000000001", name: "Fixture" },
    scope: "restricted",
    path: "disposable",
    url: "https://zip.omniapp.co/f/disposable",
  };
  expect(folderPage(page([row])).records).toEqual([
    { ...row, ownerId: row.owner.id },
  ]);
  expect(() =>
    folderPage(page([{ ...row, owner: { name: "No ID" } }])),
  ).toThrow("pinned schema");
  expect(() => folderPage(page([{ ...row, scope: "unknown" }]))).toThrow(
    "owner/scope",
  );
});

test("live direct/inherited permission grants retain their source and AccessBoost state", () => {
  const direct = {
    id: "fixture-user",
    name: "Fixture",
    type: "user",
    isEmbed: false,
    direct: { role: "OWNER", accessBoost: false, isOwner: true },
  };
  const inherited = {
    id: "other-user",
    name: "Other",
    type: "user",
    isEmbed: false,
    folder: { role: "OWNER", accessBoost: false, isOwner: true },
    folderInfo: { id: "parent", name: "Engineering", path: "engineering" },
  };
  const response = { permits: [direct, inherited] };
  expect(folderPermissions(response)).toEqual(response);
  expect(() =>
    folderPermissions({ permits: [{ ...direct, direct: {} }] }),
  ).toThrow("grant");
  expect(() =>
    folderPermissions({ permits: [{ ...inherited, folderInfo: undefined }] }),
  ).toThrow("inherited folder");
  expect(() =>
    folderPermissions({
      permits: [
        { id: "missing-grant", name: "Fixture", type: "user", isEmbed: false },
      ],
    }),
  ).toThrow("no direct or inherited");
});
