import type { DashboardDefinition, WidgetEntry } from "../types.js";
export declare function readDashboard(filePath: string): DashboardDefinition;
export declare function writeDashboard(filePath: string, dashboard: DashboardDefinition): void;
export declare function isSourceWidget(widget: WidgetEntry): boolean;
export declare function isSourceWidgetDeep(widget: Record<string, unknown>): boolean;
export declare function preprocessForUpload(dashboard: DashboardDefinition, filePath: string): DashboardDefinition;
