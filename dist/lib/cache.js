import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
export function getConfigDir() {
    return path.join(homedir(), ".config", "chart-room");
}
export function getCachePath() {
    return path.join(getConfigDir(), "cache.json");
}
export function readCache() {
    const cachePath = getCachePath();
    if (!fs.existsSync(cachePath)) {
        return { version: 1, entries: [] };
    }
    const content = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(content);
}
export function writeCache(cache) {
    const configDir = getConfigDir();
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(getCachePath(), JSON.stringify(cache, null, 2) + "\n");
}
export function addToCache(entry) {
    const cache = readCache();
    const existing = cache.entries.findIndex((e) => e.path === entry.path);
    const newEntry = {
        ...entry,
        lastScanned: new Date().toISOString(),
    };
    if (existing >= 0) {
        cache.entries[existing] = newEntry;
    }
    else {
        cache.entries.push(newEntry);
    }
    writeCache(cache);
}
export function findProjectRoot(dir) {
    let current = path.resolve(dir);
    const root = path.parse(current).root;
    while (current !== root) {
        if (fs.existsSync(path.join(current, ".git")) ||
            fs.existsSync(path.join(current, "package.json"))) {
            return current;
        }
        current = path.dirname(current);
    }
    return null;
}
const SKIP_DIRS = new Set(["node_modules", ".git", "dist"]);
function walkDir(dir, results) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) {
                walkDir(path.join(dir, entry.name), results);
            }
        }
        else if (entry.isFile() && entry.name.endsWith(".dash.json")) {
            results.push(path.join(dir, entry.name));
        }
    }
}
export function scanDashboards(cwd) {
    const projectRoot = findProjectRoot(cwd);
    const startDir = projectRoot ?? cwd;
    const files = [];
    walkDir(startDir, files);
    return files.map((filePath) => {
        const content = fs.readFileSync(filePath, "utf-8");
        const dashboard = JSON.parse(content);
        return {
            path: filePath,
            title: dashboard.title ?? path.basename(filePath),
            prodId: dashboard.zip_dashboard_id,
            testId: dashboard.zip_test_dashboard_id,
        };
    });
}
