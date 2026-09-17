import { spawnSync } from "node:child_process";
import { ChartRoomError, object } from "./errors.js";
import type {
  DashboardDefinition,
  DatadogCreateResponse,
  RemoteDashboard,
} from "../types.js";

const DATADOG_BASE_URL = "https://app.datadoghq.com/dashboard";
export function dashboardUrl(id: string): string {
  return `${DATADOG_BASE_URL}/${id}`;
}
export function runDogCommand(args: string[], input?: string): string {
  const result = spawnSync(
    "uvx",
    ["--from", "datadog", "dogshell", "dashboard", ...args],
    {
      encoding: "utf8",
      input,
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    const status = result.stderr?.match(/\b(401|403|404|409|429)\b/)?.[1];
    const code =
      (
        {
          "401": "UNAUTHENTICATED",
          "403": "PERMISSION_DENIED",
          "404": "NOT_FOUND",
          "409": "CONFLICT",
          "429": "RATE_LIMITED",
        } as Record<string, string>
      )[status || ""] || "DATADOG_ERROR";
    throw new ChartRoomError(
      code,
      `dogshell dashboard ${args[0]} failed${status ? ` (HTTP ${status})` : ""}; check Datadog credentials, permissions and connectivity`,
    );
  }
  return result.stdout;
}
function parseCreateResponse(
  output: string,
  title: string,
): DatadogCreateResponse {
  for (const text of [output, ...output.trim().split("\n")]) {
    try {
      const parsed = object(JSON.parse(text), "Datadog create response");
      if (typeof parsed.id === "string" && parsed.id)
        return {
          id: parsed.id,
          title: typeof parsed.title === "string" ? parsed.title : title,
          url: dashboardUrl(parsed.id),
        };
    } catch {
      /* dogshell may print a status line before JSON. */
    }
  }
  const id = output.match(/"id":\s*"([A-Za-z0-9-]+)"/)?.[1];
  if (id) return { id, title, url: dashboardUrl(id) };
  throw new ChartRoomError(
    "INVALID_RESPONSE",
    "Could not parse a dashboard ID from dogshell; inspect Datadog before retrying creation",
  );
}
export function createDashboard(
  title: string,
  layoutType: string,
  widgets: unknown[],
  options?: { description?: string; template_variables?: unknown[] },
): DatadogCreateResponse {
  const args = ["post", title, JSON.stringify(widgets), layoutType];
  if (options?.description) args.push("--description", options.description);
  if (options?.template_variables?.length)
    args.push(
      "--template_variables",
      JSON.stringify(options.template_variables),
    );
  return parseCreateResponse(runDogCommand(args), title);
}
export function updateDashboard(
  id: string,
  dashboard: DashboardDefinition,
): void {
  const args = ["update", id, dashboard.title, dashboard.layout_type];
  if (dashboard.description) args.push("--description", dashboard.description);
  const variables = dashboard.template_variables as unknown[] | undefined;
  if (variables?.length)
    args.push("--template_variables", JSON.stringify(variables));
  runDogCommand(args, JSON.stringify(dashboard.widgets));
}
export function getDashboard(id: string): {
  exists: boolean;
  data?: RemoteDashboard;
} {
  try {
    const data = object(
      JSON.parse(runDogCommand(["show", id])),
      "Datadog dashboard",
    ) as RemoteDashboard;
    return { exists: true, data };
  } catch (error) {
    if (error instanceof ChartRoomError && error.code === "NOT_FOUND")
      return { exists: false };
    if (error instanceof SyntaxError)
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        "Datadog returned malformed JSON",
      );
    throw error;
  }
}
