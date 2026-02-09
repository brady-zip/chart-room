import { Command } from "commander";
import { preprocessForUpload, readDashboard } from "../lib/dashboard.js";
import { dashboardUrl, updateDashboard } from "../lib/datadog.js";
export const testCommand = new Command()
    .name("test")
    .description("Upload dashboard to test dashboard in Datadog")
    .argument("<file>", "Path to dashboard JSON file")
    .action((filePath) => {
    const dashboard = readDashboard(filePath);
    if (!dashboard.zip_test_dashboard_id) {
        console.error("Error: No zip_test_dashboard_id set.");
        console.error('Run "link --test <file> <id>" or "init <file>" first.');
        process.exit(1);
    }
    const testId = dashboard.zip_test_dashboard_id;
    console.log(`Uploading to test dashboard: ${testId}`);
    const processed = preprocessForUpload(dashboard, filePath);
    processed.title = `[TEST] ${dashboard.title}`;
    updateDashboard(testId, processed);
    const uploadedAt = new Date().toISOString();
    console.log(`\nUploaded to: ${dashboardUrl(testId)}`);
    console.log(`Uploaded at: ${uploadedAt}`);
});
