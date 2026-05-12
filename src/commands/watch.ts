import { loadConfig } from "../config/loadConfig.js";
import type { PricingMode, ScopeKind } from "../core/event.js";
import { parseWindow } from "../core/windows.js";
import { runWebDashboard } from "../web/server.js";
import { resolveScope, type CommonOptions } from "./common.js";

export const watchCommand = async (options: CommonOptions): Promise<void> => {
  const config = await loadConfig(options.config);
  const window = parseWindow(config.defaultWindow);
  const pricingMode: PricingMode = options.pricing ?? config.pricingMode;
  const scope = resolveScope(
    options,
    (options.scope as ScopeKind | undefined) ?? config.defaultScope,
  );

  await runWebDashboard({
    initialWindow: window,
    initialScope: scope,
    pricingMode,
    provider: options.provider,
    model: options.model,
    timezone: options.timezone ?? config.timezone,
    port: options.port,
    host: options.host,
    open: options.open,
  });
};
