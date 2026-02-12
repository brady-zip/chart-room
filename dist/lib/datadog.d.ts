import type { DashboardDefinition, DatadogCreateResponse, RemoteDashboard } from "../types.js";
export declare function dashboardUrl(id: string): string;
export declare function createDashboard(title: string, layoutType: string, widgets: unknown[], options?: {
    description?: string;
    template_variables?: unknown[];
}): DatadogCreateResponse;
export declare function updateDashboard(dashboardId: string, dashboard: DashboardDefinition): void;
export declare function getDashboard(dashboardId: string): {
    exists: boolean;
    data?: RemoteDashboard;
};
