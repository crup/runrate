import { aggregateEvents } from "../core/aggregate.js";
import type { ActiveScope, PricingMode, RunrateExport, ScopeKind } from "../core/event.js";
import { createScope } from "../core/scope.js";
import { parseWindow, type WindowPreset, WINDOW_PRESETS } from "../core/windows.js";
import { collectUsageEvents } from "../adapters/registry.js";
import { loadConfig } from "../config/loadConfig.js";

export interface CommonOptions {
  window?: string | undefined;
  scope?: ScopeKind | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  account?: string | undefined;
  workspace?: string | undefined;
  session?: string | undefined;
  pricing?: PricingMode | undefined;
  timezone?: string | undefined;
  config?: string | undefined;
  json?: boolean | undefined;
  debug?: boolean | undefined;
  port?: string | number | undefined;
  host?: string | undefined;
  open?: boolean | undefined;
}

export const loadRunrateExport = async (options: CommonOptions): Promise<RunrateExport> => {
  const config = await loadConfig(options.config);
  const window = parseWindow(options.window ?? config.defaultWindow);
  const pricingMode = options.pricing ?? config.pricingMode;
  const timezone = options.timezone ?? config.timezone;
  const scope = resolveScope(options, config.defaultScope);
  const { events } = await collectUsageEvents({
    pricingMode,
    timezone,
    sinceMs: Date.now() - WINDOW_PRESETS[window].durationMs - WINDOW_PRESETS[window].binMs,
  });

  return aggregateEvents(events, {
    window,
    scope,
    pricingMode,
    provider: options.provider,
    model: options.model,
  });
};

export const resolveScope = (options: CommonOptions, defaultScope: ScopeKind): ActiveScope => {
  const kind = options.scope ?? defaultScope;
  const value =
    kind === "account"
      ? options.account
      : kind === "workspace"
        ? options.workspace
        : kind === "session"
          ? options.session
          : undefined;
  return createScope(kind, value);
};

export const parseWindowOption = (window: string | undefined): WindowPreset => parseWindow(window);
