import { omniFileAction, type FileOptions } from "./omni.js";
import * as fs from "fs";
import * as path from "path";
import { Command } from "commander";
import { addToCache } from "../lib/cache.js";
import {
  addTestBanner,
  dashboardBasename,
  readDashboard,
  writeDashboard,
} from "../lib/dashboard.js";
import { createDashboard, dashboardUrl } from "../lib/datadog.js";
import type { DashboardDefinition } from "../types.js";

function titleFromFilename(filePath: string): string {
  return dashboardBasename(filePath)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function createDefaultDashboard(filePath: string): DashboardDefinition {
  return {
    _meta: {
      intent: "{describe the purpose of this dashboard}",
      audience: "{describe the intended audience}",
      scope: "{describe what systems/services this covers}",
    },
    title: titleFromFilename(filePath),
    description: "",
    layout_type: "ordered",
    widgets: [],
    // Required by the schema, so the file validates the moment it is created.
    notify_list: [],
    reflow_type: "fixed",
  };
}

export const initCommand = new Command()
  .name("init")
  .description("Create [TEST] and prod dashboards")
  .option("--model <id>", "Existing Omni shared model")
  .option("--prod-folder <id>", "Folder for new production document")
  .option("--test-folder <id>", "Folder for new test document")
  .option(
    "--retry-create",
    "Explicitly retry an absent intended create using its saved unique ID",
  )
  .argument("<file>", "Path to dashboard JSON file (created if missing)")
  .action(async (filePath: string, _options: FileOptions, command: Command) => {
    if (
      omniFileAction("init", filePath, command.optsWithGlobals<FileOptions>())
    )
      return;
    const shared = command.optsWithGlobals<FileOptions>();
    const log =
      shared.format === "json" ? (..._values: unknown[]) => {} : console.log;
    const absolutePath = path.resolve(filePath);
    const fileExists = fs.existsSync(absolutePath);

    let dashboard: DashboardDefinition;
    if (fileExists) {
      log(`Initializing dashboard from: ${filePath}`);
      dashboard = readDashboard(filePath);
    } else {
      log(`Creating new dashboard: ${filePath}`);
      dashboard = createDefaultDashboard(filePath);
      const dir = path.dirname(absolutePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
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

    log("\nCreating missing dashboards...\n");

    const createOptions = {
      description: definition.description,
      template_variables: definition.template_variables as
        | unknown[]
        | undefined,
    };

    // Create prod first so we have the URL for the test banner
    if (!hasProd) {
      log(`Creating: ${dashboard.title}`);
      const prodDashboard = createDashboard(
        dashboard.title,
        dashboard.layout_type,
        definition.widgets,
        createOptions,
      );
      dashboard.zip_dashboard_id = prodDashboard.id;
      writeDashboard(filePath, dashboard);
      created.push(`  [PROD] ${prodDashboard.url}`);
      log(`  Created: ${prodDashboard.url}`);
    } else {
      log(
        `[PROD] Already linked: ${dashboardUrl(dashboard.zip_dashboard_id!)}`,
      );
    }

    // Create test dashboard with banner pointing to prod
    if (!hasTest) {
      const testTitle = `[TEST] ${dashboard.title}`;
      const prodUrl = dashboardUrl(dashboard.zip_dashboard_id!);
      const withBanner = addTestBanner(
        { ...definition, title: testTitle },
        prodUrl,
      );
      log(`Creating: ${testTitle}`);
      const testDashboard = createDashboard(
        testTitle,
        dashboard.layout_type,
        withBanner.widgets,
        createOptions,
      );
      dashboard.zip_test_dashboard_id = testDashboard.id;
      writeDashboard(filePath, dashboard);
      created.push(`  [TEST] ${testDashboard.url}`);
      log(`  Created: ${testDashboard.url}`);
    } else {
      log(
        `[TEST] Already linked: ${dashboardUrl(dashboard.zip_test_dashboard_id!)}`,
      );
    }

    writeDashboard(filePath, dashboard);

    addToCache({
      path: path.resolve(filePath),
      title: dashboard.title,
      prodId: dashboard.zip_dashboard_id,
      testId: dashboard.zip_test_dashboard_id,
    });

    if (shared.format === "json")
      console.log(
        JSON.stringify({
          provider: "datadog",
          outcome: "PROVISIONED",
          prodId: dashboard.zip_dashboard_id,
          testId: dashboard.zip_test_dashboard_id,
        }),
      );
    log("\n" + "=".repeat(60));
    if (created.length > 0) {
      log("Created dashboards:");
      created.forEach((line) => log(line));
    }
    log(`\n${filePath}:`);
    log(`  zip_dashboard_id:      ${dashboard.zip_dashboard_id}`);
    log(`  zip_test_dashboard_id: ${dashboard.zip_test_dashboard_id}`);
    log("=".repeat(60));
    log("\nNext steps:");
    log('  1. Run "test" to upload the dashboard to your [TEST] dashboard');
    log("  2. Commit the updated dashboard file");
    log("  3. On merge to main, the workflow will sync to the prod dashboard");
  });
