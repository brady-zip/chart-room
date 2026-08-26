/**
 * Minimal JSONC support: `*.dash.json` files are written with a leading `//`
 * comment, and users are free to add their own comments and trailing commas.
 * Comments are blanked out (rather than removed) so that parse-error offsets and
 * line numbers still line up with the file on disk.
 */
export function stripJsonComments(text: string): string {
  const out: string[] = [];
  let inString = false;
  let lastComma = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    if (inString) {
      out.push(char);
      if (char === "\\") {
        // Emit the escaped character as-is so an escaped quote can't end the string
        const next = text[++i];
        if (next !== undefined) out.push(next);
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      lastComma = -1;
      out.push(char);
      continue;
    }

    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      if (i < text.length) out.push("\n");
      continue;
    }

    if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        if (text[i] === "\n") out.push("\n");
        i++;
      }
      i++; // skip the closing "/"
      continue;
    }

    if (char === ",") {
      lastComma = out.length;
      out.push(char);
      continue;
    }

    if (char === "}" || char === "]") {
      if (lastComma !== -1) out[lastComma] = " ";
      lastComma = -1;
      out.push(char);
      continue;
    }

    if (!/\s/.test(char)) lastComma = -1;
    out.push(char);
  }

  return out.join("");
}

export function parseJsonc<T>(text: string): T {
  return JSON.parse(stripJsonComments(text)) as T;
}
