import * as fs from "node:fs";
import * as path from "node:path";
import { homedir } from "node:os";
import { readObject, atomicWrite } from "./files.js";
import { ChartRoomError } from "./errors.js";

export interface CacheEntry {
  path: string;
  title: string;
  provider?: "datadog" | "omni";
  repository?: string;
  instance?: string;
  prodId?: string;
  testId?: string;
  lastScanned: string;
}
export interface Cache {
  version: number;
  entries: CacheEntry[];
}
export function getConfigDir(): string {
  return (
    process.env.CHART_ROOM_CONFIG_DIR ||
    path.join(homedir(), ".config", "chart-room")
  );
}
export function getCachePath(): string {
  return path.join(getConfigDir(), "cache.json");
}
export function findProjectRoot(dir: string): string | null {
  let current = path.resolve(dir);
  let packageRoot: string | null = null;
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    if (!packageRoot && fs.existsSync(path.join(current, "package.json")))
      packageRoot = current;
    const parent = path.dirname(current);
    if (parent === current) return packageRoot;
    current = parent;
  }
}
export function repositoryRoot(dir = process.cwd()): string {
  return findProjectRoot(dir) || path.resolve(dir);
}
export function readCache(): Cache {
  try {
    const raw = JSON.parse(fs.readFileSync(getCachePath(), "utf8")) as Cache;
    if (![1, 2].includes(raw.version) || !Array.isArray(raw.entries))
      return { version: 2, entries: [] };
    return {
      version: 2,
      entries: raw.entries
        .filter(
          (e) =>
            e &&
            typeof e.path === "string" &&
            typeof e.title === "string" &&
            (e.provider === undefined ||
              ["datadog", "omni"].includes(e.provider)),
        )
        .map((e) => ({
          ...e,
          provider: e.provider || "datadog",
          repository: e.repository || repositoryRoot(path.dirname(e.path)),
        })),
    };
  } catch {
    return { version: 2, entries: [] };
  }
}
export function writeCache(cache: Cache): void {
  atomicWrite(
    getCachePath(),
    JSON.stringify({ ...cache, version: 2 }, null, 2) + "\n",
  );
}
export function addToCache(entry: Omit<CacheEntry, "lastScanned">): void {
  const cache = readCache();
  cache.entries = cache.entries.filter((e) => e.path !== entry.path);
  cache.entries.push({
    ...entry,
    provider: entry.provider || "datadog",
    repository: entry.repository || repositoryRoot(path.dirname(entry.path)),
    lastScanned: new Date().toISOString(),
  });
  writeCache(cache);
}
export const isDefinitionFile = (name: string) =>
  /(?:\.dash\.jsonc?|\.omni\.jsonc)$/.test(name);
function walk(dir: string, files: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      !["node_modules", ".git", "dist"].includes(entry.name)
    )
      walk(path.join(dir, entry.name), files);
    else if (entry.isFile() && isDefinitionFile(entry.name))
      files.push(path.join(dir, entry.name));
  }
}
export type ScannedDashboard = Omit<CacheEntry, "lastScanned">;
export function scanDashboards(cwd: string): ScannedDashboard[] {
  const repository = repositoryRoot(cwd);
  const files: string[] = [];
  walk(repository, files);
  return files.sort().map((file) => {
    const value = readObject(file);
    const omni = file.endsWith(".omni.jsonc");
    if (
      (omni && (value.provider !== "omni" || value.version !== 1)) ||
      (!omni && value.provider !== undefined)
    )
      throw new ChartRoomError(
        "PROVIDER_MISMATCH",
        `File extension and provider envelope conflict: ${file}`,
      );
    const doc = omni ? (value.document as Record<string, unknown>) : value;
    const targets = (omni ? value.targets : {}) as
      | Record<string, unknown>
      | undefined;
    return {
      path: file,
      repository,
      provider: omni ? "omni" : "datadog",
      title: String(doc?.name || doc?.title || path.basename(file)),
      prodId: (omni ? targets?.prod : value.zip_dashboard_id) as
        | string
        | undefined,
      testId: (omni ? targets?.test : value.zip_test_dashboard_id) as
        | string
        | undefined,
      ...(omni ? { instance: String(value.instance) } : {}),
    };
  });
}
export function refreshCache(
  cwd = process.cwd(),
  provider?: "datadog" | "omni",
): ScannedDashboard[] {
  const repository = repositoryRoot(cwd);
  const found = scanDashboards(cwd).filter(
    (e) => !provider || e.provider === provider,
  );
  const cache = readCache();
  cache.entries = cache.entries.filter(
    (e) => e.repository !== repository || (provider && e.provider !== provider),
  );
  cache.entries.push(
    ...found.map((e) => ({ ...e, lastScanned: new Date().toISOString() })),
  );
  writeCache(cache);
  return found;
}
