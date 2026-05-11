import type { SessionSummary, UsageTotals } from "../core/event.js";

export const formatInteger = (value: number): string =>
  new Intl.NumberFormat("en", {
    maximumFractionDigits: 0,
  }).format(Math.round(value));

export const formatCompact = (value: number): string =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);

export const formatUsd = (value: number): string =>
  `$${value.toLocaleString("en", {
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 4,
  })}`;

export const formatPercent = (value: number | null): string =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;

export const formatAge = (iso: string | null, now = new Date()): string => {
  if (!iso) {
    return "n/a";
  }
  const diffMs = Math.max(0, now.getTime() - Date.parse(iso));
  if (diffMs < 60_000) {
    return `${Math.round(diffMs / 1000)}s ago`;
  }
  if (diffMs < 60 * 60_000) {
    return `${Math.round(diffMs / 60_000)}m ago`;
  }
  if (diffMs < 24 * 60 * 60_000) {
    return `${Math.round(diffMs / (60 * 60_000))}h ago`;
  }
  return `${Math.round(diffMs / (24 * 60 * 60_000))}d ago`;
};

export const summarizeModels = (models: string[]): string => {
  if (models.length === 0) {
    return "n/a";
  }
  if (models.length <= 2) {
    return models.join(", ");
  }
  return `${models.slice(0, 2).join(", ")} +${models.length - 2}`;
};

export const formatTotalsLine = (totals: UsageTotals): string =>
  [
    `cost ${formatUsd(totals.costUsd)}`,
    `tokens ${formatCompact(totals.totalTokens)}`,
    `input ${formatCompact(totals.inputFresh)}`,
    `output ${formatCompact(totals.output)}`,
    `reasoning ${totals.reasoning ? formatCompact(totals.reasoning) : "n/a"}`,
    `cache ${formatPercent(totals.cacheHitRatio)}`,
    `sessions ${totals.activeSessions}`,
    `last ${formatAge(totals.lastActivityAt)}`,
  ].join("  ");

export const sessionToRow = (session: SessionSummary): string[] => [
  new Date(session.lastActivityAt).toLocaleString(),
  session.workspaceLabel ?? session.workspaceId ?? "n/a",
  shortId(session.nativeSessionId),
  summarizeModels(session.models),
  formatCompact(session.totals.inputFresh),
  formatCompact(session.totals.output),
  session.totals.reasoning ? formatCompact(session.totals.reasoning) : "n/a",
  session.totals.cacheRead ? formatCompact(session.totals.cacheRead) : "n/a",
  formatUsd(session.totals.costUsd),
  session.state,
];

export const shortId = (value: string, length = 8): string =>
  value.length <= length ? value : value.slice(0, length);

export const renderTable = (headers: string[], rows: string[][]): string => {
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const renderRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join("  ");

  return [
    renderRow(headers),
    renderRow(headers.map((header) => "-".repeat(header.length))),
    ...rows.map(renderRow),
  ].join("\n");
};
