import * as fs from "fs";
import * as path from "path";
import type { DashboardDefinition, WidgetEntry } from "../types.js";

export function readDashboard(filePath: string): DashboardDefinition {
  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`File not found: ${absolutePath}`);
  }
  const content = fs.readFileSync(absolutePath, "utf-8");
  return JSON.parse(content) as DashboardDefinition;
}

export function writeDashboard(
  filePath: string,
  dashboard: DashboardDefinition,
): void {
  const absolutePath = path.resolve(filePath);
  fs.writeFileSync(absolutePath, JSON.stringify(dashboard, null, 2) + "\n");
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
