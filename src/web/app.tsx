import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";

type ChartMode = "tokens" | "cost" | "cache" | "sessions";
type PeriodPreset =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "all-time";
type PlotPreset = "auto" | "1m" | "5m" | "15m" | "1h" | "1d";

interface UsageTotals {
  inputFresh: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costUsd: number;
  cacheHitRatio: number | null;
  activeSessions: number;
  lastActivityAt: string | null;
}

interface UsageBin {
  start: string;
  end: string;
  totals: UsageTotals;
}

interface ModelBreakdown {
  provider: string;
  modelId: string;
  modelDisplayName?: string | undefined;
  totals: UsageTotals;
}

interface SessionSummary {
  provider: string;
  nativeSessionId: string;
  workspaceId?: string | undefined;
  workspaceLabel?: string | undefined;
  models: string[];
  totals: UsageTotals;
  firstActivityAt: string;
  lastActivityAt: string;
  state: "active" | "idle" | "stale" | "closed";
}

interface ProviderSummary {
  provider: string;
  totals: UsageTotals;
}

interface RunrateExport {
  generatedAt: string;
  window: string;
  scope: { kind: string; value?: string | undefined; label: string };
  pricingMode: string;
  totals: UsageTotals;
  bins: UsageBin[];
  sessions: SessionSummary[];
  models: ModelBreakdown[];
  providers: ProviderSummary[];
}

interface UsageResponse {
  period: { value: PeriodPreset; label: string };
  plot: { value: PlotPreset; label: string; binMs: number | null };
  periods: Array<{ value: PeriodPreset; label: string }>;
  plots: Array<{ value: PlotPreset; label: string; binMs: number | null }>;
  compare?: {
    period: { value: PeriodPreset; label: string };
    data: RunrateExport;
  };
  pollMs: number;
  generatedAt: string;
  data: RunrateExport;
}

const modeLabels: Record<ChartMode, string> = {
  tokens: "Tokens",
  cost: "Cost",
  cache: "Cache",
  sessions: "Sessions",
};

const colors = ["#2f8c5f", "#2f6fbb", "#c55f2d", "#7b5ac7", "#c13f5a", "#287f8f"];

