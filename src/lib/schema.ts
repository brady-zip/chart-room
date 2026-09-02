import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import schema from "../../schema/datadog-dashboard.schema.json" with { type: "json" };
import { getConfigDir } from "./cache.js";
import { SCHEMA_FILENAME } from "./meta.js";

/** The schema as it should appear on disk: bundled into the binary at build. */
const SCHEMA_BODY = JSON.stringify(schema, null, 2) + "\n";

/** Where the local copy lives, e.g. ~/.config/chart-room/<SCHEMA_FILENAME>. */
export function getSchemaPath(): string {
  return join(getConfigDir(), SCHEMA_FILENAME);
}

/**
 * Materializes the bundled schema in the config dir, rewriting it whenever the
 * contents differ so an upgraded binary carries its schema across. Configs
 * point `$schema` at the public URL, so this copy is only needed offline and by
 * validators like `ajv` — losing it is never fatal, hence the silent failure.
 */
export function ensureSchemaFile(): void {
  try {
    const schemaPath = getSchemaPath();
    if (readFileSync(schemaPath, "utf-8") === SCHEMA_BODY) return;
    writeFileSync(schemaPath, SCHEMA_BODY);
  } catch {
    try {
      mkdirSync(getConfigDir(), { recursive: true });
      writeFileSync(getSchemaPath(), SCHEMA_BODY);
    } catch {
      // Best-effort: the URL in `$schema` works without this file.
    }
  }
}
