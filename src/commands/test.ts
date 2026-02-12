import { Command } from "commander";
import { preprocessForUpload, readDashboard } from "../lib/dashboard.js";
import { dashboardUrl, updateDashboard } from "../lib/datadog.js";
import type { DashboardDefinition, WidgetEntry } from "../types.js";

function createTestBannerWidget(prodUrl: string): WidgetEntry {
  const bannerText = `## ⚠️ TEST DASHBOARD

This is a **test dashboard** for local development. Changes here are temporary.

**Production dashboard:** [${prodUrl}](${prodUrl})`;

  return {
    definition: {
      type: "note",
      content: bannerText,
      background_color: "yellow",
      font_size: "16",
      text_align: "center",
      vertical_align: "center",
      show_tick: false,
      tick_pos: "50%",
      tick_edge: "bottom",
      has_padding: true,
    },
  };
}

function addTestBanner(
  dashboard: DashboardDefinition,
  prodUrl: string,
): DashboardDefinition {
  const banner = createTestBannerWidget(prodUrl);
  const bannerHeight = 2;

  // Filter out any existing test banner from widgets
  const existingWidgets = (dashboard.widgets ?? []).filter((w) => {
    const content = String(w.definition?.content ?? "");
    return !content.includes("TEST DASHBOARD");
  });

  // Position banner at top with full width
  banner.layout = { x: 0, y: 0, width: 12, height: bannerHeight };

  // Shift all existing widgets down by banner height
  // Only modify widgets that have explicit layouts; leave others to flow naturally
  const shiftedWidgets = existingWidgets.map((w) => {
    if (!w.layout) return w;
    return {
      ...w,
      layout: { ...w.layout, y: (w.layout.y ?? 0) + bannerHeight },
    };
  });

  return { ...dashboard, widgets: [banner, ...shiftedWidgets] };
}

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