const App = () => {
  const [mode, setMode] = useState<ChartMode>("tokens");
  const [period, setPeriod] = useState<PeriodPreset>("today");
  const [plot, setPlot] = useState<PlotPreset>("auto");
  const [compare, setCompare] = useState(false);
  const [response, setResponse] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (period === "all-time") {
      setCompare(false);
    }
  }, [period]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = async () => {
      try {
        const params = new URLSearchParams({
          period,
          plot,
          compare: compare ? "1" : "0",
        });
        const result = await fetch(`/api/usage?${params.toString()}`, { cache: "no-store" });
        if (!result.ok) {
          throw new Error(await result.text());
        }
        const next = (await result.json()) as UsageResponse;
        if (!alive) {
          return;
        }
        setResponse(next);
        setError(null);
        setLoading(false);
        window.clearTimeout(timer);
        timer = window.setTimeout(load, Math.max(1500, next.pollMs));
      } catch (loadError) {
        if (!alive) {
          return;
        }
        setError((loadError as Error).message);
        setLoading(false);
        timer = window.setTimeout(load, 3000);
      }
    };

    setLoading(true);
    void load();

    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [period, plot, compare]);

  const data = response?.data;
  const bins = useMemo(() => data?.bins ?? [], [data]);
  const compareBins = useMemo(() => response?.compare?.data.bins ?? [], [response]);

  return (
    <>
      <style>{styles}</style>
      <main className="app-shell">
        <header className="topbar">
          <div>
            <p className="eyebrow">local telemetry</p>
            <h1>Runrate</h1>
          </div>
          <div className="status-row">
            <span className={error ? "status status-error" : "status"}>
              {error ? "API error" : loading ? "Scanning" : "Live"}
            </span>
            <span className="updated">
              {data?.generatedAt ? timeAgo(data.generatedAt) : "waiting"}
            </span>
          </div>
        </header>

        <section className="toolbar" aria-label="Dashboard controls">
          <div className="segmented period-tabs">
            {(response?.periods ?? defaultPeriods).map((item) => (
              <button
                className={item.value === period ? "active" : ""}
                key={item.value}
                onClick={() => setPeriod(item.value)}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="toolbar-right">
            <div className="segmented plot-tabs">
              {(response?.plots ?? defaultPlots).map((item) => (
                <button
                  className={item.value === plot ? "active" : ""}
                  key={item.value}
                  onClick={() => setPlot(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
            <button
              className={compare ? "compare-toggle active" : "compare-toggle"}
              disabled={period === "all-time"}
              onClick={() => setCompare((value) => !value)}
              type="button"
            >
              Compare
            </button>
          </div>
        </section>

        <section className="toolbar mode-toolbar" aria-label="Metric controls">
          <div className="segmented mode-tabs">
            {(Object.keys(modeLabels) as ChartMode[]).map((item) => (
              <button
                className={item === mode ? "active" : ""}
                key={item}
                onClick={() => setMode(item)}
                type="button"
              >
                {modeLabels[item]}
              </button>
            ))}
          </div>
        </section>

        {error ? <div className="notice">{error}</div> : null}

        <section className="metrics" aria-label="Summary">
          <Metric
            label="Total tokens"
            value={formatCompact(data?.totals.totalTokens)}
            accent="green"
          />
          <Metric label="Cost" value={formatUsd(data?.totals.costUsd)} accent="orange" />
          <Metric
            label="Cache hit"
            value={formatPercent(data?.totals.cacheHitRatio)}
            accent="blue"
          />
          <Metric
            label="Sessions"
            value={String(data?.totals.activeSessions ?? "--")}
            accent="purple"
          />
          <Metric label="Models" value={String(data?.models.length ?? "--")} accent="red" />
        </section>

        <section className="dashboard-grid">
          <div className="panel trend-panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">trend</p>
                <h2>
                  {modeLabels[mode]} in {response?.period.label ?? "Today"}
                </h2>
              </div>
              <span className="pill">{response?.plot.label ?? "Auto"}</span>
            </div>
            <TrendChart
              bins={bins}
              compareBins={compareBins}
              compareLabel={response?.compare?.period.label}
              mode={mode}
            />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">models</p>
                <h2>Usage mix</h2>
              </div>
            </div>
            <DonutChart models={data?.models ?? []} total={data?.totals.totalTokens ?? 0} />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">tokens</p>
                <h2>Composition</h2>
              </div>
            </div>
            <TokenMix totals={data?.totals} />
          </div>

          <div className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">providers</p>
                <h2>Sources</h2>
              </div>
            </div>
            <ProviderList providers={data?.providers ?? []} />
          </div>
        </section>

        <section className="table-section">
          <div className="table-head">
            <div>
              <p className="eyebrow">sessions</p>
              <h2>Recent activity</h2>
            </div>
            <span className="pill">{data?.scope.label ?? "global"}</span>
          </div>
          <SessionTable sessions={data?.sessions ?? []} />
        </section>
      </main>
    </>
  );
};

const Metric = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
  <div className={`metric metric-${accent}`}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const TrendChart = ({
  bins,
  compareBins,
  compareLabel,
  mode,
}: {
  bins: UsageBin[];
  compareBins: UsageBin[];
  compareLabel: string | undefined;
  mode: ChartMode;
}) => {
  const values = bins.map((bin) => valueForMode(bin, mode));
  const compareValues = compareBins.map((bin) => valueForMode(bin, mode));
  const max = Math.max(...values, ...compareValues, 1);
  const width = 960;
  const height = 320;
  const padding = { top: 24, right: 18, bottom: 36, left: 54 };
  const toPoints = (series: number[]) =>
    series.map((value, index) => {
      const x =
        padding.left +
        (index / Math.max(series.length - 1, 1)) * (width - padding.left - padding.right);
      const y = padding.top + (1 - value / max) * (height - padding.top - padding.bottom);
      return [x, y] as const;
    });
  const points = toPoints(values);
  const comparePoints = toPoints(compareValues);
  const toPath = (seriesPoints: Array<readonly [number, number]>) =>
    seriesPoints
      .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(" ");
  const path = toPath(points);
  const comparePath = toPath(comparePoints);
  const area = path
    ? `${path} L ${width - padding.right} ${height - padding.bottom} L ${padding.left} ${height - padding.bottom} Z`
    : "";
  const labels = labelTicks(bins);

  return (
    <div className="trend-wrap">
      <svg
        className="trend-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${modeLabels[mode]} trend chart`}
      >
        <defs>
          <linearGradient id="area-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2f8c5f" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#2f8c5f" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = padding.top + tick * (height - padding.top - padding.bottom);
          return (
            <line
              className="grid-line"
              key={tick}
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
            />
          );
        })}
        {area ? <path className="area-path" d={area} /> : null}
        {comparePath ? <path className="compare-path" d={comparePath} /> : null}
        {path ? <path className="line-path" d={path} /> : null}
        {points.slice(-1).map(([x, y]) => (
          <circle className="last-point" cx={x} cy={y} key="last" r="5" />
        ))}
        <text className="axis-label" x="10" y="30">
          {formatAxis(max, mode)}
        </text>
        {labels.map((label) => (
          <text className="time-label" key={label.x} x={label.x} y={height - 10}>
            {label.text}
          </text>
        ))}
      </svg>
      {compareLabel ? (
        <div className="chart-legend">
          <span className="legend-current" />
          <p>{bins.length ? "Selected period" : "No selected data"}</p>
          <span className="legend-compare" />
          <p>{compareLabel}</p>
        </div>
      ) : null}
    </div>
  );
};

const DonutChart = ({ models, total }: { models: ModelBreakdown[]; total: number }) => {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const topModels = models.slice(0, 6);

  return (
    <div className="donut-wrap">
      <svg className="donut" viewBox="0 0 120 120" aria-label="Model share">
        <circle className="donut-track" cx="60" cy="60" r={radius} />
        {topModels.map((model, index) => {
          const share = total > 0 ? model.totals.totalTokens / total : 0;
          const dash = Math.max(0, share * circumference);
          const circle = (
            <circle
              className="donut-segment"
              cx="60"
              cy="60"
              key={model.modelId}
              r={radius}
              stroke={colors[index] ?? colors[0]}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return circle;
        })}
        <text className="donut-total" x="60" y="57">
          {models.length}
        </text>
        <text className="donut-caption" x="60" y="72">
          models
        </text>
      </svg>
      <div className="legend-list">
        {topModels.length ? (
          topModels.map((model, index) => (
            <div className="legend-item" key={model.modelId}>
              <span style={{ background: colors[index] ?? colors[0] }} />
              <p>{shortModel(model.modelId)}</p>
              <strong>{formatCompact(model.totals.totalTokens)}</strong>
            </div>
          ))
        ) : (
          <p className="empty">No usage found in this window.</p>
        )}
      </div>
    </div>
  );
};

const TokenMix = ({ totals }: { totals: UsageTotals | undefined }) => {
  const segments = [
    { label: "Input", value: totals?.inputFresh ?? 0, color: "#2f6fbb" },
    { label: "Output", value: totals?.output ?? 0, color: "#2f8c5f" },
    { label: "Reasoning", value: totals?.reasoning ?? 0, color: "#7b5ac7" },
    { label: "Cache read", value: totals?.cacheRead ?? 0, color: "#c55f2d" },
    { label: "Cache write", value: totals?.cacheWrite ?? 0, color: "#c13f5a" },
  ];
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="mix">
      <div className="stacked">
        {segments.map((segment) => (
          <span
            key={segment.label}
            style={{
              background: segment.color,
              width: `${total > 0 ? Math.max(2, (segment.value / total) * 100) : 0}%`,
            }}
          />
        ))}
      </div>
      <div className="mix-list">
        {segments.map((segment) => (
          <div key={segment.label}>
            <span style={{ background: segment.color }} />
            <p>{segment.label}</p>
            <strong>{formatCompact(segment.value)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
};

const ProviderList = ({ providers }: { providers: ProviderSummary[] }) => (
  <div className="provider-list">
    {providers.length ? (
      providers.map((provider) => (
        <div key={provider.provider}>
          <p>{provider.provider}</p>
          <strong>{formatCompact(provider.totals.totalTokens)}</strong>
          <span>{formatUsd(provider.totals.costUsd)}</span>
        </div>
      ))
    ) : (
      <p className="empty">No providers detected.</p>
    )}
  </div>
);

const SessionTable = ({ sessions }: { sessions: SessionSummary[] }) => (
  <div className="session-table-wrap">
    <table className="session-table">
      <thead>
        <tr>
          <th>Workspace</th>
          <th>Session</th>
          <th>Models</th>
          <th>Tokens</th>
          <th>Cost</th>
          <th>State</th>
          <th>Last activity</th>
        </tr>
      </thead>
      <tbody>
        {sessions.length ? (
          sessions.slice(0, 12).map((session) => (
            <tr key={`${session.provider}:${session.nativeSessionId}`}>
              <td>{session.workspaceLabel ?? session.workspaceId ?? "local"}</td>
              <td>{shortId(session.nativeSessionId)}</td>
              <td>{session.models.map(shortModel).join(", ")}</td>
              <td>{formatCompact(session.totals.totalTokens)}</td>
              <td>{formatUsd(session.totals.costUsd)}</td>
              <td>
                <span className={`state state-${session.state}`}>{session.state}</span>
              </td>
              <td>{formatTime(session.lastActivityAt)}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td className="empty-row" colSpan={7}>
              No matching sessions in this window.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const valueForMode = (bin: UsageBin, mode: ChartMode): number => {
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

const labelTicks = (bins: UsageBin[]) => {
  const width = 960;
  const left = 54;
  const right = 18;
  const indexes = [0, Math.floor((bins.length - 1) / 2), bins.length - 1].filter(
    (index, position, all) => index >= 0 && all.indexOf(index) === position,
  );
  return indexes.map((index) => ({
    x: left + (index / Math.max(bins.length - 1, 1)) * (width - left - right),
    text: formatTick(bins[index]?.start, bins),
  }));
};

const formatAxis = (value: number, mode: ChartMode): string => {
  if (mode === "cost") {
    return formatUsd(value);
  }
  if (mode === "cache") {
    return `${Math.round(value)}%`;
  }
  return formatCompact(value);
};

const formatCompact = (value: number | undefined): string => {
  if (value === undefined) {
    return "--";
  }
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
};

const formatUsd = (value: number | undefined): string => {
  if (value === undefined) {
    return "--";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value < 1 ? 4 : 2,
  }).format(value);
};

const formatPercent = (value: number | null | undefined): string => {
  if (value === undefined || value === null) {
    return "--";
  }
  return `${Math.round(value * 100)}%`;
};

const formatTime = (value: string | undefined): string => {
  if (!value) {
    return "--";
  }
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const formatTick = (value: string | undefined, bins: UsageBin[]): string => {
  if (!value) {
    return "--";
  }
  const first = Date.parse(bins[0]?.start ?? value);
  const last = Date.parse(bins.at(-1)?.end ?? value);
  const date = new Date(value);
  if (last - first > 36 * 60 * 60_000) {
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const timeAgo = (value: string): string => {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes}m ago`;
};

const shortModel = (model: string): string =>
  model
    .replace(/^gpt-/, "")
    .replace(/codex-/, "cx-")
    .slice(0, 18);

const shortId = (id: string): string =>
  id.length > 16 ? `${id.slice(0, 8)}...${id.slice(-5)}` : id;

const defaultPeriods: UsageResponse["periods"] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "all-time", label: "All time" },
];

const defaultPlots: UsageResponse["plots"] = [
  { value: "auto", label: "Auto", binMs: null },
  { value: "1m", label: "1m", binMs: 60_000 },
  { value: "5m", label: "5m", binMs: 5 * 60_000 },
  { value: "15m", label: "15m", binMs: 15 * 60_000 },
  { value: "1h", label: "1h", binMs: 60 * 60_000 },
  { value: "1d", label: "1d", binMs: 24 * 60 * 60_000 },
];

const styles = `
:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: #f4f1ea;
  color: #20201e;
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: #f4f1ea; }
button { font: inherit; }
.app-shell { width: min(1440px, calc(100vw - 40px)); margin: 0 auto; padding: 22px 0 34px; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 4px 0 18px; }
.eyebrow { margin: 0 0 5px; color: #787168; font-size: 11px; font-weight: 750; letter-spacing: 0; text-transform: uppercase; }
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: clamp(32px, 5vw, 56px); line-height: 0.95; }
h2 { font-size: 18px; line-height: 1.15; }
.status-row { display: flex; align-items: center; gap: 10px; color: #69625b; }
.status { display: inline-flex; align-items: center; gap: 8px; font-weight: 750; color: #276b49; }
.status::before { content: ""; width: 10px; height: 10px; border-radius: 99px; background: #2f8c5f; box-shadow: 0 0 0 5px rgba(47, 140, 95, 0.14); }
.status-error { color: #a33d47; }
.status-error::before { background: #c13f5a; box-shadow: 0 0 0 5px rgba(193, 63, 90, 0.13); }
.updated { font-size: 13px; }
.toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.mode-toolbar { justify-content: flex-start; margin-top: -4px; margin-bottom: 12px; }
.toolbar-right { display: flex; align-items: center; gap: 8px; min-width: 0; }
.segmented { display: flex; gap: 4px; padding: 4px; border: 1px solid #ded7ca; border-radius: 8px; background: #fffaf0; overflow-x: auto; }
.segmented button { min-width: 44px; height: 34px; border: 0; border-radius: 6px; padding: 0 10px; color: #514b45; background: transparent; cursor: pointer; }
.segmented button.active { color: #fffaf0; background: #22211f; }
.period-tabs button { min-width: max-content; }
.plot-tabs button { min-width: 48px; }
.mode-tabs button { min-width: 78px; }
.compare-toggle { height: 44px; border: 1px solid #ded7ca; border-radius: 8px; padding: 0 14px; color: #514b45; background: #fffaf0; cursor: pointer; font-weight: 700; }
.compare-toggle.active { color: #fffaf0; background: #22211f; border-color: #22211f; }
.compare-toggle:disabled { opacity: 0.45; cursor: not-allowed; }
.notice { margin-bottom: 16px; padding: 12px 14px; border: 1px solid rgba(193, 63, 90, 0.28); border-radius: 8px; color: #88313d; background: #fff4f5; }
.metrics { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 12px; }
.metric { position: relative; min-height: 96px; padding: 16px; border: 1px solid #ded7ca; border-radius: 8px; background: #fffaf0; overflow: hidden; }
.metric::before { content: ""; position: absolute; inset: 0 auto 0 0; width: 5px; background: var(--metric-color); }
.metric span { display: block; margin-bottom: 16px; color: #6f685f; font-size: 13px; font-weight: 700; }
.metric strong { display: block; color: #20201e; font-size: clamp(26px, 3vw, 36px); line-height: 1; letter-spacing: 0; overflow-wrap: anywhere; }
.metric-green { --metric-color: #2f8c5f; }
.metric-orange { --metric-color: #c55f2d; }
.metric-blue { --metric-color: #2f6fbb; }
.metric-purple { --metric-color: #7b5ac7; }
.metric-red { --metric-color: #c13f5a; }
.dashboard-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(300px, 0.85fr); gap: 12px; }
.panel, .table-section { border: 1px solid #ded7ca; border-radius: 8px; background: #fffaf0; }
.panel { min-height: 282px; padding: 16px; }
.trend-panel { grid-row: span 2; }
.panel-head, .table-head { display: flex; align-items: start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.pill { display: inline-flex; align-items: center; min-height: 28px; padding: 0 10px; border-radius: 99px; color: #48433d; background: #ece5d8; font-size: 12px; font-weight: 750; white-space: nowrap; }
.trend-wrap { display: grid; gap: 8px; }
.trend-chart { width: 100%; min-height: 330px; display: block; }
.grid-line { stroke: #e2dbce; stroke-width: 1; }
.area-path { fill: url(#area-fill); }
.line-path { fill: none; stroke: #2f8c5f; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.compare-path { fill: none; stroke: #7b5ac7; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 8 8; opacity: 0.9; }
.last-point { fill: #fffaf0; stroke: #2f8c5f; stroke-width: 4; }
.axis-label, .time-label { fill: #777067; font-size: 13px; }
.time-label { text-anchor: middle; }
.chart-legend { display: flex; align-items: center; gap: 8px; color: #5f5850; font-size: 13px; }
.chart-legend p { margin: 0 14px 0 0; }
.legend-current, .legend-compare { width: 22px; height: 4px; border-radius: 99px; background: #2f8c5f; }
.legend-compare { background: #7b5ac7; }
.donut-wrap { display: grid; grid-template-columns: 150px minmax(0, 1fr); gap: 16px; align-items: center; }
.donut { width: 150px; height: 150px; transform: rotate(-90deg); }
.donut-track { fill: none; stroke: #ece5d8; stroke-width: 14; }
.donut-segment { fill: none; stroke-width: 14; stroke-linecap: butt; }
.donut-total, .donut-caption { transform: rotate(90deg); transform-origin: 60px 60px; text-anchor: middle; fill: #20201e; font-weight: 800; }
.donut-total { font-size: 24px; }
.donut-caption { font-size: 10px; fill: #777067; text-transform: uppercase; }
.legend-list, .provider-list, .mix-list { display: grid; gap: 10px; }
.legend-item, .mix-list div, .provider-list div { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto; align-items: center; gap: 9px; }
.legend-item span, .mix-list span { width: 10px; height: 10px; border-radius: 99px; }
.legend-item p, .mix-list p, .provider-list p { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #34312d; }
.legend-item strong, .mix-list strong, .provider-list strong { font-size: 13px; }
.mix { display: grid; gap: 18px; }
.stacked { display: flex; width: 100%; height: 32px; overflow: hidden; border-radius: 7px; background: #ece5d8; }
.stacked span { min-width: 0; height: 100%; }
.provider-list div { grid-template-columns: minmax(0, 1fr) auto auto; padding: 10px 0; border-bottom: 1px solid #ebe3d6; }
.provider-list div:last-child { border-bottom: 0; }
.provider-list span { color: #706960; font-size: 13px; }
.empty { margin: 0; color: #777067; }
.table-section { margin-top: 12px; padding: 16px; }
.session-table-wrap { width: 100%; overflow-x: auto; }
.session-table { width: 100%; border-collapse: collapse; min-width: 860px; }
.session-table th, .session-table td { padding: 12px 10px; border-bottom: 1px solid #ebe3d6; text-align: left; font-size: 13px; white-space: nowrap; }
.session-table th { color: #777067; font-size: 11px; text-transform: uppercase; letter-spacing: 0; }
.session-table td:nth-child(1), .session-table td:nth-child(3) { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
.state { display: inline-flex; align-items: center; min-width: 64px; justify-content: center; padding: 4px 8px; border-radius: 99px; font-size: 12px; font-weight: 750; color: #4c463f; background: #ece5d8; }
.state-active { color: #276b49; background: rgba(47, 140, 95, 0.14); }
.state-idle { color: #8b552e; background: rgba(197, 95, 45, 0.14); }
.state-stale, .state-closed { color: #777067; }
.empty-row { text-align: center !important; color: #777067; }
@media (max-width: 1040px) {
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .dashboard-grid { grid-template-columns: 1fr; }
}
@media (max-width: 720px) {
  .app-shell { width: min(100vw - 24px, 1440px); padding-top: 14px; }
  .topbar, .toolbar, .toolbar-right { align-items: stretch; flex-direction: column; }
  .segmented { width: 100%; }
  .metrics { grid-template-columns: 1fr; }
  .donut-wrap { grid-template-columns: 1fr; justify-items: center; }
  .trend-chart { min-height: 260px; }
}
`;

createRoot(document.getElementById("root")!).render(<App />);
