import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import schema from "../../schema/datadog-dashboard.schema.json" with { type: "json" };
import { ChartRoomError } from "../lib/errors.js";
const ajv = new Ajv({ strict: false });
(addFormats as unknown as (ajv: Ajv) => void)(ajv);
const validate = ajv.compile(schema);
export function validateDatadog(value: unknown): void {
  if (!validate(value))
    throw new ChartRoomError(
      "INVALID_DEFINITION",
      `Invalid Datadog dashboard at ${validate.errors?.[0]?.instancePath || "/"}: ${validate.errors?.[0]?.message}`,
    );
}
