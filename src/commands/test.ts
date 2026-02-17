import { Command } from "commander";
import {
  addTestBanner,
  preprocessForUpload,
  readDashboard,
} from "../lib/dashboard.js";
import { dashboardUrl, updateDashboard } from "../lib/datadog.js";

export const testCommand = new Command()
  .name("test")
  .description("Upload dashboard to test dashboard in Datadog")
  .argument("<file>", "Path to dashboard JSON file")
  .action((filePath: string) => {
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
    console.log(`Uploading to test dashboard: ${testId}`);

    const processed = preprocessForUpload(dashboard, filePath);
    processed.title = `[TEST] ${dashboard.title}`;

    const withBanner = addTestBanner(processed, prodUrl);

    // Debug: dump payload to see what we're sending
    if (process.env.DEBUG) {
      console.log("\n=== DEBUG: Payload being sent ===");
      console.log(JSON.stringify(withBanner, null, 2));
      console.log("=================================\n");
    }

    updateDashboard(testId, withBanner);

    const uploadedAt = new Date().toISOString();
    console.log(`\nUploaded to: ${dashboardUrl(testId)}`);
    console.log(`Uploaded at: ${uploadedAt}`);
  });
