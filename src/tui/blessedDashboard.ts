import blessed from "blessed";
import contrib from "blessed-contrib";
import { collectUsageEvents } from "../adapters/registry.js";
import { aggregateEvents } from "../core/aggregate.js";
import type { ActiveScope, PricingMode, RunrateExport } from "../core/event.js";
import { formatCompact, formatUsd } from "../utils/format.js";
import { type WindowPreset, WINDOW_PRESETS } from "../core/windows.js";

type ChartMode = "tokens" | "cost" | "cache" | "sessions";

interface BlessedDashboardOptions {
  initialWindow: WindowPreset;
  initialScope: ActiveScope;
  pricingMode: PricingMode;
  provider?: string | undefined;
  model?: string | undefined;
  timezone: string;
}

const windowOrder = Object.keys(WINDOW_PRESETS) as WindowPreset[];
const fallbackWindowOrder: WindowPreset[] = ["1h", "12h", "24h", "7d", "30d"];

export const runBlessedDashboard = async (options: BlessedDashboardOptions): Promise<void> => {
  const screen = blessed.screen({
    smartCSR: true,
    fullUnicode: true,
    terminal: process.env.TERM === "xterm-256color" ? "xterm" : process.env.TERM,
    title: "Runrate",
    dockBorders: true,
  });

  const grid = new contrib.grid({
    rows: 12,
    cols: 12,
    screen,
  });

  const mainLine = grid.set(0, 0, 6, 8, contrib.line, {
    label: "tokens",
    showLegend: true,
    wholeNumbersOnly: false,
    xPadding: 2,
    xLabelPadding: 2,
    numYLabels: 5,
    style: {
      line: "green",
      text: "white",
      baseline: "black",
    },
  });

  const tokenStack = grid.set(6, 0, 3, 8, contrib.stackedBar, {
    label: "composition",
    barWidth: 4,
    barSpacing: 2,
    showLegend: true,
    showText: false,
    maxValue: 1,
    barBgColor: ["blue", "green", "magenta", "cyan"],
  }) as contrib.Widgets.StackedBarElement;

  const modelDonut = grid.set(0, 8, 4, 4, contrib.donut, {
    label: "models",
    radius: 8,
    arcWidth: 3,
    yPadding: 2,
    remainColor: "black",
  });

  const cacheGauge = grid.set(4, 8, 2, 4, contrib.gauge, {
    label: "cache",
    percent: [0],
    stroke: "cyan",
    fill: "white",
    showLabel: false,
  });

  const heatBar = grid.set(6, 8, 3, 4, contrib.bar, {
    label: "hot bins",
    barWidth: 3,
    barSpacing: 2,
    showText: false,
    maxHeight: 8,
    barBgColor: "yellow",
  });

  const sparkline = grid.set(9, 0, 2, 8, contrib.sparkline, {
    label: "rate",
    tags: true,
    style: {
      fg: "blue",
      titleFg: "green",
    },
  });

  const lcd = grid.set(9, 8, 2, 4, contrib.lcd, {
    label: "cost",
    segmentWidth: 0.06,
    segmentInterval: 0.11,
    strokeWidth: 0.11,
    elements: 8,
    color: "yellow",
  });

  const footer = blessed.box({
    bottom: 0,
    left: 0,
    height: 1,
    width: "100%",
    tags: true,
    style: {
      fg: "gray",
      bg: "black",
    },
    content: "",
  });
  screen.append(footer);
  const widgets = {
    mainLine,
    tokenStack,
    modelDonut,
    cacheGauge,
    heatBar,
    sparkline,
    lcd,
    footer,
  };

  let windowPreset = options.initialWindow;
  let chartMode: ChartMode = "tokens";
  let timer: NodeJS.Timeout | undefined;

  const refresh = async () => {
    const preset = WINDOW_PRESETS[windowPreset];
    const { events } = await collectUsageEvents({
      pricingMode: options.pricingMode,
      timezone: options.timezone,
      sinceMs: Date.now() - preset.durationMs - preset.binMs,
    });
    let activeWindow = windowPreset;
    let data = aggregateEvents(events, {
      window: windowPreset,
      scope: options.initialScope,
      pricingMode: options.pricingMode,
      provider: options.provider,
      model: options.model,
    });
    if (data.totals.totalTokens <= 0) {
      const fallback = await findPopulatedWindow(options);
      if (fallback) {
        activeWindow = fallback.window;
        data = fallback.data;
      }
    }
    renderDashboard(
      data,
      chartMode,
      widgets,
      activeWindow === windowPreset ? undefined : windowPreset,
    );
    screen.render();
  };

  const schedule = () => {
    if (timer) {
      clearInterval(timer);
    }
    timer = setInterval(() => {
      void refresh();
    }, WINDOW_PRESETS[windowPreset].pollMs);
  };

  screen.key(["q", "escape", "C-c"], () => {
    if (timer) {
      clearInterval(timer);
    }
    screen.destroy();
    process.exit(0);
  });

  screen.key(["left"], () => {
    windowPreset = shiftWindow(windowPreset, -1);
    schedule();
    void refresh();
  });

  screen.key(["right"], () => {
    windowPreset = shiftWindow(windowPreset, 1);
    schedule();
    void refresh();
  });

  screen.key(["t"], () => {
    chartMode = "tokens";
    void refresh();
  });

  screen.key(["$"], () => {
    chartMode = "cost";
    void refresh();
  });

  screen.key(["h"], () => {
    chartMode = "cache";
    void refresh();
  });

  screen.key(["a"], () => {
    chartMode = "sessions";
    void refresh();
  });

  schedule();
  renderLoadingDashboard(widgets);
  screen.render();
  await refresh();
};

