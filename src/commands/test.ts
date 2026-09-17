import { recordVerification } from "../lib/verification.js";
import { omniFileAction, type FileOptions } from "./omni.js";
import { Command } from "commander";
import {
  addTestBanner,
  preprocessForUpload,
  readDashboard,
} from "../lib/dashboard.js";
import { dashboardUrl, updateDashboard } from "../lib/datadog.js";

export const testCommand = new Command()
  .name("test")
  .description("Upload dashboard to test dashboard")
  .argument("<file>", "Path to dashboard JSON file")
  .action((filePath: string, _options: FileOptions, command: Command) => {
    if (
      omniFileAction("test", filePath, command.optsWithGlobals<FileOptions>())
    )
      return;
    const shared = command.optsWithGlobals<FileOptions>();
    const log =
      shared.format === "json" ? (..._values: unknown[]) => {} : console.log;
    const dashboard = readDashboard(filePath);

    if (!dashboard.zip_test_dashboard_id) {
      console.error("Error: No zip_test_dashboard_id set.");
      console.error('Run "link --test <file> <id>" or "init <file>" first.');
      process.exit(1);
    }

    if (!dashboard.zip_dashboard_id) {
      console.error("Error: No zip_dashboard_id set.");
      console.error("Cannot link to production dashboard without prod ID.");
      process.exit(1);
    }

    const testId = dashboard.zip_test_dashboard_id;
    const prodUrl = dashboardUrl(dashboard.zip_dashboard_id);
    log(`Uploading to test dashboard: ${testId}`);

    const processed = preprocessForUpload(dashboard, filePath);
    processed.title = `[TEST] ${dashboard.title}`;

    const withBanner = addTestBanner(processed, prodUrl);

    // Debug: dump payload to see what we're sending
    if (process.env.DEBUG) {
      log("\n=== DEBUG: Payload being sent ===");
      log(JSON.stringify(withBanner, null, 2));
      log("=================================\n");
    }

    updateDashboard(testId, withBanner);

    recordVerification(filePath, "datadog", "test", {
      outcome: "UPLOADED",
      verified: false,
      id: testId,
    });
    if (shared.format === "json")
      console.log(
        JSON.stringify({
          provider: "datadog",
          outcome: "UPLOADED",
          verified: false,
          id: testId,
          url: dashboardUrl(testId),
        }),
      );
    const uploadedAt = new Date().toISOString();
    log(`\nUploaded to: ${dashboardUrl(testId)}`);
    log(`Uploaded at: ${uploadedAt}`);
  });
