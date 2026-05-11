import type { PricingMode, ScopeKind } from "../core/event.js";
import type { WindowPreset } from "../core/windows.js";

export interface AdapterConfig {
  enabled: boolean;
  sources: {
    label: string;
    path: string;
    account?: string | undefined;
  }[];
}

export interface RunrateConfig {
  timezone: string;
  theme: "auto" | "light" | "dark";
  pricingMode: PricingMode;
  defaultWindow: WindowPreset;
  defaultScope: ScopeKind;
  adapters: Record<string, AdapterConfig>;
}

export const defaultConfig: RunrateConfig = {
  timezone: "local",
  theme: "auto",
  pricingMode: "hybrid",
  defaultWindow: "1h",
  defaultScope: "global",
  adapters: {
    codex: {
      enabled: true,
      sources: [],
    },
    "claude-code": {
      enabled: true,
      sources: [],
    },
  },
};