const renderLoadingDashboard = (widgets: DashboardWidgets): void => {
  const labels = Array.from({ length: 24 }, (_, index) => String(index + 1));
  const pulse = labels.map((_, index) => 1 + Math.sin(index / 2) * 0.5);
  setWidgetOptions(widgets.mainLine, { label: "scanning", maxY: 2 });
  widgets.mainLine.setData([
    {
      title: "scan",
      x: labels,
      y: pulse,
      style: { line: "cyan", text: "white", baseline: "black" },
    },
  ]);
  setUntypedData(widgets.tokenStack, {
    barCategory: labels.slice(0, 12),
    stackedCategory: ["scan"],
    data: labels.slice(0, 12).map((_, index) => [1 + (index % 4)]),
  });
  setUntypedData(widgets.modelDonut, [{ label: "scan", percent: 100, color: "cyan" }]);
  widgets.cacheGauge.setPercent(1);
  widgets.heatBar.setData({ titles: labels.slice(0, 12), data: pulse.slice(0, 12) });
  widgets.sparkline.setData(["scan"], [pulse.map((value) => Math.round(value * 10))]);
  widgets.lcd.setDisplay("0.0000");
  widgets.footer.setContent(" scanning local usage  q quit");
};

type DashboardWidgets = {
  mainLine: contrib.Widgets.LineElement;
  tokenStack: contrib.Widgets.StackedBarElement;
  modelDonut: contrib.Widgets.DonutElement;
  cacheGauge: contrib.Widgets.GaugeElement;
  heatBar: contrib.Widgets.BarElement;
  sparkline: contrib.Widgets.SparklineElement;
  lcd: contrib.Widgets.LcdElement;
  footer: blessed.Widgets.BoxElement;
};

