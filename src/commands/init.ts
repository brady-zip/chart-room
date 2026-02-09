import * as path from "path";
import { Command } from "commander";
import { addToCache } from "../lib/cache.js";
import { readDashboard, writeDashboard } from "../lib/dashboard.js";
import { createDashboard, dashboardUrl } from "../lib/datadog.js";

export const initCommand = new Command()
  .name("init")
  .description("Create [TEST] and prod dashboards in Datadog")
  .argument("<file>", "Path to dashboard JSON file")
  .action(async (filePath: string) => {
    console.log(`Initializing dashboard from: ${filePath}`);

    const dashboard = readDashboard(filePath);
    const hasProd = Boolean(dashboard.zip_dashboard_id);
    const hasTest = Boolean(dashboard.zip_test_dashboard_id);

    if (hasProd && hasTest) {
      console.error("Error: Both dashboard IDs already set:");
      console.error(`  zip_dashboard_id:      ${dashboard.zip_dashboard_id}`);
      console.error(
        `  zip_test_dashboard_id: ${dashboard.zip_test_dashboard_id}`,
      );
      console.error(
        'Use "status" to check, or remove the IDs to reinitialize.',
      );
      process.exit(1);
    }

    const {
      $schema: _,
      zip_dashboard_id: _pid,
      zip_test_dashboard_id: _tid,
      ...definition
    } = dashboard;
    const created: string[] = [];

    console.log("\nCreating missing dashboards in Datadog...\n");

    if (!hasTest) {
      const testTitle = `[TEST] ${dashboard.title}`;
      console.log(`Creating: ${testTitle}`);
      const testDashboard = createDashboard(
        testTitle,
        dashboard.layout_type,
        definition.widgets,
      );
      dashboard.zip_test_dashboard_id = testDashboard.id;
      created.push(`  [TEST] ${testDashboard.url}`);
      console.log(`  Created: ${testDashboard.url}`);
    } else {
      console.log(
        `[TEST] Already linked: ${dashboardUrl(dashboard.zip_test_dashboard_id!)}`,
      );
    }

    if (!hasProd) {
      console.log(`Creating: ${dashboard.title}`);
      const prodDashboard = createDashboard(
        dashboard.title,
        dashboard.layout_type,
        definition.widgets,
      );
      dashboard.zip_dashboard_id = prodDashboard.id;
      created.push(`  [PROD] ${prodDashboard.url}`);
      console.log(`  Created: ${prodDashboard.url}`);
    } else {
      console.log(
        `[PROD] Already linked: ${dashboardUrl(dashboard.zip_dashboard_id!)}`,
      );
    }

    writeDashboard(filePath, dashboard);

    addToCache({
      path: path.resolve(filePath),
      title: dashboard.title,
      prodId: dashboard.zip_dashboard_id,
      testId: dashboard.zip_test_dashboard_id,
    });

    console.log("\n" + "=".repeat(60));
    if (created.length > 0) {
      console.log("Created dashboards:");
      created.forEach((line) => console.log(line));
    }
    console.log(`\n${filePath}:`);
    console.log(`  zip_dashboard_id:      ${dashboard.zip_dashboard_id}`);
    console.log(`  zip_test_dashboard_id: ${dashboard.zip_test_dashboard_id}`);
    console.log("=".repeat(60));
    console.log("\nNext steps:");
    console.log(
      '  1. Run "test" to upload the dashboard to your [TEST] dashboard',
    );
    console.log("  2. Commit the updated dashboard file");
    console.log(
      "  3. On merge to main, the workflow will sync to the prod dashboard",
    );
  });
