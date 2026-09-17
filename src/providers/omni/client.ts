import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ChartRoomError, object } from "../../lib/errors.js";
import { documentPage, folderPage } from "./responses.js";
import {
  assertNative,
  identifier,
  INSTANCE,
  type NativeObject,
  type RemoteDocument,
} from "./definition.js";

export const OMNI_CLI_VERSION = "1.3.1";
export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: { code?: string };
}
export type Runner = (
  executable: string,
  args: string[],
  input?: string,
  interactive?: boolean,
) => RunResult;
export const runProcess: Runner = (executable, args, input, interactive) => {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    input,
    timeout: interactive ? undefined : 120_000,
    maxBuffer: 32 * 1024 * 1024,
    stdio: interactive ? "inherit" : "pipe",
    env: { ...process.env, OMNI_NO_UPDATE_NOTIFIER: "1" },
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error as NodeJS.ErrnoException | undefined,
  };
};

export function officialConfigPath(env = process.env): string {
  return (
    env.OMNI_CONFIG_PATH ||
    join(
      env.OMNI_CONFIG_DIR ||
        join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "omni-cli"),
      "config.json",
    )
  );
}

export function assertCredentials(
  instance: string,
  profile?: string,
  env = process.env,
): void {
  let selected: NativeObject | undefined;
  const path = officialConfigPath(env);
  if (existsSync(path)) {
    let config: NativeObject;
    try {
      config = object(
        JSON.parse(readFileSync(path, "utf8")),
        "Official Omni configuration",
      );
    } catch {
      throw new ChartRoomError(
        "INVALID_CONFIG",
        "Cannot read official Omni configuration; repair it with omni config init",
      );
    }
    const name = profile || config.defaultProfile;
    if (name) {
      const profiles = object(config.profiles, "Official Omni profiles");
      if (typeof name !== "string" || !Object.hasOwn(profiles, name))
        throw new ChartRoomError(
          "MISSING_CREDENTIALS",
          "Selected official Omni profile does not exist; run chart-room auth login --provider omni",
        );
      selected = object(profiles[name], "Official Omni profile");
      if (
        typeof selected.apiEndpoint !== "string" ||
        selected.apiEndpoint.replace(/\/$/, "") !== instance
      )
        throw new ChartRoomError(
          "WRONG_INSTANCE",
          "Selected Omni profile points to a different instance; no credential was forwarded",
        );
    }
  } else if (profile)
    throw new ChartRoomError(
      "MISSING_CREDENTIALS",
      "Selected official Omni profile does not exist; run chart-room auth login --provider omni",
    );
  if (env.OMNI_BASE_URL && env.OMNI_BASE_URL.replace(/\/$/, "") !== instance)
    throw new ChartRoomError(
      "WRONG_INSTANCE",
      "OMNI_BASE_URL conflicts with the dashboard instance; no credential was forwarded",
    );
  if (
    !env.OMNI_API_TOKEN &&
    !(selected?.apiKey || selected?.accessToken || selected?.refreshToken)
  )
    throw new ChartRoomError(
      "MISSING_CREDENTIALS",
      "No Omni credential configured. Run chart-room auth login --provider omni, or set OMNI_API_TOKEN securely",
    );
}

