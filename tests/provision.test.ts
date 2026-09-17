import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import {
  definition,
  draft,
  fakeClient,
  policy,
  remote,
  written,
  page,
  modelRecord,
  identity,
  folderRecord,
} from "./helpers.js";
import {
  pendingProvision,
  provisionTarget,
  canonicalTarget,
} from "../src/providers/omni/provision.js";
import { readObject } from "../src/lib/files.js";
import { sourceFor } from "../src/lib/provenance.js";
import { assertUniqueTargets, initializeOmni } from "../src/commands/omni.js";
import type {
  NativeObject,
  OmniDocument,
} from "../src/providers/omni/definition.js";

let root: string;
let oldConfig: string | undefined;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "chart-room-provision-"));
  oldConfig = process.env.CHART_ROOM_CONFIG_DIR;
  process.env.CHART_ROOM_CONFIG_DIR = join(root, "config");
});
afterEach(() => {
  process.env.CHART_ROOM_CONFIG_DIR = oldConfig;
  rmSync(root, { recursive: true, force: true });
});

test("new-pair init validates locations before creating and saves prod before creating test", () => {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", "https://github.com/brady-zip/chart-room.git");
  git(
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "Fixture",
  );
  const file = join(root, "new pair.omni.jsonc");
  const prodFolder = "00000000-0000-4000-8000-000000000101";
  const testFolder = "00000000-0000-4000-8000-000000000102";
  let current: OmniDocument;
  const ids: string[] = [];
  const create = (_args: string[], input: string) => {
    const { identifier, folderId, ...document } = JSON.parse(input);
    expect(folderId).toBe(ids.length ? testFolder : prodFolder);
    if (ids.length) expect(readObject(file).targets).toEqual({ prod: ids[0] });
    ids.push(identifier);
    current = document;
    return written({ identifier });
  };
  const { client, calls } = fakeClient([
    page([modelRecord()]),
    identity(),
    page([folderRecord(prodFolder), folderRecord(testFolder)]),
    { permits: [{ role: "OWNER" }] },
    { permits: [{ role: "OWNER" }] },
    create,
    () => remote(current),
    create,
    () => remote(current),
  ]);
  const result = initializeOmni(
    file,
    { model: modelRecord().id, prodFolder, testFolder },
    undefined,
    client,
  );
  expect(result).toMatchObject({ outcome: "PROVISIONED", verified: true });
  expect(calls.slice(0, 5).every((call) => call.input === undefined)).toBe(
    true,
  );
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  expect(readObject(file).targets).toEqual({ prod: ids[0], test: ids[1] });
  expect(Object.keys(readObject(file))[0]).toBe("$schema");
  const again = fakeClient([]);
  expect(initializeOmni(file, {}, undefined, again.client)).toMatchObject({
    outcome: "ALREADY_LINKED",
    verified: false,
  });
  expect(again.calls).toEqual([]);
});

test("an empty create is rejected before reserving a server identifier", () => {
  const value = definition();
  value.document.queryPresentations = { data: {}, order: [] };
  const { client, calls } = fakeClient([]);
  expect(() =>
    provisionTarget(
      client,
      join(root, "empty.omni.jsonc"),
      value,
      "prod",
      "folder",
      value.document,
    ),
  ).toThrow("at least one workbook tab");
  expect(calls).toEqual([]);
});

test("a large initial definition publishes a small scaffold, saves its ID, then reconciles in bounded batches", () => {
  const file = join(root, "large.omni.jsonc");
  const value = definition();
  value.targets = {};
  value.document.queryPresentations = {
    data: Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [String(i + 1), { type: "blank" }]),
    ),
    order: Array.from({ length: 50 }, (_, i) => String(i + 1)),
  };
  writeFileSync(file, JSON.stringify(value));
  let bootstrap: OmniDocument;
  let id: string;
  const { client, calls } = fakeClient([
    (_args: string[], input: string) => {
      const body = JSON.parse(input);
      id = body.identifier;
      const { identifier: _, folderId: _folder, ...document } = body;
      bootstrap = document;
      return written({ identifier: id });
    },
    () => {
      expect(readObject(file).targets).toEqual({ prod: id });
      return remote(bootstrap);
    },
    () => remote(bootstrap),
    [],
    policy(),
    written(),
    written(),
    written(),
    written(),
    written(),
    remote(value.document),
    [draft()],
    written(),
    remote(value.document),
  ]);
  const result = provisionTarget(
    client,
    file,
    value,
    "prod",
    "folder",
    value.document,
  );
  expect(result.recovered).toBe(false);
  expect(JSON.parse(calls[0]!.input!).queryPresentations).toEqual({
    data: { "1": { type: "blank" } },
    order: ["1"],
  });
  const upserts = calls
    .filter((call) => call.args.includes("v2-patch-draft-by-identifier"))
    .map((call) => JSON.parse(call.input!))
    .filter((body) => body.queryPresentations?.data);
  expect(
    upserts.map((body) => Object.keys(body.queryPresentations.data).length),
  ).toEqual([48, 2]);
  expect(calls.filter((call) => call.args.includes("v2-create"))).toHaveLength(
    1,
  );
  expect(pendingProvision(file)).toEqual({});
  expect(
    JSON.parse(readFileSync(`${file}.provision.json`, "utf8")).targets.prod
      .completed,
  ).toBe(true);
});

