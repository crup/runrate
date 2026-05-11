import React, { useMemo, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { ActiveScope, PricingMode } from "../core/event.js";
import { createScope } from "../core/scope.js";
import { type WindowPreset, WINDOW_PRESETS } from "../core/windows.js";
import { FooterHelp } from "./components/FooterHelp.js";
import { Header } from "./components/Header.js";
import { MainChart } from "./components/MainChart.js";
import { SessionTable } from "./components/SessionTable.js";
import { useLiveUsage } from "./hooks/useLiveUsage.js";

const windowOrder = Object.keys(WINDOW_PRESETS) as WindowPreset[];
type ChartMode = "tokens" | "cost" | "rate" | "cache" | "sessions";

export const App = (props: {
  initialWindow: WindowPreset;
  initialScope: ActiveScope;
  pricingMode: PricingMode;
  provider?: string | undefined;
  model?: string | undefined;
  timezone: string;
  noColor: boolean;
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [window, setWindow] = useState<WindowPreset>(props.initialWindow);
  const [scope, setScope] = useState<ActiveScope>(props.initialScope);
  const [chartMode, setChartMode] = useState<ChartMode>("tokens");
  const state = useLiveUsage({
    window,
    scope,
    pricingMode: props.pricingMode,
    provider: props.provider,
    model: props.model,
    timezone: props.timezone,
  });

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      exit();
    }
    if (input === "g") {
      setScope(createScope("global"));
    }
    if (key.leftArrow) {
      setWindow(shiftWindow(window, -1));
    }
    if (key.rightArrow) {
      setWindow(shiftWindow(window, 1));
    }
    if (input === "t") {
      setChartMode("tokens");
    }
    if (input === "$") {
      setChartMode("cost");
    }
    if (input === "r") {
      setChartMode("rate");
    }
    if (input === "h") {
      setChartMode("cache");
    }
    if (input === "a") {
      setChartMode("sessions");
    }
  });

  const compact = (stdout.rows ?? 24) < 26 || (stdout.columns ?? 80) < 100;
  const width = useMemo(() => stdout.columns ?? 80, [stdout.columns]);

  if (state.error) {
    return (
      <Box flexDirection="column">
        <Text color="red">Runrate error</Text>
        <Text>{state.error}</Text>
      </Box>
    );
  }

  if (state.loading || !state.data) {
    return <Text>Loading Runrate...</Text>;
  }

  return (
    <Box flexDirection="column">
      <Header data={state.data} chartMode={chartMode} />
      <MainChart data={state.data} mode={chartMode} width={width} />
      {!compact && (
        <Box marginTop={1}>
          <Text dimColor>
            Providers:{" "}
            {state.data.providers.map((provider) => provider.provider).join(", ") || "n/a"} |
            Models: {state.data.models.map((model) => model.modelId).join(", ") || "n/a"}
          </Text>
        </Box>
      )}
      <SessionTable sessions={state.data.sessions} compact={compact} />
      <FooterHelp />
    </Box>
  );
};

const shiftWindow = (current: WindowPreset, delta: number): WindowPreset => {
  const index = windowOrder.indexOf(current);
  const nextIndex = Math.min(windowOrder.length - 1, Math.max(0, index + delta));
  return windowOrder[nextIndex] ?? current;
};