export function transportError(
  result: RunResult,
  command: string,
  write = false,
): ChartRoomError {
  if (result.error?.code === "ENOENT")
    return new ChartRoomError(
      "MISSING_CLI",
      `Install the official Omni CLI ${OMNI_CLI_VERSION}; omni was not found on PATH`,
    );
  const ambiguous = write
    ? " Inspect remote state before retrying; this write may have succeeded."
    : "";
  if (result.error?.code === "ETIMEDOUT")
    return new ChartRoomError(
      "TIMEOUT",
      `Omni ${command} timed out.${ambiguous}`,
      { ambiguous: write },
    );
  let status: unknown;
  try {
    status = object(JSON.parse(result.stderr), "error").status;
  } catch {
    /* Never expose raw stderr. */
  }
  const text = result.stderr;
  let code = "NETWORK";
  let message = "Omni transport failed; check network connectivity";
  if (/unknown command|unknown flag/.test(text)) {
    code = "UNSUPPORTED_CLI";
    message = `Official Omni CLI ${OMNI_CLI_VERSION} is required`;
  } else if (/no API token configured|profile .*not found/.test(text)) {
    code = "MISSING_CREDENTIALS";
    message = "Official Omni credentials are missing";
  } else if (
    /require.{0,40}pull request|pull request.{0,40}required|REQUIRES?_PR|requiresPullRequest/i.test(
      text,
    )
  ) {
    code = "PR_REQUIRED";
    message =
      "This target requires an Omni pull request; use the native branch workflow without changing its policy";
  } else if (status === 401) {
    code = "UNAUTHENTICATED";
    message = "Omni rejected the credential; refresh the official profile";
  } else if (status === 403) {
    code = "PERMISSION_DENIED";
    message = "Omni denied access to this resource";
  } else if (status === 404 && /Document has been archived/.test(text)) {
    code = "TARGET_ARCHIVED";
    message =
      "Omni target is archived. Restore it in Omni before retrying; its identifier remains reserved";
  } else if (status === 404) {
    code = "NOT_FOUND";
    message = "Omni target was not found or is not visible to this identity";
  } else if (
    status === 409 ||
    (status === 400 && /Identifier .{1,100} is already in use/.test(text))
  ) {
    code = "CONFLICT";
    message =
      "Omni reported a draft or identifier conflict; inspect the target";
  } else if (status === 429) {
    code = "RATE_LIMITED";
    message = "Omni rate limit reached; retry after the server cooldown";
  } else if (typeof status === "number") {
    code = "API_ERROR";
    message = `Omni rejected ${command} (HTTP ${status})`;
  }
  const uncertain =
    write &&
    (status === undefined || (typeof status === "number" && status >= 500));
  return new ChartRoomError(code, message + (uncertain ? ambiguous : ""), {
    ...(typeof status === "number" ? { status } : {}),
    ambiguous: uncertain,
  });
}

