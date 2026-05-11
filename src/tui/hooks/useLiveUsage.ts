import { useEffect, useState } from "react";
import { collectUsageEvents } from "../../adapters/registry.js";
import { aggregateEvents } from "../../core/aggregate.js";
import type { ActiveScope, PricingMode, RunrateExport } from "../../core/event.js";
import { WINDOW_PRESETS, type WindowPreset } from "../../core/windows.js";

export interface LiveUsageState {
  data: RunrateExport | null;
  loading: boolean;
  error: string | null;
}

export const useLiveUsage = (args: {
  window: WindowPreset;
  scope: ActiveScope;
  pricingMode: PricingMode;
  provider?: string | undefined;
  model?: string | undefined;
  timezone: string;
}): LiveUsageState => {
  const [state, setState] = useState<LiveUsageState>({
    data: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const { events } = await collectUsageEvents({
          pricingMode: args.pricingMode,
          timezone: args.timezone,
          sinceMs:
            Date.now() - WINDOW_PRESETS[args.window].durationMs - WINDOW_PRESETS[args.window].binMs,
        });
        const data = aggregateEvents(events, {
          window: args.window,
          scope: args.scope,
          pricingMode: args.pricingMode,
          provider: args.provider,
          model: args.model,
        });
        if (!cancelled) {
          setState({
            data,
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState((previous) => ({
            ...previous,
            loading: false,
            error: (error as Error).message,
          }));
        }
      }
    };

    void refresh();
    const interval = setInterval(refresh, WINDOW_PRESETS[args.window].pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [args.window, args.scope, args.pricingMode, args.provider, args.model, args.timezone]);

  return state;
};
