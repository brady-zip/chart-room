export class ChartRoomError extends Error {
  constructor(
    public code: string,
    message: string,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ChartRoomError";
  }
  toJSON() {
    return { code: this.code, message: this.message, ...this.details };
  }
}

export function object(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ChartRoomError(
      "INVALID_RESPONSE",
      `${context} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

export function asError(value: unknown): ChartRoomError {
  return value instanceof ChartRoomError
    ? value
    : new ChartRoomError(
        "FAILED",
        value instanceof Error ? value.message : "Operation failed",
      );
}
