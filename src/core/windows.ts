export type WindowPreset = keyof typeof WINDOW_PRESETS;

export const WINDOW_PRESETS = {
  "1m": {
    durationMs: 60_000,
    binMs: 1_000,
    pollMs: 1_000,
    label: "1 minute",
  },
  "5m": {
    durationMs: 5 * 60_000,
    binMs: 5_000,
    pollMs: 1_000,
    label: "5 minutes",
  },
  "15m": {
    durationMs: 15 * 60_000,
    binMs: 15_000,
    pollMs: 1_000,
    label: "15 minutes",
  },
  "30m": {
    durationMs: 30 * 60_000,
    binMs: 30_000,
    pollMs: 1_000,
    label: "30 minutes",
  },
  "1h": {
    durationMs: 60 * 60_000,
    binMs: 60_000,
    pollMs: 1_000,
    label: "1 hour",
  },
  "12h": {
    durationMs: 12 * 60 * 60_000,
    binMs: 5 * 60_000,
    pollMs: 5_000,
    label: "12 hours",
  },
  "24h": {
    durationMs: 24 * 60 * 60_000,
    binMs: 10 * 60_000,
    pollMs: 10_000,
    label: "24 hours",
  },
  "7d": {
    durationMs: 7 * 24 * 60 * 60_000,
    binMs: 60 * 60_000,
    pollMs: 30_000,
    label: "7 days",
  },
  "30d": {
    durationMs: 30 * 24 * 60 * 60_000,
    binMs: 6 * 60 * 60_000,
    pollMs: 60_000,
    label: "30 days",
  },
} as const;

export const DEFAULT_WINDOW: WindowPreset = "1h";

export const parseWindow = (value: string | undefined): WindowPreset => {
  if (value && value in WINDOW_PRESETS) {
    return value as WindowPreset;
  }
  if (!value) {
    return DEFAULT_WINDOW;
  }
  throw new Error(
    `Unsupported window "${value}". Use one of: ${Object.keys(WINDOW_PRESETS).join(", ")}`,
  );
};

export const floorToBin = (timeMs: number, binMs: number): number =>
  Math.floor(timeMs / binMs) * binMs;
