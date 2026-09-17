import { Command, Option } from "commander";
import pkg from "../package.json" with { type: "json" };
import { commentCommand } from "./commands/comment.js";
import { completionCommand } from "./commands/completion.js";
import { initCommand } from "./commands/init.js";
import { linkCommand } from "./commands/link.js";
import { prodCommand } from "./commands/prod.js";
import { scanCommand } from "./commands/scan.js";
import { statusCommand } from "./commands/status.js";
import { testCommand } from "./commands/test.js";
import { ensureSchemaFile } from "./lib/schema.js";
import { checkForUpdates } from "./lib/updater.js";
import { asError, ChartRoomError } from "./lib/errors.js";
import { selectProvider } from "./providers/index.js";
import { OmniClient } from "./providers/omni/client.js";
import { INSTANCE } from "./providers/omni/definition.js";
import { discover } from "./providers/omni/discovery.js";
import {
  importOmni,
  omniFileAction,
  output,
  type FileOptions,
} from "./commands/omni.js";
import { readDashboard } from "./lib/dashboard.js";

ensureSchemaFile();

const program = new Command();

program
  .name("chart-room")
  .description("Manage paired Datadog and Omni dashboards as code")
  .addOption(
    new Option(
      "--provider <provider>",
      "Explicit provider (Datadog remains the default)",
    ).choices(["datadog", "omni"]),
  )
  .option("--profile <name>", "Official Omni CLI profile")
  .option(
    "--instance <url>",
    "Omni instance for initialization/auth/discovery (defaults to Zip)",
  )
  .addOption(
    new Option("--format <format>", "Output format")
      .choices(["human", "json"])
      .default("human"),
  )
  .version(pkg.version);

program.addCommand(commentCommand);
program.addCommand(completionCommand);
program.addCommand(initCommand);
program.addCommand(linkCommand);
program.addCommand(prodCommand);
program.addCommand(scanCommand);
program.addCommand(statusCommand);
program.addCommand(testCommand);

program
  .command("import")
  .description(
    "Adopt portable Omni v2 state and provision a separate test document",
  )
  .argument("<id>")
  .argument("<file>")
  .option("--test-folder <id>", "Explicit folder for the new preview document")
  .action((id: string, file: string, _options: FileOptions, command: Command) =>
    output(
      importOmni(id, file, command.optsWithGlobals<FileOptions>()),
      command.optsWithGlobals<FileOptions>(),
    ),
  );

program
  .command("validate")
  .description("Validate locally; opt in to remote model and query checks")
  .argument("<file>")
  .option("--remote", "Check the model and query plans with Omni")
  .action(async (file: string, _options: FileOptions, command: Command) => {
    const options = command.optsWithGlobals<FileOptions>();
    if (omniFileAction("validate", file, options)) return;
    if (options.remote)
      throw new ChartRoomError(
        "UNSUPPORTED_COMMAND",
        "Remote validation is currently provided for Omni",
      );
    const { validateDatadog } = await import("./providers/datadog.js");
    validateDatadog(readDashboard(file));
    output(
      { provider: "datadog", outcome: "VALIDATED", remote: false },
      options,
    );
  });

const auth = program
  .command("auth")
  .description("Use official Omni authentication and storage");
for (const name of ["login", "status"]) {
  auth
    .command(name)
    .option("--model <id>", "Check permissions on this shared model")
    .action((_opts: FileOptions, command: Command) => {
      const options = command.optsWithGlobals<FileOptions>();
      if (options.provider !== "omni")
        throw new ChartRoomError(
          "INVALID_PROVIDER",
          "Use auth with --provider omni",
        );
      const client = new OmniClient(
        options.instance || INSTANCE,
        options.profile,
      );
      if (name === "login") {
        client.login();
        return;
      }
      output(
        {
          provider: "omni",
          instance: client.instance,
          authenticated: true,
          identity: client.identity(options.model),
        },
        options,
      );
    });
}
const omni = program
  .command("omni")
  .description(
    "Discover shared models, topics and fields using the official CLI",
  );
for (const name of ["models", "topics", "fields"] as const) {
  const command = omni
    .command(name)
    .option("--refresh", "Refresh the local authoring completion catalog");
  if (name !== "models")
    command.requiredOption("--model <id>", "Existing shared model");
  if (name === "fields") command.requiredOption("--topic <name>", "Topic name");
  command.action((_opts, command: Command) => {
    const options = command.optsWithGlobals<
      FileOptions & { topic?: string; refresh?: boolean }
    >();
    if (options.provider && options.provider !== "omni")
      throw new ChartRoomError(
        "PROVIDER_MISMATCH",
        "omni discovery conflicts with --provider datadog",
      );
    output(
      discover(
        new OmniClient(options.instance || INSTANCE, options.profile),
        name,
        options.model,
        options.topic,
        options.refresh,
      ),
      options,
    );
  });
}

// Validate routing before even the optional update checker can touch the network.
program.hook("preAction", async (_root, command) => {
  const name = command.name();
  if (
    command.parent === program &&
    ["init", "link", "test", "prod", "status", "comment", "validate"].includes(
      name,
    )
  ) {
    const options = command.optsWithGlobals<FileOptions>();
    const provider = selectProvider(
      command.args[0]!,
      options.provider,
      name === "init",
    );
    if (
      provider === "datadog" &&
      name !== "validate" &&
      options.format !== "json" &&
      !process.env.CHART_ROOM_NO_UPDATE
    )
      await checkForUpdates();
  }
});

try {
  await program.parseAsync();
} catch (error) {
  const failure = asError(error);
  if (
    process.argv.includes("--json") ||
    process.argv.includes("json") ||
    process.argv.includes("--format=json")
  )
    console.error(JSON.stringify({ error: failure.toJSON() }));
  else console.error(`${failure.code}: ${failure.message}`);
  process.exitCode = 1;
}
