import React from "react";
import { Box, Text } from "ink";
import type { RunrateExport, UsageBin } from "../../core/event.js";
import { formatCompact, formatPercent, formatUsd } from "../../utils/format.js";

const blocks = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

export const MainChart = (props: { data: RunrateExport; mode: string; width: number }) => {
  const bins = props.data.bins.slice(-Math.max(12, Math.min(props.width - 4, 72)));
  const values = bins.map((bin) => valueForMode(bin, props.mode));
  const max = Math.max(...values, 1);
  const chart = values
    .map((value) => {
      const index = Math.min(blocks.length - 1, Math.ceil((value / max) * (blocks.length - 1)));
      return blocks[index] ?? " ";
    })
    .join("");

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1} marginTop={1}>
      <Text bold>{labelForMode(props.mode)}</Text>
      <Text color={colorForMode(props.mode)}>{chart}</Text>
      <Box>
        <Text dimColor>
          max {formatValue(max, props.mode)} | bins {bins.length} | generated{" "}
          {new Date(props.data.generatedAt).toLocaleTimeString()}
        </Text>
      </Box>
    </Box>
  );
};

const valueForMode = (bin: UsageBin, mode: string): number => {
  switch (mode) {
    case "cost":
      return bin.totals.costUsd;
    case "rate":
      return bin.totals.totalTokens;
    case "cache":
      return bin.totals.cacheHitRatio ?? 0;
    case "sessions":
      return bin.totals.activeSessions;
    case "tokens":
    default:
      return bin.totals.totalTokens;
  }
};

const labelForMode = (mode: string): string => {
  switch (mode) {
    case "cost":
      return "Cost over time";
    case "rate":
      return "Token rate";
    case "cache":
      return "Cache hit ratio";
    case "sessions":
      return "Active sessions";
    default:
      return "Token usage";
  }
};

const colorForMode = (mode: string): string => {
  switch (mode) {
    case "cost":
      return "yellow";
    case "cache":
      return "cyan";
    case "sessions":
      return "magenta";
    default:
      return "green";
  }
};

const formatValue = (value: number, mode: string): string => {
  if (mode === "cost") {
    return formatUsd(value);
  }
  if (mode === "cache") {
    return formatPercent(value);
  }
  return formatCompact(value);
};
