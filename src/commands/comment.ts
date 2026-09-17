import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";
import { Command } from "commander";
import { repositoryRoot } from "../lib/cache.js";
import { lastVerification } from "../lib/verification.js";
import { ChartRoomError } from "../lib/errors.js";
import { readObject } from "../lib/files.js";
import { dashboardUrl } from "../lib/datadog.js";
import { selectProvider } from "../providers/index.js";
import { omniUrl, validateDefinition } from "../providers/omni/definition.js";
import { output, type FileOptions } from "./omni.js";

function gh(args: string[], input?: string): string {
  try {
    return execFileSync("gh", args, {
      input,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new ChartRoomError(
      "GITHUB_ERROR",
      "GitHub comment operation failed; check gh authentication and the branch PR",
    );
  }
}
export function commentBody(
  file: string,
  provider: string,
  title: string,
  testUrl: string,
  prodUrl?: string,
) {
  const key = relative(repositoryRoot(), resolve(file));
  const marker = `<!-- chart-room:${provider}:${createHash("sha256").update(key).digest("hex").slice(0, 16)} -->`;
  const verification = lastVerification(file, provider, "test");
  const status = !verification
    ? "No local publication verification recorded."
    : `${verification.outcome} at ${verification.at}; ${verification.matchesLocalFile ? "matches this local file" : "file changed since this attempt"}; ${verification.verified ? "published readback verified" : "publication not verified"}.`;
  const safeTitle = title.replace(/[[\]\r\n]/g, " ");
  return {
    marker,
    body: `${marker}\n${provider === "datadog" ? "<!-- chart-room-test-dashboard -->\n" : ""}## ${provider === "omni" ? "Omni" : "Datadog"} dashboard preview\n\n[${safeTitle} — test](${testUrl})${prodUrl ? ` · [Production](${prodUrl})` : ""}\n\nLast local verification: ${status}\n\nDashboard links identify targets; they do not establish publication success.`,
  };
}
export const commentCommand = new Command("comment")
  .description("Upsert a provider-specific PR preview comment")
  .argument("<file>")
  .action((file: string, _options: FileOptions, command: Command) => {
    const options = command.optsWithGlobals<FileOptions>();
    const provider = selectProvider(file, options.provider);
    const value = readObject(file);
    const definition =
      provider === "omni" ? validateDefinition(value, true) : undefined;
    if (
      definition &&
      options.instance &&
      options.instance !== definition.instance
    )
      throw new ChartRoomError(
        "WRONG_INSTANCE",
        "--instance conflicts with the dashboard file",
      );
    const test =
      definition?.targets.test ||
      (value.zip_test_dashboard_id as string | undefined);
    const prod =
      definition?.targets.prod ||
      (value.zip_dashboard_id as string | undefined);
    if (!test)
      throw new ChartRoomError(
        "NOT_LINKED",
        "Link or initialize a test target first",
      );
    const url = (id: string) =>
      definition ? omniUrl(definition.instance, id) : dashboardUrl(id);
    const { marker, body } = commentBody(
      file,
      provider,
      definition?.document.name || String(value.title),
      url(test),
      prod ? url(prod) : undefined,
    );
    let pr: { number: number };
    try {
      pr = JSON.parse(gh(["pr", "view", "--json", "number"]));
    } catch {
      output(
        {
          outcome: "NO_PR",
          message: "Create a PR on the current branch first",
        },
        options,
      );
      return;
    }
    if (!Number.isInteger(pr.number))
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        "Invalid GitHub PR response",
      );
    const pages = JSON.parse(
      gh([
        "api",
        "--paginate",
        "--slurp",
        `repos/{owner}/{repo}/issues/${pr.number}/comments`,
      ]),
    );
    const existing = pages
      .flat()
      .find(
        (row: { body: string }) =>
          typeof row.body === "string" &&
          (row.body.includes(marker) ||
            (provider === "datadog" &&
              row.body.includes("<!-- chart-room-test-dashboard -->") &&
              row.body.includes(url(test)))),
      );
    const endpoint = existing
      ? `repos/{owner}/{repo}/issues/comments/${existing.id}`
      : `repos/{owner}/{repo}/issues/${pr.number}/comments`;
    gh(
      [
        "api",
        "--method",
        existing ? "PATCH" : "POST",
        endpoint,
        "--input",
        "-",
      ],
      JSON.stringify({ body }),
    );
    output(
      {
        provider,
        outcome: existing ? "COMMENT_UPDATED" : "COMMENT_CREATED",
        pr: pr.number,
      },
      options,
    );
  });
