import { Command } from "commander";
import { adaptersDoctorCommand, adaptersListCommand } from "./commands/adapters.js";
import { doctorCommand } from "./commands/doctor.js";
import { exportCommand } from "./commands/export.js";
import { tableCommand } from "./commands/table.js";
import { watchCommand } from "./commands/watch.js";

const program = new Command();

const addCommonOptions = (command: Command): Command =>
  command
    .option("--window <window>", "time window: 1m,5m,15m,30m,1h,12h,24h,7d,30d")
    .option("--scope <scope>", "scope: global,account,workspace,session,billing-block")
    .option("--provider <provider>", "filter by provider/adapter")
    .option("--model <model>", "filter by model id")
    .option("--account <name>", "filter by account")
    .option("--workspace <name>", "filter by workspace")
    .option("--session <id>", "filter by session")
    .option("--pricing <mode>", "pricing mode: vendor,calculated,hybrid,compare")
    .option("--timezone <tz>", "IANA timezone, default local")
    .option("--config <path>", "custom config path")
    .option("--json", "output JSON where supported")
    .option("--no-color", "disable color")
    .option("--debug", "show debug logs");

const opts = <T>(options: T, command?: Command): T =>
  (command?.opts?.() as T | undefined) ?? options;

program
  .name("runrate")
  .description("Realtime token, cache, and cost telemetry for AI coding agents.")
  .version("0.1.0");

addCommonOptions(
  program.command("watch", { isDefault: true }).description("Open the realtime TUI"),
).action(async (options, command) => {
  await watchCommand(opts(options, command));
});

addCommonOptions(program.command("table").description("Print a static table summary")).action(
  async (options, command) => {
    await tableCommand(opts(options, command));
  },
);

addCommonOptions(program.command("export").description("Export usage as JSON or NDJSON"))
  .option("--format <format>", "json or ndjson", "json")
  .option("--live", "stream updates continuously")
  .action(async (options, command) => {
    await exportCommand(opts(options, command));
  });

program
  .command("doctor")
  .description("Print environment and adapter diagnostics")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    await doctorCommand(Boolean(opts(options, command).json));
  });

const adapters = program.command("adapters").description("Inspect usage adapters");
adapters.command("list").description("List built-in adapters").action(adaptersListCommand);
adapters
  .command("doctor")
  .description("Detect local adapter sources")
  .option("--json", "output JSON")
  .action(async (options, command) => {
    await adaptersDoctorCommand(Boolean(opts(options, command).json));
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
