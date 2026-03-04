import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { commentCommand } from "./commands/comment.js";
import { completionCommand } from "./commands/completion.js";
import { initCommand } from "./commands/init.js";
import { linkCommand } from "./commands/link.js";
import { prodCommand } from "./commands/prod.js";
import { scanCommand } from "./commands/scan.js";
import { statusCommand } from "./commands/status.js";
import { testCommand } from "./commands/test.js";
import { checkForUpdates } from "./lib/updater.js";

await checkForUpdates();

const program = new Command();

program
  .name("chart-room")
  .description("CLI tool for managing Datadog dashboard sync")
  .version(pkg.version);

program.addCommand(commentCommand);
program.addCommand(completionCommand);
program.addCommand(initCommand);
program.addCommand(linkCommand);
program.addCommand(prodCommand);
program.addCommand(scanCommand);
program.addCommand(statusCommand);
program.addCommand(testCommand);

program.parse();
