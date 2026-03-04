import { chmodSync, renameSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { $ } from "bun";
import pkg from "../../package.json" with { type: "json" };
import { getLastCheckTime, readConfig, setLastCheckTime } from "./config.js";

const REPO = "brady-zip/chart-room";
const ASSET = "chart-room-darwin-arm64";
const ONE_HOUR = 60 * 60 * 1000;

export async function checkForUpdates(): Promise<void> {
  try {
    const config = readConfig();
    if (!config.autoUpdate) return;

    const lastCheck = getLastCheckTime();
    if (Date.now() - lastCheck < ONE_HOUR) return;

    setLastCheckTime();

    let targetTag: string;
    if (config.pinnedVersion) {
      targetTag = config.pinnedVersion.startsWith("v")
        ? config.pinnedVersion
        : `v${config.pinnedVersion}`;
    } else {
      targetTag = (
        await $`gh api repos/${REPO}/releases/latest --jq '.tag_name'`
          .quiet()
          .text()
      ).trim();
    }

    const targetVersion = targetTag.replace(/^v/, "");
    const currentVersion = pkg.version.replace(/^v/, "");
    if (targetVersion === currentVersion) return;

    const tmpPath = join(tmpdir(), `chart-room-update-${Date.now()}`);
    await $`gh release download ${targetTag} --repo ${REPO} --pattern ${ASSET} --output ${tmpPath}`.quiet();

    chmodSync(tmpPath, 0o755);
    renameSync(tmpPath, process.execPath);

    console.log(
      `chart-room updated: v${currentVersion} \u2192 v${targetVersion} (takes effect next run)`,
    );
  } catch {
    // Silent failure — updates are best-effort
  }
}
