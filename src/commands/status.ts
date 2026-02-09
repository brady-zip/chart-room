import { Command } from "commander";
import { readDashboard } from "../lib/dashboard.js";
import { dashboardUrl, getDashboard } from "../lib/datadog.js";
import { diffDashboards } from "../lib/diff.js";

export const statusCommand = new Command()
  .name("status")
  .description("Show dashboard sync status")
  .argument("<file>", "Path to dashboard JSON file")
  .action((filePath: string) => {
    console.log(`Status for: ${filePath}\n`);

    const dashboard = readDashboard(filePath);

    console.log(`Title: ${dashboard.title}`);
    console.log(`Layout: ${dashboard.layout_type}`);
    console.log(`Widgets: ${dashboard.widgets.length}`);

    const hasProd = Boolean(dashboard.zip_dashboard_id);
    const hasTest = Boolean(dashboard.zip_test_dashboard_id);

    console.log("\n[PROD] Dashboard:");
    if (hasProd) {
      console.log(`  ID:  ${dashboard.zip_dashboard_id}`);
      console.log(`  URL: ${dashboardUrl(dashboard.zip_dashboard_id!)}`);
    } else {
      console.log("  NOT LINKED");
      console.log("  Fix: link <file> <id>  or  init <file>");
    }

    console.log("\n[TEST] Dashboard:");
    if (hasTest) {
      console.log(`  ID:  ${dashboard.zip_test_dashboard_id}`);
      console.log(`  URL: ${dashboardUrl(dashboard.zip_test_dashboard_id!)}`);
    } else {
      console.log("  NOT LINKED");
      console.log("  Fix: link --test <file> <id>  or  init <file>");
    }

    if (!hasProd && !hasTest) {
      console.log(
        '\nRun "init" to create both dashboards, or "link" to connect to existing ones.',
      );
      return;
    }

    console.log("\nValidating dashboards in Datadog...");

    if (hasProd) {
      const prodResult = getDashboard(dashboard.zip_dashboard_id!);
      if (prodResult.exists) {
        console.log(`  [PROD] OK (${prodResult.data!.title})`);

        const diffs = diffDashboards(dashboard, prodResult.data!);
        if (diffs.length === 0) {
          console.log("  [PROD] In sync with local");
        } else {
          console.log(`  [PROD] ${diffs.length} difference(s) from local:`);
          diffs.forEach((d) => console.log(`    - ${d}`));
        }
      } else {
        console.log("  [PROD] WARNING: Not found in Datadog");
      }
    }

    if (hasTest) {
      const testResult = getDashboard(dashboard.zip_test_dashboard_id!);
      if (testResult.exists) {
        console.log(`  [TEST] OK (${testResult.data!.title})`);
      } else {
        console.log("  [TEST] WARNING: Not found in Datadog");
      }
    }
  });