const renderDashboard = (
  data: RunrateExport,
  mode: ChartMode,
  widgets: DashboardWidgets,
  requestedWindow?: WindowPreset,
) => {
  const bins = data.bins.slice(-Math.min(data.bins.length, 72));
  const labels = bins.map((bin, index) => {
    if (index === 0 || index === bins.length - 1 || index % 12 === 0) {
      return new Date(bin.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return " ";
  });
  const primary = bins.map((bin) => valueForMode(bin, mode));
  const secondary = bins.map((bin) => bin.totals.costUsd);
  const chartLabels = labels.length ? labels : ["now"];
  const chartPrimary = primary.length ? primary : [0];
  const maxPrimary = Math.max(...chartPrimary, 1);
  setWidgetOptions(widgets.mainLine, {
    label: mode,
    maxY: maxPrimary * 1.2,
  });

  widgets.mainLine.setData([
    {
      title: mode,
      x: chartLabels,
      y: chartPrimary,
      style: { line: colorForMode(mode), text: "white", baseline: "black" },
    },
    {
      title: "$",
      x: chartLabels,
      y: normalizeAgainst(secondary.length ? secondary : [0], chartPrimary),
      style: { line: "yellow", text: "white", baseline: "black" },
    },
  ]);

  const stackBins = bins.slice(-Math.min(bins.length, 20));
  setUntypedData(widgets.tokenStack, {
    barCategory: stackBins.map((bin) =>
      new Date(bin.start).toLocaleTimeString([], { minute: "2-digit" }),
    ),
    stackedCategory: ["in", "out", "think", "cache"],
    data: stackBins.map((bin) => stackValues(bin)),
  } satisfies contrib.Widgets.StackedBarData);

  setUntypedData(
    widgets.modelDonut,
    data.models.length
      ? data.models.slice(0, 6).map((model, index) => ({
          label: shortModel(model.modelId),
          percent: percentOf(model.totals.totalTokens, data.totals.totalTokens),
          color: ["green", "cyan", "magenta", "yellow", "blue", "red"][index] ?? "white",
        }))
      : [{ label: "no data", percent: 100, color: "black" }],
  );

  widgets.cacheGauge.setPercent(Math.round((data.totals.cacheHitRatio ?? 0) * 100));
  widgets.heatBar.setData({
    titles: bins.slice(-12).map((_, index) => String(index + 1)),
    data: bins.slice(-12).map((bin) => Math.round(valueForMode(bin, mode))),
  });
  widgets.sparkline.setData(
    ["tokens", "cost"],
    [
      bins.length ? bins.map((bin) => Math.round(bin.totals.totalTokens)) : [0],
      bins.length ? bins.map((bin) => Math.round(bin.totals.costUsd * 100)) : [0],
    ],
  );
  widgets.lcd.setDisplay(formatUsd(data.totals.costUsd).replace("$", ""));
  const windowLabel = requestedWindow ? `${requestedWindow}->${data.window}` : data.window;
  widgets.footer.setContent(
    ` ${windowLabel}  ${mode}  ${formatCompact(data.totals.totalTokens)} tok  ${formatUsd(
      data.totals.costUsd,
    )}  ${data.sessions.length} sessions  ←/→ window  t/$/h/a mode  q quit`,
  );
};

const findPopulatedWindow = async (
  options: BlessedDashboardOptions,
): Promise<{ window: WindowPreset; data: RunrateExport } | null> => {
  const largest = WINDOW_PRESETS["30d"];
  const { events } = await collectUsageEvents({
    pricingMode: options.pricingMode,
    timezone: options.timezone,
    sinceMs: Date.now() - largest.durationMs - largest.binMs,
    maxFiles: 40,
    newestFirst: true,
  });

  for (const window of fallbackWindowOrder) {
    const data = aggregateEvents(events, {
      window,
      scope: options.initialScope,
      pricingMode: options.pricingMode,
      provider: options.provider,
      model: options.model,
    });
    if (data.totals.totalTokens > 0) {
      return { window, data };
    }
  }
  return null;
};

const valueForMode = (bin: RunrateExport["bins"][number], mode: ChartMode): number => {
  switch (mode) {
    case "cost":
      return bin.totals.costUsd;
    case "cache":
      return (bin.totals.cacheHitRatio ?? 0) * 100;
    case "sessions":
      return bin.totals.activeSessions;
    case "tokens":
      return bin.totals.totalTokens;
  }
};

const setUntypedData = (widget: unknown, data: unknown): void => {
  (widget as { setData(data: unknown): void }).setData(data);
};

const setWidgetOptions = (widget: unknown, options: Record<string, unknown>): void => {
  Object.assign((widget as { options: Record<string, unknown> }).options, options);
};

const stackValues = (bin: RunrateExport["bins"][number]): number[] => [
  bin.totals.inputFresh,
  bin.totals.output,
  bin.totals.reasoning,
  bin.totals.cacheRead,
];

const colorForMode = (mode: ChartMode): string => {
  switch (mode) {
    case "cost":
      return "yellow";
    case "cache":
      return "cyan";
    case "sessions":
      return "magenta";
    case "tokens":
      return "green";
  }
};

const normalizeAgainst = (values: number[], target: number[]): number[] => {
  const maxValue = Math.max(...values, 1);
  const maxTarget = Math.max(...target, 1);
  return values.map((value) => (value / maxValue) * maxTarget);
};

const percentOf = (value: number, total: number): number => {
  if (total <= 0) {
    return 0;
  }
  return Math.max(1, Math.round((value / total) * 100));
};

const shortModel = (model: string): string =>
  model
    .replace(/^gpt-/, "")
    .replace(/codex-/, "cx-")
    .slice(0, 12);

const shiftWindow = (current: WindowPreset, delta: number): WindowPreset => {
  const index = windowOrder.indexOf(current);
  const nextIndex = Math.min(windowOrder.length - 1, Math.max(0, index + delta));
  return windowOrder[nextIndex] ?? current;
};
