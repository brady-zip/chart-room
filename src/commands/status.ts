import { omniFileAction, type FileOptions } from "./omni.js";
import { Command } from "commander";
import { addTestBanner, readDashboard } from "../lib/dashboard.js";
import { dashboardUrl, getDashboard } from "../lib/datadog.js";
import { diffDashboards } from "../lib/diff.js";
import { asError } from "../lib/errors.js";

export const statusCommand = new Command()
  .name("status")
  .description("Show dashboard sync status")
  .option("--json", "Print structured status")
  .argument("<file>", "Path to dashboard JSON file")
  .action((filePath: string, _options: FileOptions, command: Command) => {
    if (
      omniFileAction("status", filePath, command.optsWithGlobals<FileOptions>())
    )
      return;
    const shared = command.optsWithGlobals<FileOptions>();
    if (shared.json || shared.format === "json") {
      const dashboard = readDashboard(filePath);
      const targets: Record<string, unknown> = {};
      for (const [target, id] of [
        ["prod", dashboard.zip_dashboard_id],
        ["test", dashboard.zip_test_dashboard_id],
      ]) {
        if (!id) {
          targets[target!] = { outcome: "NOT_LINKED" };
          continue;
        }
        try {
          const remote = getDashboard(id);
          const expected =
            target === "test" && dashboard.zip_dashboard_id
              ? addTestBanner(
                  { ...dashboard, title: `[TEST] ${dashboard.title}` },
                  dashboardUrl(dashboard.zip_dashboard_id),
                )
              : dashboard;
          const differences = remote.data
            ? diffDashboards(expected, remote.data)
            : [];
          targets[target!] = {
            id,
            url: dashboardUrl(id),
            outcome: !remote.exists
              ? "NOT_FOUND"
              : differences.length
                ? "DRIFT"
                : "IN_SYNC",
            differences,
          };
        } catch (error) {
          targets[target!] = {
            outcome: "FAILED",
            error: asError(error).toJSON(),
          };
          process.exitCode = 1;
        }
      }
      console.log(JSON.stringify({ provider: "datadog", targets }));
      return;
    }
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

    console.log("\nValidating dashboards...");

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