export class OmniClient {
  private checked = false;
  constructor(
    public instance = INSTANCE,
    public profile?: string,
    private runner: Runner = runProcess,
    private credentialCheck = assertCredentials,
    private executable = process.env.CHART_ROOM_OMNI_BIN || "omni",
  ) {
    if (instance !== INSTANCE)
      throw new ChartRoomError(
        "WRONG_INSTANCE",
        `Contract v1 for Evergreen requires ${INSTANCE}`,
      );
  }
  capabilities(): void {
    if (this.checked) return;
    const version = this.runner(this.executable, ["--version"]);
    if (version.status !== 0) throw transportError(version, "version");
    if (version.stdout.trim() !== `omni version ${OMNI_CLI_VERSION}`)
      throw new ChartRoomError(
        "UNSUPPORTED_CLI",
        `Use official Omni CLI ${OMNI_CLI_VERSION}; other versions have not passed the contract gates`,
      );
    const help = this.runner(this.executable, ["documents", "--help"]);
    if (help.status !== 0) throw transportError(help, "help");
    for (const command of [
      "v2-create",
      "v2-get",
      "list-drafts",
      "v2-patch-draft",
      "v2-patch-draft-by-identifier",
      "v2-get-draft",
      "v2-publish-draft",
    ]) {
      if (!help.stdout.split(/\s+/).includes(command))
        throw new ChartRoomError(
          "UNSUPPORTED_CLI",
          `Official Omni CLI is missing documents ${command}`,
        );
    }
    this.checked = true;
  }
  call(
    group: string,
    command: string,
    args: string[] = [],
    body?: NativeObject,
    options: { write?: boolean; stream?: boolean } = {},
  ): unknown {
    this.capabilities();
    this.credentialCheck(this.instance, this.profile);
    const argv = [
      "--base-url",
      this.instance,
      "--format",
      "json",
      ...(this.profile ? ["--profile", this.profile] : []),
      group,
      command,
      ...args,
    ];
    if (body !== undefined) argv.push("--body", "-");
    const result = this.runner(
      this.executable,
      argv,
      body === undefined ? undefined : JSON.stringify(body),
    );
    if (result.status !== 0)
      throw transportError(result, `${group} ${command}`, options.write);
    try {
      return options.stream
        ? result.stdout
            .trim()
            .split(/\r?\n/)
            .map((line) => JSON.parse(line))
        : JSON.parse(result.stdout);
    } catch {
      throw new ChartRoomError(
        "INVALID_RESPONSE",
        `Omni ${group} ${command} returned malformed JSON${options.write ? "; inspect remote state before retrying" : ""}`,
        { ambiguous: Boolean(options.write) },
      );
    }
  }
  documents(
    command: string,
    args: string[] = [],
    body?: NativeObject,
    write = false,
  ): unknown {
    const response = this.call("documents", command, args, body, { write });
    const schema =
      command === "v2-create"
        ? "DocumentsV2CreateResponse"
        : command === "v2-publish-draft"
          ? "DocumentsV2PublishDraftResponse"
          : ["v2-patch-draft", "v2-patch-draft-by-identifier"].includes(command)
            ? "DocumentsV2PatchDraftResponse"
            : undefined;
    if (schema) {
      try {
        assertNative(schema, response);
      } catch (error) {
        if (error instanceof ChartRoomError && write)
          throw new ChartRoomError(
            error.code,
            `${error.message}; inspect remote state before retrying`,
            { ambiguous: true },
          );
        throw error;
      }
    }
    return response;
  }
  read(id: string, draft?: string): RemoteDocument {
    const response = this.documents(draft ? "v2-get-draft" : "v2-get", [
      identifier(id),
      ...(draft ? [identifier(draft)] : []),
    ]);
    assertNative("DocumentsV2ReadResponse", response);
    const data = response as RemoteDocument;
    if (!data.controls || !data.settings || !data.containers?.length)
      throw new ChartRoomError(
        "UNSUPPORTED_RESOURCE",
        "Target is not a dashboard with explicit controls, settings and layout",
      );
    return data;
  }
  mainDrafts(id: string): NativeObject[] {
    const response = this.documents("list-drafts", [identifier(id)]);
    assertNative("DocumentsListDraftsResponse", response);
    return (response as NativeObject[]).filter((draft) => {
      if (!Object.hasOwn(draft, "branch"))
        throw new ChartRoomError(
          "INVALID_RESPONSE",
          "Draft response is missing branch context",
        );
      return draft.branch === null;
    });
  }
  publicationPolicy(id: string): { requiresPullRequest: boolean } {
    const response = this.documents("get-permissions", [identifier(id)]);
    assertNative("DocumentsGetPermissionsResponse", response);
    return {
      requiresPullRequest:
        object(object(response, "permissions").abilities, "abilities")
          .requirePullRequestToPublish === true,
    };
  }
  pages(
    group: string,
    command: string,
    schemaName: string,
    args: string[] = [],
  ): NativeObject[] {
    const records: NativeObject[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      let response = this.call(group, command, [
        ...args,
        "--page-size",
        "100",
        ...(cursor ? ["--cursor", cursor] : []),
      ]);
      if (schemaName === "FoldersListResponse") response = folderPage(response);
      if (schemaName === "DocumentsListResponse")
        response = documentPage(response);
      assertNative(schemaName, response);
      const page = object(response, "page");
      records.push(...(page.records as NativeObject[]));
      const info = object(page.pageInfo, "pageInfo");
      if (info.hasNextPage !== true) return records;
      if (
        typeof info.nextCursor !== "string" ||
        !info.nextCursor ||
        seen.has(info.nextCursor)
      )
        throw new ChartRoomError(
          "INVALID_RESPONSE",
          "Invalid or repeated Omni pagination cursor",
        );
      cursor = info.nextCursor;
      seen.add(cursor);
    } while (cursor);
    return records;
  }
  identity(model?: string): NativeObject {
    const response = this.call(
      "whoami",
      "whoami",
      model ? ["--model-id", identifier(model)] : [],
    );
    assertNative("WhoamiResponse", response);
    const identity = response as NativeObject;
    if (
      model &&
      !Object.hasOwn(object(identity.rolesByModel, "model permissions"), model)
    )
      throw new ChartRoomError(
        "PERMISSION_DENIED",
        "Omni identity has no resolved permissions for the selected model",
      );
    return identity;
  }
  login(): void {
    this.capabilities();
    const result = this.runner(
      this.executable,
      [
        "config",
        "init",
        "--endpoint",
        this.instance,
        ...(this.profile ? ["--name", this.profile] : []),
      ],
      undefined,
      true,
    );
    if (result.status !== 0) throw transportError(result, "config init");
  }
}
