import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { getConfigDir } from "./cache.js";
import { atomicWrite } from "./files.js";

function verificationPath(
  file: string,
  provider: string,
  target: string,
): string {
  return join(
    getConfigDir(),
    "verification",
    `${createHash("sha256")
      .update(JSON.stringify([resolve(file), provider, target]))
      .digest("hex")}.json`,
  );
}
function digest(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
export function recordVerification(
  file: string,
  provider: string,
  target: string,
  result: Record<string, unknown>,
): void {
  atomicWrite(
    verificationPath(file, provider, target),
    JSON.stringify({
      ...result,
      digest: digest(file),
      at: new Date().toISOString(),
    }) + "\n",
  );
}
export function lastVerification(
  file: string,
  provider: string,
  target: string,
): Record<string, unknown> | null {
  try {
    const result = JSON.parse(
      readFileSync(verificationPath(file, provider, target), "utf8"),
    );
    if (
      typeof result.at !== "string" ||
      typeof result.digest !== "string" ||
      typeof result.outcome !== "string"
    )
      return null;
    return { ...result, matchesLocalFile: result.digest === digest(file) };
  } catch {
    return null;
  }
}
