import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { linkCommand } from "./commands/link.js";
import { statusCommand } from "./commands/status.js";
import { testCommand } from "./commands/test.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
const program = new Command();
program
    .name("chart-room")
    .description("CLI tool for managing Datadog dashboard sync")
    .version(pkg.version);
program.addCommand(initCommand);
program.addCommand(linkCommand);
program.addCommand(statusCommand);
program.addCommand(testCommand);
program.parse();
