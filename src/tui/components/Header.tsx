import React from "react";
import { Box, Text } from "ink";
import type { RunrateExport } from "../../core/event.js";
import { formatAge, formatCompact, formatPercent, formatUsd } from "../../utils/format.js";
import { MetricCard } from "./MetricCard.js";

export const Header = (props: { data: RunrateExport; chartMode: string }) => (
  <Box flexDirection="column" borderStyle="round" paddingX={1}>
    <Box>
      <Text bold color="green">
        Runrate
      </Text>
      <Text dimColor>
        {" "}
        scope: {props.data.scope.label} | window: {props.data.window} | live | pricing:{" "}
        {props.data.pricingMode} | chart: {props.chartMode}
      </Text>
    </Box>
    <Box marginTop={1}>
      <MetricCard label="Cost" value={formatUsd(props.data.totals.costUsd)} color="yellow" />
      <MetricCard
        label="Tokens"
        value={formatCompact(props.data.totals.totalTokens)}
        color="green"
      />
      <MetricCard label="Input" value={formatCompact(props.data.totals.inputFresh)} color="blue" />
      <MetricCard label="Output" value={formatCompact(props.data.totals.output)} color="green" />
      <MetricCard
        label="Reasoning"
        value={props.data.totals.reasoning ? formatCompact(props.data.totals.reasoning) : "n/a"}
        color="magenta"
      />
      <MetricCard
        label="Cache hit"
        value={formatPercent(props.data.totals.cacheHitRatio)}
        color="cyan"
      />
      <MetricCard label="Sessions" value={String(props.data.totals.activeSessions)} />
      <MetricCard label="Last" value={formatAge(props.data.totals.lastActivityAt)} />
    </Box>
  </Box>
);
