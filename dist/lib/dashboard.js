import * as fs from "fs";
import * as path from "path";
export function readDashboard(filePath) {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`File not found: ${absolutePath}`);
    }
    const content = fs.readFileSync(absolutePath, "utf-8");
    return JSON.parse(content);
}
export function writeDashboard(filePath, dashboard) {
    const absolutePath = path.resolve(filePath);
    fs.writeFileSync(absolutePath, JSON.stringify(dashboard, null, 2) + "\n");
}
export function isSourceWidget(widget) {
    const def = widget.definition;
    if (!def)
        return false;
    const text = def.text ?? "";
    const type = def.type ?? "";
    return type === "free_text" && text.includes("Source definition:");
}
export function isSourceWidgetDeep(widget) {
    const def = (widget.definition ?? widget);
    const type = String(def.type ?? "");
    const text = String(def.text ?? "");
    if (type === "free_text" && text.includes("Source definition:"))
        return true;
    if (type === "note" && text.includes("Source definition:"))
        return true;
    return false;
}
export function preprocessForUpload(dashboard, filePath) {
    const { $schema: _, zip_dashboard_id: _pid, zip_test_dashboard_id: _tid, ...rest } = dashboard;
    const filteredWidgets = (rest.widgets ?? []).filter((widget) => {
        const def = widget.definition;
        return !(def?.type === "free_text" &&
            (def.text ?? "").includes("Source definition:"));
    });
    const uploadedAt = new Date().toISOString();
    const noteText = `Source definition: ${filePath} (local upload at ${uploadedAt})`;
    const noteWidget = {
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
function createTestBannerWidget(prodUrl) {
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
export function addTestBanner(dashboard, prodUrl) {
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
        if (!w.layout)
            return w;
        return {
            ...w,
            layout: { ...w.layout, y: (w.layout.y ?? 0) + bannerHeight },
        };
    });
    return { ...dashboard, widgets: [banner, ...shiftedWidgets] };
}
