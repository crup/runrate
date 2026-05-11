import React from "react";
import { render } from "ink";
import { loadConfig } from "../config/loadConfig.js";
import type { PricingMode, ScopeKind } from "../core/event.js";
import { parseWindow } from "../core/windows.js";
import { getTerminalInfo } from "../utils/terminal.js";
import { tableCommand } from "./table.js";
import { App } from "../tui/App.js";
import { resolveScope, type CommonOptions } from "./common.js";

export const watchCommand = async (options: CommonOptions): Promise<void> => {
  const terminal = getTerminalInfo(options.noColor);
  if (!terminal.isTty || options.json) {
    await tableCommand(options);
    return;
  }

  const config = await loadConfig(options.config);
  const window = parseWindow(options.window ?? config.defaultWindow);
  const pricingMode: PricingMode = options.pricing ?? config.pricingMode;
  const scope = resolveScope(
    options,
    (options.scope as ScopeKind | undefined) ?? config.defaultScope,
  );

  render(
    React.createElement(App, {
      initialWindow: window,
      initialScope: scope,
      pricingMode,
      provider: options.provider,
      model: options.model,
      timezone: options.timezone ?? config.timezone,
      noColor: Boolean(options.noColor),
    }),
  );
};
