import { Command } from "commander";
import {
  readCache,
  writeCache,
  scanDashboards,
  type CacheEntry,
} from "../lib/cache.js";

export const scanCommand = new Command()
  .name("scan")
  .description("Scan project for dashboard files and update cache")
  .option("-q, --quiet", "Only output count of found dashboards")
  .action((options: { quiet?: boolean }) => {
    const cwd = process.cwd();
    const found = scanDashboards(cwd);

    const cache = readCache();
    const existingPaths = new Set(found.map((d) => d.path));

    // Keep entries from other projects, update/add entries from this scan
    const otherEntries = cache.entries.filter(
      (e) => !existingPaths.has(e.path),
    );
    const now = new Date().toISOString();

    const newEntries: CacheEntry[] = found.map((d) => ({
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
    } else {
      console.log(`Found ${found.length} dashboard(s):\n`);
      for (const d of found) {
        console.log(`  ${d.path}`);
        console.log(`    title: ${d.title}`);
        if (d.prodId) console.log(`    prod:  ${d.prodId}`);
        if (d.testId) console.log(`    test:  ${d.testId}`);
      }
      console.log(`\nCache updated at: ~/.config/chart-room/cache.json`);
    }
  });
