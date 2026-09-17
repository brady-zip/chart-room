import { Command } from "commander";
import { relative } from "node:path";
import { refreshCache } from "../lib/cache.js";
import { dashboardUrl } from "../lib/datadog.js";
import { output, type FileOptions } from "./omni.js";

export const scanCommand = new Command("scan")
  .description("Index Datadog and Omni definitions in this repository")
  .option("-q, --quiet", "Only output count of found dashboards")
  .action((options: { quiet?: boolean }, command: Command) => {
    const shared = command.optsWithGlobals<FileOptions>();
    const found = refreshCache(process.cwd(), shared.provider);
    if (shared.format === "json") {
      output({ dashboards: found }, shared);
      return;
    }
    if (options.quiet) {
      console.log(found.length);
      return;
    }
    console.log(`Found ${found.length} dashboard(s):\n`);
    for (const d of found) {
      const url = (id: string) =>
        d.provider === "omni"
          ? `${d.instance}/dashboards/${id}`
          : dashboardUrl(id);
      console.log(
        `  ${relative(process.cwd(), d.path)} (${d.provider})\n    title: ${d.title}`,
      );
      if (d.prodId) console.log(`    prod:  ${url(d.prodId)}`);
      if (d.testId) console.log(`    test:  ${url(d.testId)}`);
    }
  });
