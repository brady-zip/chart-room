import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser";
import { ChartRoomError, object } from "./errors.js";

export function readObject(file: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const result: unknown = parse(readFileSync(file, "utf8"), errors, {
    allowTrailingComma: true,
  });
  if (errors.length)
    throw new ChartRoomError(
      "INVALID_FILE",
      `Invalid JSONC at offset ${errors[0]!.offset}`,
    );
  return object(result, "Dashboard");
}

export function atomicWrite(file: string, text: string): void {
  const dest = resolve(file);
  mkdirSync(dirname(dest), { recursive: true });
  const temp = `${dest}.${randomUUID()}.tmp`;
  const mode = existsSync(dest) ? statSync(dest).mode & 0o777 : 0o600;
  try {
    const fd = openSync(temp, "wx", mode);
    try {
      writeFileSync(fd, text);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, dest);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

/** Edit only owned properties in the JSONC tree, retaining all user comments. */
export function updateJsonc(
  file: string,
  updates: [string[], unknown][],
  schema?: string,
): void {
  let text = existsSync(file) ? readFileSync(file, "utf8") : "{}\n";
  if (existsSync(file)) readObject(file);
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: "\n" };
  for (const [path, value] of updates)
    text = applyEdits(text, modify(text, path, value, { formattingOptions }));
  if (schema) {
    // Removing/reinserting a property leaves surrounding comments in place.
    text = applyEdits(
      text,
      modify(text, ["$schema"], undefined, { formattingOptions }),
    );
    text = applyEdits(
      text,
      modify(text, ["$schema"], schema, {
        formattingOptions,
        getInsertionIndex: () => 0,
      }),
    );
  }
  atomicWrite(file, text.endsWith("\n") ? text : `${text}\n`);
}
