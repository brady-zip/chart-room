import { Command } from "commander";
import { preprocessForUpload, readDashboard } from "../lib/dashboard.js";
import { dashboardUrl, updateDashboard } from "../lib/datadog.js";
import type { DashboardDefinition, WidgetEntry } from "../types.js";

function createTestBannerWidget(
  prodUrl: string,
  layoutType: string,
): WidgetEntry {
  const bannerText = `## ⚠️ TEST DASHBOARD

This is a **test dashboard** for local development. Changes here are temporary.

**Production dashboard:** [${prodUrl}](${prodUrl})`;

  const widget: WidgetEntry = {
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
    },
  };

  if (layoutType === "free") {
    widget.layout = { x: 0, y: 0, width: 12, height: 2 };
  }

  return widget;
}

function addTestBanner(
  dashboard: DashboardDefinition,
  prodUrl: string,
): DashboardDefinition {
  const banner = createTestBannerWidget(prodUrl, dashboard.layout_type);
  const widgets = dashboard.widgets ?? [];

  // Filter out any existing test banner
  const filtered = widgets.filter((w) => {
    const content = String(w.definition?.content ?? "");
    return !content.includes("TEST DASHBOARD");
  });

  if (dashboard.layout_type === "free") {
    // Shift all widgets down to make room for banner
    const shiftedWidgets = filtered.map((w) => ({
      ...w,
      layout: w.layout ? { ...w.layout, y: (w.layout.y ?? 0) + 2 } : w.layout,
    }));
    return { ...dashboard, widgets: [banner, ...shiftedWidgets] };
  }

  // For ordered layout, just prepend banner
  return { ...dashboard, widgets: [banner, ...filtered] };
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
    updateDashboard(testId, withBanner);

    const uploadedAt = new Date().toISOString();
    console.log(`\nUploaded to: ${dashboardUrl(testId)}`);
    console.log(`Uploaded at: ${uploadedAt}`);
  });
