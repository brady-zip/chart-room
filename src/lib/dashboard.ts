import * as fs from "fs";
import * as path from "path";
import { parseJsonc } from "./jsonc.js";
import {
  GENERATED_COMMENT_LINE,
  LEGACY_GENERATED_COMMENT_KEY,
  SCHEMA_COMMENT_LINES,
  SCHEMA_URL,
} from "./meta.js";
import type { DashboardDefinition, WidgetEntry } from "../types.js";

/** Canonical extension for dashboard configs. The contents are JSONC. */
export const DASHBOARD_EXTENSION = ".dash.jsonc";

/**
 * Extensions picked up when discovering configs. `.dash.json` is still
 * recognized so files created before the switch to `.dash.jsonc` keep working.
 */
export const DASHBOARD_EXTENSIONS = [DASHBOARD_EXTENSION, ".dash.json"];

export function isDashboardFile(fileName: string): boolean {
  return DASHBOARD_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

/** Strips whichever dashboard extension the file uses. */
export function dashboardBasename(filePath: string): string {
  const fileName = path.basename(filePath);
  const ext = DASHBOARD_EXTENSIONS.find((e) => fileName.endsWith(e));
  return ext ? fileName.slice(0, -ext.length) : path.parse(fileName).name;
}

export function readDashboard(filePath: string): DashboardDefinition {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  const content = fs.readFileSync(absolutePath, "utf-8");
  const { [LEGACY_GENERATED_COMMENT_KEY]: _legacy, ...dashboard } =
    parseJsonc<DashboardDefinition>(content);
  return dashboard as DashboardDefinition;
}

/**
 * Writes the config as JSONC: the "generated with chart-room" note goes above
 * the object as a `//` comment, and `$schema` is re-stamped as the first key
 * with a note above it explaining where the schema comes from. Comments
 * elsewhere in the file are not preserved across a write.
 */
export function writeDashboard(
  filePath: string,
  dashboard: DashboardDefinition,
): void {
  const absolutePath = path.resolve(filePath);
  const { $schema: _stale, ...rest } = dashboard;
  const body = JSON.stringify({ $schema: SCHEMA_URL, ...rest }, null, 2);

  // `$schema` is serialized first, so the note lands directly above it.
  const [open, ...lines] = body.split("\n");
  const indented = SCHEMA_COMMENT_LINES.map((line) => `  ${line}`);
  const annotated = [open, ...indented, ...lines].join("\n");

  fs.writeFileSync(absolutePath, `${GENERATED_COMMENT_LINE}\n${annotated}\n`);
}

export function isSourceWidget(widget: WidgetEntry): boolean {
  const def = widget.definition;
  if (!def) return false;
  const text = def.text ?? "";
  const type = def.type ?? "";
  return type === "free_text" && text.includes("Source definition:");
}

export function isSourceWidgetDeep(widget: Record<string, unknown>): boolean {
  const def = (widget.definition ?? widget) as Record<string, unknown>;
  const type = String(def.type ?? "");
  const text = String(def.text ?? "");
  if (type === "free_text" && text.includes("Source definition:")) return true;
  if (type === "note" && text.includes("Source definition:")) return true;
  return false;
}

export function preprocessForUpload(
  dashboard: DashboardDefinition,
  filePath: string,
): DashboardDefinition {
  const {
    $schema: _,
    zip_dashboard_id: _pid,
    zip_test_dashboard_id: _tid,
    ...rest
  } = dashboard;

  const filteredWidgets = (rest.widgets ?? []).filter((widget) => {
    const def = widget.definition;
    return !(
      def?.type === "free_text" &&
      (def.text ?? "").includes("Source definition:")
    );
  });

  const uploadedAt = new Date().toISOString();
  const noteText = `Source definition: ${filePath} (local upload at ${uploadedAt})`;
  const noteWidget: WidgetEntry = {
    definition: {
      type: "free_text",
      text: noteText,
      text_align: "left",
      font_size: "14",
    },
  };

  if (dashboard.layout_type === "free") {
    let maxY = 0;
    for (const widget of filteredWidgets) {
      const layout = widget.layout;
      const y = layout?.y ?? 0;
      const height = layout?.height ?? 0;
      maxY = Math.max(maxY, y + height);
    }
    noteWidget.layout = { x: 0, y: maxY, width: 24, height: 2 };
  }

  filteredWidgets.push(noteWidget);

  return { ...rest, widgets: filteredWidgets };
}

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

export function addTestBanner(
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
