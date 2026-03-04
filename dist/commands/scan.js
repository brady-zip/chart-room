import * as path from "path";
import { Command } from "commander";
import { readCache, writeCache, scanDashboards, } from "../lib/cache.js";
import { dashboardUrl } from "../lib/datadog.js";
export const scanCommand = new Command()
    .name("scan")
    .description("Scan project for dashboard files and update cache")
    .option("-q, --quiet", "Only output count of found dashboards")
    .action((options) => {
    const cwd = process.cwd();
    const found = scanDashboards(cwd);
    const cache = readCache();
    const existingPaths = new Set(found.map((d) => d.path));
    // Keep entries from other projects, update/add entries from this scan
    const otherEntries = cache.entries.filter((e) => !existingPaths.has(e.path));
    const now = new Date().toISOString();
    const newEntries = found.map((d) => ({
        path: d.path,
        title: d.title,
        prodId: d.prodId,
        testId: d.testId,
        lastScanned: now,
    }));
    cache.entries = [...otherEntries, ...newEntries];
    writeCache(cache);
    if (options.quiet) {
        console.log(found.length);
    }
    else {
        console.log(`Found ${found.length} dashboard(s):\n`);
        for (const d of found) {
            const rel = path.relative(cwd, d.path);
            console.log(`  ${rel}`);
            console.log(`    title: ${d.title}`);
            if (d.prodId)
                console.log(`    prod:  ${dashboardUrl(d.prodId)}`);
            if (d.testId)
                console.log(`    test:  ${dashboardUrl(d.testId)}`);
        }
        console.log(`\nCache updated at: ~/.config/chart-room/cache.json`);
    }
});
