import { Command } from "commander";
import { preprocessForUpload, readDashboard } from "../lib/dashboard.js";
import { dashboardUrl, updateDashboard } from "../lib/datadog.js";
export const prodCommand = new Command()
    .name("prod")
    .description("Upload dashboard to production dashboard in Datadog")
    .argument("<file>", "Path to dashboard JSON file")
    .action((filePath) => {
    const dashboard = readDashboard(filePath);
    if (!dashboard.zip_dashboard_id) {
        console.error("Error: No zip_dashboard_id set.");
        console.error('Run "link <file> <id>" or "init <file>" first.');
        process.exit(1);
    }
    const prodId = dashboard.zip_dashboard_id;
    console.log(`Uploading to production dashboard: ${prodId}`);
    const processed = preprocessForUpload(dashboard, filePath);
    if (process.env.DEBUG) {
        console.log("\n=== DEBUG: Payload being sent ===");
        console.log(JSON.stringify(processed, null, 2));
        console.log("=================================\n");
    }
    updateDashboard(prodId, processed);
    const uploadedAt = new Date().toISOString();
    console.log(`\nUploaded to: ${dashboardUrl(prodId)}`);
    console.log(`Uploaded at: ${uploadedAt}`);
});
