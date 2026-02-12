import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  DashboardDefinition,
  DatadogCreateResponse,
  RemoteDashboard,
} from "../types.js";

const DATADOG_BASE_URL = "https://app.datadoghq.com/dashboard";

export function dashboardUrl(id: string): string {
  return `${DATADOG_BASE_URL}/${id}`;
}

let tempFileCounter = 0;
function writeTempJson(data: unknown): string {
  const tmpFile = path.join(
    os.tmpdir(),
    `dd-dash-${Date.now()}-${tempFileCounter++}.json`,
  );
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n");
  return tmpFile;
}

function runDogCommand(cmd: string): string {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      env: {
        ...process.env,
        DATADOG_API_KEY: process.env.DATADOG_API_KEY,
        DATADOG_APP_KEY: process.env.DATADOG_APP_KEY,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const err = error as { stderr?: string; message?: string };
    throw new Error(`dogshell command failed: ${err.stderr ?? err.message}`);
  }
}

function parseCreateResponse(
  output: string,
  title: string,
): DatadogCreateResponse {
  const lines = output.trim().split("\n");
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as { id?: string; title?: string };
      if (parsed.id) {
        return {
          id: parsed.id,
          title: parsed.title ?? title,
          url: dashboardUrl(parsed.id),
        };
      }
    } catch {
      // Not JSON, continue
    }
  }

  const idMatch = output.match(/"id":\s*"([^"]+)"/);
  if (idMatch?.[1]) {
    return { id: idMatch[1], title, url: dashboardUrl(idMatch[1]) };
  }

  throw new Error(`Could not parse dashboard ID from response: ${output}`);
}

export function createDashboard(
  title: string,
  layoutType: string,
  widgets: unknown[],
  options?: { description?: string; template_variables?: unknown[] },
): DatadogCreateResponse {
  const widgetsFile = writeTempJson(widgets);
  try {
    let cmd = `uvx --from datadog dogshell dashboard post "${title}" "$(cat ${widgetsFile})" "${layoutType}"`;

    if (options?.description) {
      cmd += ` --description "${options.description.replace(/"/g, '\\"')}"`;
    }

    if (options?.template_variables && options.template_variables.length > 0) {
      const varsFile = writeTempJson(options.template_variables);
      cmd += ` --template_variables "$(cat ${varsFile})"`;
      try {
        const output = runDogCommand(cmd);
        return parseCreateResponse(output, title);
      } finally {
        fs.unlinkSync(varsFile);
      }
    }

    const output = runDogCommand(cmd);
    return parseCreateResponse(output, title);
  } finally {
    fs.unlinkSync(widgetsFile);
  }
}

export function updateDashboard(
  dashboardId: string,
  dashboard: DashboardDefinition,
): void {
  const widgetsFile = writeTempJson(dashboard.widgets);
  try {
    let cmd = `cat ${widgetsFile} | uvx --from datadog dogshell dashboard update "${dashboardId}" "${dashboard.title}" "${dashboard.layout_type}"`;

    if (dashboard.description) {
      cmd += ` --description "${dashboard.description.replace(/"/g, '\\"')}"`;
    }

    const templateVars = dashboard.template_variables as unknown[] | undefined;
    if (templateVars && templateVars.length > 0) {
      const varsFile = writeTempJson(templateVars);
      cmd += ` --template_variables "$(cat ${varsFile})"`;
      try {
        runDogCommand(cmd);
      } finally {
        fs.unlinkSync(varsFile);
      }
      return;
    }

    runDogCommand(cmd);
  } finally {
    fs.unlinkSync(widgetsFile);
  }
}

export function getDashboard(dashboardId: string): {
  exists: boolean;
  data?: RemoteDashboard;
} {
  try {
    const cmd = `uvx --from datadog dogshell dashboard show "${dashboardId}"`;
    const output = runDogCommand(cmd);
    const parsed = JSON.parse(output) as RemoteDashboard;
    return { exists: true, data: parsed };
  } catch {
    return { exists: false };
  }
}
