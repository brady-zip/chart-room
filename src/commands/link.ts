import { omniFileAction, type FileOptions } from "./omni.js";
import { Command } from "commander";
import { readDashboard, writeDashboard } from "../lib/dashboard.js";
import { dashboardUrl, getDashboard } from "../lib/datadog.js";
import { prompt } from "../lib/prompt.js";

export const linkCommand = new Command()
  .name("link")
  .description("Link existing dashboard to local file")
  .option("--test", "Link as test dashboard instead of prod")
  .argument("<file>", "Path to dashboard JSON file")
  .argument("<id>", "Dashboard identifier")
  .action(
    async (
      filePath: string,
      dashboardId: string,
      options: FileOptions,
      command: Command,
    ) => {
      if (
        omniFileAction(
          "link",
          filePath,
          command.optsWithGlobals<FileOptions>(),
          dashboardId,
        )
      )
        return;
      const shared = command.optsWithGlobals<FileOptions>();
      const log =
        shared.format === "json" ? (..._values: unknown[]) => {} : console.log;
      const isTest = options.test ?? false;
      const idField = isTest ? "zip_test_dashboard_id" : "zip_dashboard_id";
      const label = isTest ? "[TEST]" : "[PROD]";
      log(`Linking ${label} dashboard: ${filePath} -> ${dashboardId}`);

      const dashboard = readDashboard(filePath);

      const existingId = dashboard[idField] as string | undefined;
      if (existingId) {
        console.error(
          `Warning: Dashboard already has ${idField}: ${existingId}`,
        );
        const answer = await prompt("Overwrite? (y/N): ");
        if (answer.trim().toLowerCase() !== "y") {
          log("Aborted.");
          process.exit(1);
        }
      }

      log(`\nValidating dashboard ${dashboardId} exists in Datadog...`);
      const result = getDashboard(dashboardId);

      if (!result.exists) {
        console.error(`Error: Dashboard ${dashboardId} not found in Datadog`);
        console.error(
          "Make sure DATADOG_API_KEY and DATADOG_APP_KEY are set correctly.",
        );
        process.exit(1);
      }

      log(`  Found: ${result.data?.title}`);

      (dashboard as Record<string, unknown>)[idField] = dashboardId;
      writeDashboard(filePath, dashboard);

      if (shared.format === "json")
        console.log(
          JSON.stringify({
            provider: "datadog",
            outcome: "LINKED",
            id: dashboardId,
            target: isTest ? "test" : "prod",
            url: dashboardUrl(dashboardId),
          }),
        );
      log(`\nUpdated ${filePath} with ${idField}: ${dashboardId}`);
      log(`Dashboard URL: ${dashboardUrl(dashboardId)}`);
    },
  );
