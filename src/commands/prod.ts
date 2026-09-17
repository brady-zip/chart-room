import { recordVerification } from "../lib/verification.js";
import { omniFileAction, type FileOptions } from "./omni.js";
import { Command } from "commander";
import { preprocessForUpload, readDashboard } from "../lib/dashboard.js";
import { dashboardUrl, updateDashboard } from "../lib/datadog.js";

export const prodCommand = new Command()
  .name("prod")
  .description("Upload dashboard to production dashboard")
  .option("--dry-run", "Inspect production update without mutation")
  .argument("<file>", "Path to dashboard JSON file")
  .action((filePath: string, _options: FileOptions, command: Command) => {
    if (
      omniFileAction("prod", filePath, command.optsWithGlobals<FileOptions>())
    )
      return;
    const shared = command.optsWithGlobals<FileOptions>();
    const log =
      shared.format === "json" ? (..._values: unknown[]) => {} : console.log;
    const dashboard = readDashboard(filePath);

    if (!dashboard.zip_dashboard_id) {
      console.error("Error: No zip_dashboard_id set.");
      console.error('Run "link <file> <id>" or "init <file>" first.');
      process.exit(1);
    }

    const prodId = dashboard.zip_dashboard_id;
    if (command.optsWithGlobals<FileOptions>().dryRun) {
      console.log(
        JSON.stringify(
          {
            provider: "datadog",
            outcome: "WOULD_UPDATE",
            id: prodId,
            payload: preprocessForUpload(dashboard, filePath),
          },
          null,
          2,
        ),
      );
      return;
    }
    log(`Uploading to production dashboard: ${prodId}`);

    const processed = preprocessForUpload(dashboard, filePath);

    if (process.env.DEBUG) {
      log("\n=== DEBUG: Payload being sent ===");
      log(JSON.stringify(processed, null, 2));
      log("=================================\n");
    }

    updateDashboard(prodId, processed);

    recordVerification(filePath, "datadog", "prod", {
      outcome: "UPLOADED",
      verified: false,
      id: prodId,
    });
    if (shared.format === "json")
      console.log(
        JSON.stringify({
          provider: "datadog",
          outcome: "UPLOADED",
          verified: false,
          id: prodId,
          url: dashboardUrl(prodId),
        }),
      );
    const uploadedAt = new Date().toISOString();
    log(`\nUploaded to: ${dashboardUrl(prodId)}`);
    log(`Uploaded at: ${uploadedAt}`);
  });
