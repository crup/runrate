import { loadConfig } from "./config/loadConfig.js";
import type { PricingMode, ScopeKind } from "./core/event.js";
import { createScope } from "./core/scope.js";
import { parseWindow } from "./core/windows.js";
import { runWebDashboard } from "./web/server.js";
import { VERSION } from "./version.js";

interface LauncherOptions {
  account?: string | undefined;
  config?: string | undefined;
  host?: string | undefined;
  model?: string | undefined;
  open: boolean;
  port?: string | undefined;
  pricing?: PricingMode | undefined;
  provider?: string | undefined;
  scope?: ScopeKind | undefined;
  session?: string | undefined;
  timezone?: string | undefined;
  workspace?: string | undefined;
}

const help = `Runrate

Open the local web dashboard.

Usage:
  runrate [options]
  npx @crup/runrate [options]

Options:
  --port <port>           preferred local HTTP port, default 43871
  --host <host>           local bind host, default 127.0.0.1
  --no-open               print the dashboard URL without opening a browser
  --config <path>         custom config path
  --pricing <mode>        vendor, calculated, hybrid, or compare
  --timezone <tz>         IANA timezone, default local
  --provider <provider>   initial provider filter
  --model <model>         initial model filter
  --scope <scope>         global, account, workspace, session, or billing-block
  --account <name>        scope value for account
  --workspace <name>      scope value for workspace
  --session <id>          scope value for session
  --version               print version
  --help                  print help
`;

const valueOptions = new Set([
  "account",
  "config",
  "host",
  "model",
  "port",
  "pricing",
  "provider",
  "scope",
  "session",
  "timezone",
  "workspace",
]);

const parseArgs = (argv: string[]): LauncherOptions => {
  const options: LauncherOptions = { open: true };
  const args = argv[0] === "watch" ? argv.slice(1) : argv;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(help);
      process.exit(0);
    }
    if (arg === "--version" || arg === "-v" || arg === "-V") {
      process.stdout.write(`${VERSION}\n`);
      process.exit(0);
    }
    if (arg === "--no-open") {
      options.open = false;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Runrate is web-dashboard only. Unsupported command "${arg}".`);
    }
    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey ?? "";
    if (!valueOptions.has(key)) {
      throw new Error(`Unsupported option "--${key}".`);
    }
    const value = inlineValue ?? args[++index];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for "--${key}".`);
    }
    setOption(options, key, value);
  }

  return options;
};

const setOption = (options: LauncherOptions, key: string, value: string): void => {
  switch (key) {
    case "account":
    case "config":
    case "host":
    case "model":
    case "port":
    case "provider":
    case "session":
    case "timezone":
    case "workspace":
      options[key] = value;
      return;
    case "pricing":
      if (!["vendor", "calculated", "hybrid", "compare"].includes(value)) {
        throw new Error(`Unsupported pricing mode "${value}".`);
      }
      options.pricing = value as PricingMode;
      return;
    case "scope":
      if (!["global", "account", "workspace", "session", "billing-block"].includes(value)) {
        throw new Error(`Unsupported scope "${value}".`);
      }
      options.scope = value as ScopeKind;
      return;
  }
};

const scopeValue = (options: LauncherOptions): string | undefined =>
  options.scope === "account"
    ? options.account
    : options.scope === "workspace"
      ? options.workspace
      : options.scope === "session"
        ? options.session
        : undefined;

const main = async (): Promise<void> => {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig(options.config);
  const scopeKind = options.scope ?? config.defaultScope;
  await runWebDashboard({
    initialWindow: parseWindow(config.defaultWindow),
    initialScope: createScope(scopeKind, scopeValue({ ...options, scope: scopeKind })),
    pricingMode: options.pricing ?? config.pricingMode,
    provider: options.provider,
    model: options.model,
    timezone: options.timezone ?? config.timezone,
    port: options.port,
    host: options.host,
    open: options.open,
  });
};

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exitCode = 1;
});
