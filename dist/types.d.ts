export interface DashboardDefinition {
    $schema?: string;
    zip_dashboard_id?: string;
    zip_test_dashboard_id?: string;
    title: string;
    description: string;
    layout_type: string;
    widgets: WidgetEntry[];
    [key: string]: unknown;
}
export interface WidgetEntry {
    definition?: {
        type?: string;
        text?: string;
        title?: string;
        [key: string]: unknown;
    };
    layout?: {
        x?: number;
        y?: number;
        width?: number;
        height?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}
export interface DatadogCreateResponse {
    id: string;
    title: string;
    url: string;
}
export interface RemoteDashboard {
    title?: string;
    description?: string;
    layout_type?: string;
    widgets?: WidgetEntry[];
    [key: string]: unknown;
}