test("failed create readback saves the ID and blocks a changed recovery intent before any remote call", () => {
  const file = join(root, "recover.omni.jsonc");
  const value = definition();
  value.targets = {};
  writeFileSync(file, JSON.stringify(value));
  const { client } = fakeClient([
    (_args: string[], input: string) =>
      written({ identifier: JSON.parse(input).identifier }),
    remote({ ...value.document, name: "wrong" }),
  ]);
  expect(() =>
    provisionTarget(client, file, value, "prod", "folder", value.document),
  ).toThrow("ID was saved");
  expect((readObject(file).targets as NativeObject).prod).toStartWith(
    "cr-prod-",
  );
  expect(pendingProvision(file)).toHaveProperty("prod");
  const changed = fakeClient([]);
  expect(() =>
    provisionTarget(changed.client, file, value, "prod", "folder", {
      ...value.document,
      name: "changed",
    }),
  ).toThrow("intent differs");
  expect(changed.calls).toEqual([]);
});

test("malformed success responses are ambiguous writes with durable recovery information", () => {
  const file = join(root, "bad.omni.jsonc");
  const value = definition();
  value.targets = {};
  writeFileSync(file, JSON.stringify(value));
  const { client } = fakeClient([{ identifier: "incomplete" }]);
  try {
    provisionTarget(client, file, value, "prod", "folder", value.document);
    throw new Error("must fail");
  } catch (error) {
    expect(error).toMatchObject({
      code: "INVALID_RESPONSE",
      details: { ambiguous: true, journalPath: `${file}.provision.json` },
    });
  }
  expect(readObject(file).targets).toEqual({});
});

test("production provenance requires the exact tracked definition, including ignored files", () => {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.name", "Fixture");
  git("config", "user.email", "fixture@example.invalid");
  git("remote", "add", "origin", "https://github.com/brady-zip/chart-room.git");
  writeFileSync(join(root, ".gitignore"), "ignored.omni.jsonc\n");
  const file = join(root, "pilot.omni.jsonc");
  writeFileSync(file, JSON.stringify(definition()));
  git("add", ".");
  git("commit", "-qm", "Fixture");
  expect(sourceFor(file, true).dirty).toBe(false);
  writeFileSync(file, readFileSync(file, "utf8") + "\n");
  expect(() => sourceFor(file, true)).toThrow("Commit this definition");
  expect(sourceFor(file).dirty).toBe(true);
  const ignored = join(root, "ignored.omni.jsonc");
  writeFileSync(ignored, "{}");
  expect(() => sourceFor(ignored, true)).toThrow("Commit this definition");
});

test("adopted UUID aliases resolve to stable identifiers and duplicate documents are rejected", () => {
  const value = definition();
  const published = remote(value.document);
  const records = page([
    {
      identifier: "canonical",
      name: value.document.name,
      connectionId: "connection",
      deleted: false,
      folder: null,
      hasDashboard: true,
      owner: { id: "owner", name: "Fixture" },
      scope: "restricted",
      type: "document",
      updatedAt: null,
      url: "https://zip.omniapp.co/dashboards/canonical",
    },
  ]);
  const { client, calls } = fakeClient([published, records, published]);
  expect(
    canonicalTarget(client, "00000000-0000-4000-8000-000000000123"),
  ).toEqual({ id: "canonical", remote: published });
  expect(calls.every((call) => call.input === undefined)).toBe(true);
  const file = join(root, "aliases.omni.jsonc");
  writeFileSync(file, JSON.stringify(value));
  const duplicates = fakeClient([published, published]);
  expect(() => assertUniqueTargets(file, value, duplicates.client)).toThrow(
    "same published Omni document",
  );
});
