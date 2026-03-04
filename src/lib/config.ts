import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getConfigDir } from "./cache.js";

const CONFIG_PATH = join(getConfigDir(), "config.toml");
const LAST_CHECK_PATH = join(getConfigDir(), ".last_update_check");

const DEFAULT_CONFIG = `[updates]
auto_update = true
pinned_version = ""
`;

interface UpdateConfig {
  autoUpdate: boolean;
  pinnedVersion: string | null;
}

export function ensureConfigExists(): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, DEFAULT_CONFIG);
  }
}

export function readConfig(): UpdateConfig {
  ensureConfigExists();
  const content = readFileSync(CONFIG_PATH, "utf-8");
  const config: UpdateConfig = { autoUpdate: true, pinnedVersion: null };

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("["))
      continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1).trim();
    const value = raw.replace(/^["']|["']$/g, "");

    if (key === "auto_update") {
      config.autoUpdate = value === "true";
    } else if (key === "pinned_version") {
      config.pinnedVersion = value || null;
    }
  }

  return config;
}

export function getLastCheckTime(): number {
  if (!existsSync(LAST_CHECK_PATH)) return 0;
  const content = readFileSync(LAST_CHECK_PATH, "utf-8").trim();
  return parseInt(content, 10) || 0;
}

export function setLastCheckTime(): void {
  writeFileSync(LAST_CHECK_PATH, String(Date.now()));
}
