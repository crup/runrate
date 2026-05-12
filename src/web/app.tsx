import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Cpu,
  DollarSign,
  Download,
  Filter,
  Layers,
  Moon,
  Search,
  Sun,
  X,
  Zap,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type PeriodPreset =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "all-time";
type PlotPreset = "auto" | "1m" | "5m" | "15m" | "1h" | "1d";
type SessionState = "active" | "idle" | "stale" | "closed";
type ViewKey = "overview" | "sessions" | "models" | "costs" | "settings";
type ChartScale = "linear" | "log";
type SessionListMode = "workspace" | "session";
type RefreshIntervalMs = 15_000 | 30_000 | 60_000 | 300_000;

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
  state: SessionState;
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
  pollMs: number;
  generatedAt: string;
  data: RunrateExport;
}

interface ChartPoint {
  end: string;
  input: number;
  output: number;
  rangeLabel: string;
  reasoning: number;
  start: string;
  cacheRead: number;
  cost: number;
  tickLabel: string;
  total: number;
  sessions: number;
}

type UiSession = {
  id: string;
  workspace: string;
  provider: string;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  cacheHitRatio: number;
  state: SessionState;
  firstActivity: string;
  lastActivity: string;
  lastActivityRelative: string;
};

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

const tokenColors = [
  "var(--token-input)",
  "var(--token-output)",
  "var(--token-reasoning)",
  "var(--token-cache-read)",
  "var(--token-cost)",
  "var(--primary)",
];

const prefsKey = "runrate:prefs:v1";
const viewKeys: ViewKey[] = ["overview", "sessions", "models", "costs", "settings"];
const chartScales: ChartScale[] = ["linear", "log"];
const hourMs = 60 * 60_000;
const dayMs = 24 * hourMs;
const refreshIntervals: Array<{ label: string; value: RefreshIntervalMs }> = [
  { label: "15s", value: 15_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "5m", value: 300_000 },
];

type StoredPrefs = {
  activeView?: ViewKey;
  chartScale?: ChartScale;
  model?: string;
  period?: PeriodPreset;
  plot?: PlotPreset;
  provider?: string;
  refreshMs?: RefreshIntervalMs;
  sessionListMode?: SessionListMode;
  spendThresholds?: SpendThresholds;
  theme?: "dark" | "light";
};

type SpendThresholds = {
  warn: number;
  danger: number;
};

const defaultSpendThresholds: SpendThresholds = {
  danger: 10,
  warn: 4,
};

const normalizeSpendThresholds = (value: unknown): SpendThresholds => {
  if (!value || typeof value !== "object") {
    return defaultSpendThresholds;
  }
  const maybe = value as Partial<SpendThresholds>;
  const warn = Number(maybe.warn);
  const danger = Number(maybe.danger);
  const normalizedWarn = Number.isFinite(warn) && warn >= 0 ? warn : defaultSpendThresholds.warn;
  const normalizedDanger =
    Number.isFinite(danger) && danger >= normalizedWarn
      ? danger
      : Math.max(normalizedWarn, defaultSpendThresholds.danger);
  return {
    danger: normalizedDanger,
    warn: normalizedWarn,
  };
};

const readStoredPrefs = (): StoredPrefs => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const parsed = JSON.parse(window.localStorage.getItem(prefsKey) ?? "{}") as StoredPrefs;
    const prefs: StoredPrefs = {};
    const parsedView = parsed.activeView;
    const parsedScale = parsed.chartScale;
    const parsedPeriod = parsed.period;
    const parsedPlot = parsed.plot;
    const parsedRefreshMs = parsed.refreshMs;
    const parsedSessionListMode = parsed.sessionListMode;
    if (parsedView && viewKeys.includes(parsedView)) prefs.activeView = parsedView;
    if (parsedScale && chartScales.includes(parsedScale)) prefs.chartScale = parsedScale;
    if (typeof parsed.model === "string") prefs.model = parsed.model;
    if (parsedPeriod && defaultPeriods.some((item) => item.value === parsedPeriod))
      prefs.period = parsedPeriod;
    if (parsedPlot && defaultPlots.some((item) => item.value === parsedPlot))
      prefs.plot = parsedPlot;
    if (typeof parsed.provider === "string") prefs.provider = parsed.provider;
    const refreshInterval = refreshIntervals.find((item) => item.value === parsedRefreshMs);
    if (refreshInterval) prefs.refreshMs = refreshInterval.value;
    if (parsedSessionListMode === "workspace" || parsedSessionListMode === "session")
      prefs.sessionListMode = parsedSessionListMode;
    prefs.spendThresholds = normalizeSpendThresholds(parsed.spendThresholds);
    if (parsed.theme === "light" || parsed.theme === "dark") prefs.theme = parsed.theme;
    return prefs;
  } catch {
    return {};
  }
};

function App() {
  const initialPrefs = useMemo(readStoredPrefs, []);
  const [period, setPeriod] = useState<PeriodPreset>(initialPrefs.period ?? "today");
  const [plot, setPlot] = useState<PlotPreset>(initialPrefs.plot ?? "auto");
  const [provider, setProvider] = useState(initialPrefs.provider ?? "All");
  const [model, setModel] = useState(initialPrefs.model ?? "All");
  const [theme, setTheme] = useState<"dark" | "light">(initialPrefs.theme ?? "dark");
  const [activeView, setActiveView] = useState<ViewKey>(initialPrefs.activeView ?? "overview");
  const [chartScale, setChartScale] = useState<ChartScale>(initialPrefs.chartScale ?? "linear");
  const [refreshMs, setRefreshMs] = useState<RefreshIntervalMs>(initialPrefs.refreshMs ?? 60_000);
  const [spendThresholds, setSpendThresholds] = useState<SpendThresholds>(
    initialPrefs.spendThresholds ?? defaultSpendThresholds,
  );
  const [sessionListMode, setSessionListMode] = useState<SessionListMode>(
    initialPrefs.sessionListMode ?? "workspace",
  );
  const [response, setResponse] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(
      prefsKey,
      JSON.stringify({
        activeView,
        chartScale,
        model,
        period,
        plot,
        provider,
        refreshMs,
        sessionListMode,
        spendThresholds,
        theme,
      }),
    );
  }, [
    activeView,
    chartScale,
    model,
    period,
    plot,
    provider,
    refreshMs,
    sessionListMode,
    spendThresholds,
    theme,
  ]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;

    const load = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          period,
          plot,
        });
        if (provider !== "All") {
          params.set("provider", provider);
        }
        if (model !== "All") {
          params.set("model", model);
        }

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
        timer = window.setTimeout(load, Math.max(15_000, refreshMs, next.pollMs));
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
  }, [model, period, plot, provider, refreshMs]);

  const data = response?.data;
  const periods = response?.periods ?? defaultPeriods;
  const plots = response?.plots ?? defaultPlots;
  const providers = useMemo(
    () => ["All", ...(data?.providers.map((item) => item.provider) ?? [])],
    [data],
  );
  const models = useMemo(
    () => ["All", ...(data?.models.map((item) => item.modelId) ?? [])],
    [data],
  );
  const chartData = useMemo(() => toChartData(data?.bins ?? []), [data]);
  const sessions = useMemo(() => (data?.sessions ?? []).map(toUiSession), [data]);
  const totals = data?.totals ?? emptyTotals();
  const activeCount = sessions.filter((session) => session.state === "active").length;
  const cacheHit = totals.cacheHitRatio === null ? 0 : totals.cacheHitRatio;
  const isDefault = period === "today" && plot === "auto" && provider === "All" && model === "All";
  const viewTitle =
    activeView === "overview"
      ? "Telemetry overview"
      : activeView === "sessions"
        ? "Sessions"
        : activeView === "models"
          ? "Models"
          : activeView === "costs"
            ? "Costs"
            : "Settings";

  const reset = () => {
    setPeriod("today");
    setPlot("auto");
    setProvider("All");
    setModel("All");
  };

  const clearPrefs = () => {
    window.localStorage.removeItem(prefsKey);
    setPeriod("today");
    setPlot("auto");
    setProvider("All");
    setModel("All");
    setTheme("dark");
    setActiveView("overview");
    setChartScale("linear");
    setRefreshMs(60_000);
    setSessionListMode("workspace");
    setSpendThresholds(defaultSpendThresholds);
  };

  const exportCurrentView = () => {
    if (!response) {
      return;
    }
    const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `runrate-${period}-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <>
      <style>{styles}</style>
      <div className="app">
        <TopBar
          activeView={activeView}
          isDefault={isDefault}
          loading={loading}
          model={model}
          models={models}
          period={period}
          periods={periods}
          plot={plot}
          plots={plots}
          provider={provider}
          providers={providers}
          refreshMs={refreshMs}
          onExport={exportCurrentView}
          reset={reset}
          setActiveView={setActiveView}
          setModel={setModel}
          setPeriod={setPeriod}
          setPlot={setPlot}
          setProvider={setProvider}
          setTheme={setTheme}
          theme={theme}
        />

        <main className="main">
          <div className="page-head">
            <div className="entrance">
              <h1>{viewTitle}</h1>
              <p>
                {response?.period.label ?? "Today"} · {response?.plot.label ?? "Auto"} interval ·{" "}
                {provider === "All" ? "all providers" : provider}
                {model !== "All" ? ` · ${model}` : ""}
              </p>
            </div>
            <UpdatedClock generatedAt={response?.generatedAt} />
          </div>

          {error ? (
            <div className="error-banner">
              <AlertCircle className="icon" />
              {error}
            </div>
          ) : null}

          {activeView === "overview" ? (
            <>
              <section className="metrics entrance">
                <MetricCard
                  icon={Layers}
                  label="Total tokens"
                  spark={chartData.map((point) => point.total)}
                  sparkColor="var(--token-input)"
                  value={formatNumber(totals.totalTokens)}
                />
                <MetricCard
                  icon={DollarSign}
                  label="Est. cost"
                  spark={chartData.map((point) => point.cost * 100)}
                  sparkColor="var(--token-cost)"
                  value={formatCost(totals.costUsd)}
                />
                <MetricCard
                  delta={cacheHit >= 0.5 ? "healthy" : "low"}
                  deltaTone={cacheHit >= 0.5 ? "positive" : "negative"}
                  icon={Zap}
                  label="Cache hit"
                  spark={chartData.map((point) => point.cacheRead)}
                  sparkColor="var(--token-cache-read)"
                  value={formatPercent(cacheHit)}
                />
                <MetricCard
                  icon={Activity}
                  label="Active sessions"
                  spark={chartData.map((point) => point.sessions)}
                  sparkColor="var(--token-output)"
                  value={String(activeCount)}
                />
                <MetricCard
                  icon={Cpu}
                  label="Models"
                  spark={(data?.models ?? []).slice(0, 8).map((item) => item.totals.totalTokens)}
                  sparkColor="var(--token-reasoning)"
                  value={String(data?.models.length ?? 0)}
                />
                <MetricCard
                  icon={Activity}
                  label="Last activity"
                  sub={
                    <span className="live-sub">
                      <span className="live-dot" />
                      {formatAge(totals.lastActivityAt)}
                    </span>
                  }
                  value={formatAgeShort(totals.lastActivityAt)}
                />
              </section>

              <section className="grid-12">
                <PrimaryChart chartData={chartData} scale={chartScale} setScale={setChartScale} />
                <ModelMixCard models={data?.models ?? []} total={totals.totalTokens} />
              </section>

              <section className="grid-12">
                <CompositionCard totals={totals} />
                <ProviderCard providers={data?.providers ?? []} total={totals.totalTokens} />
                <CostMiniChart chartData={chartData} cost={totals.costUsd} />
              </section>

              <SessionsTable
                mode={sessionListMode}
                sessions={sessions}
                setMode={setSessionListMode}
                spendThresholds={spendThresholds}
              />
            </>
          ) : null}

          {activeView === "sessions" ? (
            <SessionsTable
              mode={sessionListMode}
              sessions={sessions}
              setMode={setSessionListMode}
              spendThresholds={spendThresholds}
            />
          ) : null}

          {activeView === "models" ? (
            <section className="grid-12">
              <ModelMixCard models={data?.models ?? []} total={totals.totalTokens} />
              <ModelBreakdownPanel models={data?.models ?? []} />
            </section>
          ) : null}

          {activeView === "costs" ? (
            <>
              <section className="grid-12">
                <PrimaryChart chartData={chartData} scale={chartScale} setScale={setChartScale} />
                <CostMiniChart chartData={chartData} cost={totals.costUsd} />
              </section>
              <section className="grid-12">
                <CompositionCard totals={totals} />
                <ProviderCard providers={data?.providers ?? []} total={totals.totalTokens} />
              </section>
            </>
          ) : null}

          {activeView === "settings" ? (
            <SettingsPanel
              chartScale={chartScale}
              clearPrefs={clearPrefs}
              refreshMs={refreshMs}
              sessionListMode={sessionListMode}
              setChartScale={setChartScale}
              setRefreshMs={setRefreshMs}
              setSessionListMode={setSessionListMode}
              setSpendThresholds={setSpendThresholds}
              setTheme={setTheme}
              spendThresholds={spendThresholds}
              theme={theme}
            />
          ) : null}

          <footer className="footer">Runrate · local-first · no data leaves your machine</footer>
        </main>
      </div>
    </>
  );
}

function TopBar(props: {
  activeView: ViewKey;
  isDefault: boolean;
  loading: boolean;
  model: string;
  models: string[];
  period: PeriodPreset;
  periods: UsageResponse["periods"];
  plot: PlotPreset;
  plots: UsageResponse["plots"];
  provider: string;
  providers: string[];
  refreshMs: RefreshIntervalMs;
  onExport: () => void;
  reset: () => void;
  setActiveView: (value: ViewKey) => void;
  setModel: (value: string) => void;
  setPeriod: (value: PeriodPreset) => void;
  setPlot: (value: PlotPreset) => void;
  setProvider: (value: string) => void;
  setTheme: (value: "dark" | "light") => void;
  theme: "dark" | "light";
}) {
  return (
    <header className="topbar">
      <div className={props.loading ? "scan-line active" : "scan-line"}>
        <div />
      </div>
      <div className="topbar-main">
        <div className="brand-block">
          <button
            className="brand-identity"
            onClick={() => props.setActiveView("overview")}
            title="Open overview"
            type="button"
          >
            <div className="brand-mark">
              <div />
            </div>
            <span>Runrate</span>
          </button>
          <nav>
            {viewKeys.map((item) => (
              <button
                className={props.activeView === item ? "active" : ""}
                key={item}
                onClick={() => props.setActiveView(item)}
                type="button"
              >
                {titleCase(item)}
              </button>
            ))}
          </nav>
        </div>
        <div className="top-actions">
          <LiveStatus loading={props.loading} refreshMs={props.refreshMs} />
          <button
            className="action-btn"
            onClick={props.onExport}
            title="Export current view"
            type="button"
          >
            <Download className="icon" />
            Export
          </button>
          <button
            aria-label="Toggle theme"
            className="icon-btn"
            onClick={() => props.setTheme(props.theme === "dark" ? "light" : "dark")}
            title={`Switch to ${props.theme === "dark" ? "light" : "dark"} mode`}
            type="button"
          >
            {props.theme === "dark" ? <Sun className="icon" /> : <Moon className="icon" />}
          </button>
        </div>
      </div>
      <div className="filterbar">
        <div className="filter-label">
          <Filter className="icon" />
          <span>Filters</span>
        </div>
        <div className="divider" />
        <SelectControl
          isDefault={props.period === "today"}
          label="Period"
          onChange={(value) => props.setPeriod(value as PeriodPreset)}
          options={props.periods.map((item) => ({ label: item.label, value: item.value }))}
          value={props.period}
        />
        <SelectControl
          isDefault={props.plot === "auto"}
          label="Granularity"
          onChange={(value) => props.setPlot(value as PlotPreset)}
          options={props.plots.map((item) => ({ label: item.label, value: item.value }))}
          value={props.plot}
        />
        <SelectControl
          isDefault={props.provider === "All"}
          label="Provider"
          onChange={props.setProvider}
          options={props.providers.map((item) => ({ label: item, value: item }))}
          value={props.provider}
        />
        <SelectControl
          isDefault={props.model === "All"}
          label="Model"
          onChange={props.setModel}
          options={props.models.map((item) => ({ label: displayModel(item), value: item }))}
          value={props.model}
        />
        {!props.isDefault ? (
          <button className="reset-btn" onClick={props.reset} type="button">
            <X className="icon" />
            Reset
          </button>
        ) : null}
      </div>
    </header>
  );
}

function SelectControl({
  disabled,
  isDefault,
  label,
  onChange,
  options,
  value,
}: {
  disabled?: boolean | undefined;
  isDefault: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <div
      className={[
        "select-control",
        disabled ? "disabled" : "",
        !isDefault ? "selected" : "",
        open ? "open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button disabled={disabled} onClick={() => setOpen((current) => !current)} type="button">
        <span>{label}</span>
        <strong>{selected?.label ?? value}</strong>
        <ChevronDown className="icon" />
      </button>
      {open && !disabled ? (
        <div className="select-menu" role="listbox">
          <div className="select-menu-label">{label}</div>
          {options.map((option) => (
            <button
              className={option.value === value ? "active" : ""}
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span>{option.label}</span>
              {option.value === value ? <Check className="icon" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function LiveStatus({ loading, refreshMs }: { loading: boolean; refreshMs: RefreshIntervalMs }) {
  const refreshSeconds = Math.max(1, Math.round(refreshMs / 1000));
  const [tick, setTick] = useState(refreshSeconds);

  useEffect(() => {
    setTick(refreshSeconds);
  }, [refreshSeconds, loading]);

  useEffect(() => {
    const interval = setInterval(
      () => setTick((current) => (current <= 1 ? refreshSeconds : current - 1)),
      1000,
    );
    return () => clearInterval(interval);
  }, [refreshSeconds]);
  const pct = ((refreshSeconds - tick) / refreshSeconds) * 100;
  return (
    <div className="live-status">
      <svg className="live-ring" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="15" />
        <circle cx="18" cy="18" r="15" style={{ strokeDasharray: `${pct * 0.94} 100` }} />
      </svg>
      <span>{loading ? "Syncing" : `Refresh · ${formatDuration(tick * 1000)}`}</span>
    </div>
  );
}

const titleCase = (value: string): string =>
  value.replace(/(^|-)([a-z])/g, (_, __, letter) => String(letter).toUpperCase());

function MetricCard({
  delta,
  deltaTone = "neutral",
  icon: Icon,
  label,
  spark,
  sparkColor = "var(--token-input)",
  sub,
  value,
}: {
  delta?: string | undefined;
  deltaTone?: "positive" | "negative" | "neutral";
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  spark?: number[] | undefined;
  sparkColor?: string | undefined;
  sub?: React.ReactNode | undefined;
  value: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-top">
        <div>
          <Icon className="icon" />
          <span>{label}</span>
        </div>
        {delta ? <span className={`delta ${deltaTone}`}>{delta}</span> : null}
      </div>
      <div className="metric-value">{value}</div>
      {spark && spark.length > 1 ? (
        <Sparkline color={sparkColor} data={spark} />
      ) : (
        <div className="metric-sub">{sub}</div>
      )}
    </div>
  );
}

function Sparkline({ color, data }: { color: string; data: number[] }) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg className="sparkline" preserveAspectRatio="none" viewBox="0 0 100 100">
      <polyline
        fill="none"
        points={points}
        stroke={color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
      <polyline
        fill={color}
        opacity="0.12"
        points={`0,100 ${points} 100,100`}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function PrimaryChart({
  chartData,
  scale,
  setScale,
}: {
  chartData: ChartPoint[];
  scale: ChartScale;
  setScale: (value: ChartScale) => void;
}) {
  const plotData = useMemo(
    () =>
      chartData.map((point) => ({
        ...point,
        inputPlot: scale === "log" ? logValue(point.input) : point.input,
        outputPlot: scale === "log" ? logValue(point.output) : point.output,
        reasoningPlot: scale === "log" ? logValue(point.reasoning) : point.reasoning,
      })),
    [chartData, scale],
  );
  const maxChartValue = useMemo(
    () =>
      Math.max(1, ...chartData.flatMap((point) => [point.input, point.output, point.reasoning])),
    [chartData],
  );
  const logMax = Math.ceil(logValue(maxChartValue));
  const logTicks = useMemo(
    () => Array.from({ length: Math.max(1, logMax) + 1 }, (_, index) => index),
    [logMax],
  );
  return (
    <section className="panel primary-chart">
      <div className="panel-head">
        <div>
          <h3>Tokens over time</h3>
          <p>Current period</p>
        </div>
        <div className="legend-row">
          <Legend color="var(--token-input)" label="Input" />
          <Legend color="var(--token-output)" label="Output" />
          <Legend color="var(--token-reasoning)" label="Reasoning" />
          <div className="scale-toggle">
            {chartScales.map((item) => (
              <button
                className={scale === item ? "active" : ""}
                key={item}
                onClick={() => setScale(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="chart-frame tall">
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={plotData} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="g-input" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--token-input)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--token-input)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g-output" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--token-output)" stopOpacity={0.45} />
                <stop offset="100%" stopColor="var(--token-output)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="g-reason" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--token-reasoning)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--token-reasoning)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              axisLine={{ stroke: "var(--border)" }}
              dataKey="start"
              interval={0}
              tick={axisTick}
              tickFormatter={(_, index) => chartData[index]?.tickLabel ?? ""}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              tick={axisTick}
              tickFormatter={(value) =>
                scale === "log"
                  ? formatAxisNumber(unlogValue(Number(value)))
                  : formatAxisNumber(Number(value))
              }
              tickLine={false}
              width={64}
              {...(scale === "log"
                ? { domain: [0, logMax] as [number, number], ticks: logTicks }
                : {})}
            />
            <Tooltip
              content={<ChartTooltip />}
              cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
            />
            <Area
              dataKey="reasoningPlot"
              fill="url(#g-reason)"
              name="reasoning"
              stroke="var(--token-reasoning)"
              strokeWidth={1.5}
              type="monotone"
              {...(scale === "linear" ? { stackId: "1" } : {})}
            />
            <Area
              dataKey="outputPlot"
              fill="url(#g-output)"
              name="output"
              stroke="var(--token-output)"
              strokeWidth={1.5}
              type="monotone"
              {...(scale === "linear" ? { stackId: "1" } : {})}
            />
            <Area
              dataKey="inputPlot"
              fill="url(#g-input)"
              name="input"
              stroke="var(--token-input)"
              strokeWidth={1.5}
              type="monotone"
              {...(scale === "linear" ? { stackId: "1" } : {})}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) {
    return null;
  }
  const rangeLabel = payload[0]?.payload?.rangeLabel ?? "";
  return (
    <div className="chart-tooltip">
      <div className="tooltip-label">{rangeLabel}</div>
      {payload.map((item: any) => {
        const labelKey = String(item.name ?? item.dataKey ?? "");
        const rawValue = item.payload?.[labelKey] ?? item.value;
        return (
          <div className="tooltip-row" key={item.dataKey}>
            <span style={{ background: item.color }} />
            <p>{labelKey}</p>
            <strong>
              {labelKey.toLowerCase().includes("cost")
                ? formatCost(rawValue)
                : formatNumber(rawValue)}
            </strong>
          </div>
        );
      })}
    </div>
  );
}

function Legend({
  color,
  dashed,
  label,
}: {
  color: string;
  dashed?: boolean | undefined;
  label: string;
}) {
  return (
    <div className="legend">
      <span
        style={
          dashed
            ? { borderTop: `1px dashed ${color}`, background: "transparent" }
            : { background: color }
        }
      />
      {label}
    </div>
  );
}

function ModelBreakdownPanel({ models }: { models: ModelBreakdown[] }) {
  return (
    <section className="panel breakdown-panel">
      <div className="panel-head">
        <h3>Model breakdown</h3>
        <span>{models.length} models</span>
      </div>
      <div className="breakdown-list">
        {models.length ? (
          models.map((item, index) => (
            <div className="breakdown-row" key={`${item.provider}:${item.modelId}`}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p title={item.modelId}>{item.modelDisplayName ?? item.modelId}</p>
              <strong>{formatCost(item.totals.costUsd)}</strong>
              <div className="mini-track">
                <span
                  style={{
                    width: `${Math.min(
                      100,
                      (item.totals.totalTokens / Math.max(1, models[0]?.totals.totalTokens ?? 1)) *
                        100,
                    )}%`,
                  }}
                />
              </div>
              <em>{formatNumber(item.totals.totalTokens)}</em>
            </div>
          ))
        ) : (
          <p className="empty">No model usage in this range.</p>
        )}
      </div>
    </section>
  );
}

function ModelMixCard({ models, total }: { models: ModelBreakdown[]; total: number }) {
  const mix = models.slice(0, 6).map((item, index) => ({
    color: tokenColors[index] ?? "var(--primary)",
    name: shortModel(item.modelId),
    rawName: item.modelId,
    value: total > 0 ? Math.round((item.totals.totalTokens / total) * 1000) / 10 : 0,
  }));
  return (
    <section className="panel model-card">
      <div className="panel-head">
        <h3>Model mix</h3>
        <span>{models.length} models</span>
      </div>
      <div className="model-body">
        <div className="donut-shell">
          <ResponsiveContainer height="100%" width="100%">
            <PieChart>
              <Pie
                cx="50%"
                cy="50%"
                data={mix}
                dataKey="value"
                innerRadius={42}
                outerRadius={60}
                paddingAngle={2}
                stroke="var(--card)"
                strokeWidth={2}
              >
                {mix.map((item) => (
                  <Cell fill={item.color} key={item.rawName} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="donut-center">
            <span>Top</span>
            <strong>{mix[0]?.value ?? 0}%</strong>
          </div>
        </div>
        <div className="mix-list">
          {mix.length ? (
            mix.map((item) => (
              <div key={item.rawName}>
                <span style={{ background: item.color }} />
                <p title={item.rawName}>{item.name}</p>
                <strong>{item.value}%</strong>
              </div>
            ))
          ) : (
            <p className="empty">No model usage in this range.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function CompositionCard({ totals }: { totals: UsageTotals }) {
  const segments = [
    { color: "var(--token-input)", label: "Input", value: totals.inputFresh },
    { color: "var(--token-output)", label: "Output", value: totals.output },
    { color: "var(--token-reasoning)", label: "Reasoning", value: totals.reasoning },
    { color: "var(--token-cache-read)", label: "Cache read", value: totals.cacheRead },
  ];
  const sum = segments.reduce((acc, item) => acc + item.value, 0) || 1;
  return (
    <section className="panel third">
      <div className="panel-head">
        <h3>Token composition</h3>
      </div>
      <div className="composition">
        <div className="stack-bar">
          {segments.map((item) => (
            <div
              key={item.label}
              style={{ background: item.color, width: `${(item.value / sum) * 100}%` }}
            />
          ))}
        </div>
        {segments.map((item) => (
          <div className="composition-row" key={item.label}>
            <div>
              <span style={{ background: item.color }} />
              <p>{item.label}</p>
            </div>
            <strong>{formatNumber(item.value)}</strong>
            <div className="mini-track">
              <span style={{ background: item.color, width: `${(item.value / sum) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProviderCard({ providers, total }: { providers: ProviderSummary[]; total: number }) {
  return (
    <section className="panel third">
      <div className="panel-head">
        <h3>Providers</h3>
      </div>
      <div className="provider-list">
        {providers.length ? (
          providers.map((item, index) => {
            const share = total > 0 ? item.totals.totalTokens / total : 0;
            return (
              <div className="provider-row" key={item.provider}>
                <div>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{item.provider}</p>
                  <strong>{formatNumber(item.totals.totalTokens)}</strong>
                </div>
                <div className="mini-track">
                  <span style={{ width: `${share * 100}%` }} />
                </div>
              </div>
            );
          })
        ) : (
          <p className="empty">No providers detected.</p>
        )}
      </div>
    </section>
  );
}

function CostMiniChart({ chartData, cost }: { chartData: ChartPoint[]; cost: number }) {
  return (
    <section className="panel third">
      <div className="panel-head">
        <h3>Cost over time</h3>
        <span>{formatCost(cost)}</span>
      </div>
      <div className="chart-frame mini">
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={chartData} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="g-cost" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--token-cost)" stopOpacity={0.5} />
                <stop offset="100%" stopColor="var(--token-cost)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="start"
              interval={0}
              tick={axisTickSmall}
              tickFormatter={(_, index) => chartData[index]?.tickLabel ?? ""}
              tickLine={false}
            />
            <YAxis hide />
            <Tooltip content={<ChartTooltip />} />
            <Area
              dataKey="cost"
              fill="url(#g-cost)"
              stroke="var(--token-cost)"
              strokeWidth={1.5}
              type="monotone"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function SessionsTable({
  mode,
  sessions,
  setMode,
  spendThresholds,
}: {
  mode: SessionListMode;
  sessions: UiSession[];
  setMode: (value: SessionListMode) => void;
  spendThresholds: SpendThresholds;
}) {
  const [sort, setSort] = useState<{ key: keyof UiSession | "total"; dir: "asc" | "desc" }>({
    dir: "desc",
    key: "total",
  });
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<SessionState | "all">("all");
  const filtered = useMemo(
    () =>
      sessions
        .filter((session) => stateFilter === "all" || session.state === stateFilter)
        .filter((session) =>
          query
            ? [session.workspace, session.id, session.provider, session.models.join(" ")]
                .join(" ")
                .toLowerCase()
                .includes(query.toLowerCase())
            : true,
        )
        .sort((a, b) => {
          const left =
            sort.key === "total" ? a.inputTokens + a.outputTokens + a.reasoningTokens : a[sort.key];
          const right =
            sort.key === "total" ? b.inputTokens + b.outputTokens + b.reasoningTokens : b[sort.key];
          if (typeof left === "number" && typeof right === "number") {
            return sort.dir === "desc" ? right - left : left - right;
          }
          return sort.dir === "desc"
            ? String(right).localeCompare(String(left))
            : String(left).localeCompare(String(right));
        }),
    [query, sessions, sort, stateFilter],
  );
  const stateOptions: Array<SessionState | "all"> = ["all", "active", "idle", "stale", "closed"];
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = { all: sessions.length };
    for (const session of sessions) {
      counts[session.state] = (counts[session.state] ?? 0) + 1;
    }
    return counts;
  }, [sessions]);

  const header = (
    label: string,
    key: keyof UiSession | "total",
    align: "left" | "right" = "left",
  ) => {
    const active = sort.key === key;
    return (
      <th
        className={align === "right" ? "right sortable" : "sortable"}
        onClick={() =>
          setSort((current) => ({
            dir: current.key === key && current.dir === "desc" ? "asc" : "desc",
            key,
          }))
        }
      >
        <span className={active ? "active" : ""}>
          {label}
          {active ? (
            sort.dir === "desc" ? (
              <ArrowDown className="icon" />
            ) : (
              <ArrowUp className="icon" />
            )
          ) : null}
        </span>
      </th>
    );
  };

  return (
    <section className="sessions-panel">
      <div className="sessions-head">
        <div>
          <h3>Sessions</h3>
          <span>
            {filtered.length} / {sessions.length}
          </span>
        </div>
        <div className="sessions-tools">
          <div className="segmented">
            {(["workspace", "session"] as const).map((item) => (
              <button
                className={mode === item ? "active" : ""}
                key={item}
                onClick={() => setMode(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
          <div className="state-tabs">
            {stateOptions.map((item) => (
              <button
                className={stateFilter === item ? "active" : ""}
                key={item}
                onClick={() => setStateFilter(item)}
                type="button"
              >
                {item}
                <span>{stateCounts[item] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="searchbox">
            <Search className="icon" />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workspace, id, provider..."
              value={query}
            />
            {query ? (
              <button onClick={() => setQuery("")} type="button">
                <X className="icon" />
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {header(
                mode === "workspace" ? "Workspace" : "Session",
                mode === "workspace" ? "workspace" : "id",
              )}
              {header(
                mode === "workspace" ? "Session" : "Workspace",
                mode === "workspace" ? "id" : "workspace",
              )}
              {header("Provider", "provider")}
              <th>Models</th>
              {header("Tokens", "total", "right")}
              {header("Cost", "cost", "right")}
              {header("Cache", "cacheHitRatio", "right")}
              {header("State", "state")}
              {header("Activity", "lastActivity", "right")}
            </tr>
          </thead>
          <tbody>
            {filtered.length ? (
              filtered.map((session) => {
                const total = session.inputTokens + session.outputTokens + session.reasoningTokens;
                const costTone = getSpendTone(session.cost, spendThresholds);
                const highCost = costTone !== "normal";
                const lowCache = session.cacheHitRatio > 0 && session.cacheHitRatio < 0.25;
                return (
                  <tr key={`${session.provider}:${session.id}`}>
                    <td>
                      <div className="workspace-cell">
                        {session.state === "active" ? <span className="live-dot" /> : null}
                        {mode === "workspace" ? session.workspace : session.id}
                        {highCost || lowCache ? <AlertCircle className="warn-icon" /> : null}
                      </div>
                    </td>
                    <td className="mono muted">
                      {mode === "workspace" ? session.id : session.workspace}
                    </td>
                    <td className="muted">{session.provider}</td>
                    <td>
                      <div className="model-tags">
                        {session.models.map((item) => (
                          <span key={item}>{displayModel(item)}</span>
                        ))}
                      </div>
                    </td>
                    <td className="right mono">{formatNumber(total)}</td>
                    <td
                      className={
                        costTone === "danger"
                          ? "right mono cost-danger"
                          : costTone === "warn"
                            ? "right mono cost-warn"
                            : "right mono"
                      }
                    >
                      {formatCost(session.cost)}
                    </td>
                    <td className="right">
                      <CacheBar ratio={session.cacheHitRatio} />
                    </td>
                    <td>
                      <StateBadge state={session.state} />
                    </td>
                    <td className="right mono muted">{session.lastActivityRelative}</td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="empty-row" colSpan={9}>
                  No sessions match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SettingsPanel({
  chartScale,
  clearPrefs,
  refreshMs,
  sessionListMode,
  setChartScale,
  setRefreshMs,
  setSessionListMode,
  setSpendThresholds,
  setTheme,
  spendThresholds,
  theme,
}: {
  chartScale: ChartScale;
  clearPrefs: () => void;
  refreshMs: RefreshIntervalMs;
  sessionListMode: SessionListMode;
  setChartScale: (value: ChartScale) => void;
  setRefreshMs: (value: RefreshIntervalMs) => void;
  setSessionListMode: (value: SessionListMode) => void;
  setSpendThresholds: (value: SpendThresholds) => void;
  setTheme: (value: "dark" | "light") => void;
  spendThresholds: SpendThresholds;
  theme: "dark" | "light";
}) {
  const updateSpendThreshold = (key: keyof SpendThresholds, value: string) => {
    const parsed = Number(value);
    const next = {
      ...spendThresholds,
      [key]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
    };
    setSpendThresholds(normalizeSpendThresholds(next));
  };

  return (
    <section className="settings-grid">
      <div className="panel settings-panel">
        <div className="panel-head">
          <h3>Preferences</h3>
          <span>Local storage</span>
        </div>
        <div className="settings-body">
          <div className="settings-row">
            <div>
              <h4>Theme</h4>
              <p>Saved on this browser only</p>
            </div>
            <div className="segmented">
              {(["dark", "light"] as const).map((item) => (
                <button
                  className={theme === item ? "active" : ""}
                  key={item}
                  onClick={() => setTheme(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <div>
              <h4>Chart scale</h4>
              <p>Use log scale when one token category dominates</p>
            </div>
            <div className="segmented">
              {chartScales.map((item) => (
                <button
                  className={chartScale === item ? "active" : ""}
                  key={item}
                  onClick={() => setChartScale(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <div>
              <h4>Refresh interval</h4>
              <p>Controls the live countdown and sync cadence</p>
            </div>
            <div className="segmented">
              {refreshIntervals.map((item) => (
                <button
                  className={refreshMs === item.value ? "active" : ""}
                  key={item.value}
                  onClick={() => setRefreshMs(item.value)}
                  type="button"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row">
            <div>
              <h4>Sessions list</h4>
              <p>Choose the primary identity column</p>
            </div>
            <div className="segmented">
              {(["workspace", "session"] as const).map((item) => (
                <button
                  className={sessionListMode === item ? "active" : ""}
                  key={item}
                  onClick={() => setSessionListMode(item)}
                  type="button"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-row threshold-row">
            <div>
              <h4>Spend thresholds</h4>
              <p>Colors session costs when a session crosses the configured estimate</p>
            </div>
            <div className="threshold-controls">
              <label>
                <span className="threshold-swatch warn" />
                Warn
                <input
                  min="0"
                  onChange={(event) => updateSpendThreshold("warn", event.target.value)}
                  step="0.25"
                  type="number"
                  value={spendThresholds.warn}
                />
              </label>
              <label>
                <span className="threshold-swatch danger" />
                High
                <input
                  min={spendThresholds.warn}
                  onChange={(event) => updateSpendThreshold("danger", event.target.value)}
                  step="0.25"
                  type="number"
                  value={spendThresholds.danger}
                />
              </label>
            </div>
          </div>
          <button className="clear-prefs" onClick={clearPrefs} type="button">
            Clear preferences
          </button>
        </div>
      </div>
    </section>
  );
}

function StateBadge({ state }: { state: SessionState }) {
  return (
    <span className={`state-badge ${state}`}>
      <span />
      {state}
    </span>
  );
}

function CacheBar({ ratio }: { ratio: number }) {
  const pct = Math.round(ratio * 100);
  const color =
    ratio >= 0.6
      ? "var(--token-cache-read)"
      : ratio >= 0.3
        ? "var(--token-cost)"
        : "var(--destructive)";
  return (
    <div className="cache-bar">
      <div>
        <span style={{ background: color, width: `${pct}%` }} />
      </div>
      <strong>{pct}%</strong>
    </div>
  );
}

function getSpendTone(value: number, thresholds: SpendThresholds): "normal" | "warn" | "danger" {
  if (value >= thresholds.danger) {
    return "danger";
  }
  if (value >= thresholds.warn) {
    return "warn";
  }
  return "normal";
}

function UpdatedClock({ generatedAt }: { generatedAt: string | undefined }) {
  const [now, setNow] = useState("");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
      );
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);
  return (
    <div className="updated-clock">
      Updated {now || "--"}
      {generatedAt ? <span>{formatAge(generatedAt)}</span> : null}
    </div>
  );
}

const axisTick = {
  fill: "var(--muted-foreground)",
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: 10,
};
const axisTickSmall = {
  fill: "var(--muted-foreground)",
  fontFamily: "JetBrains Mono, ui-monospace, monospace",
  fontSize: 9,
};

const logValue = (value: number | undefined): number => Math.log10(Math.max(0, value ?? 0) + 1);

const unlogValue = (value: number): number => Math.max(0, Math.pow(10, value) - 1);

function toChartData(bins: UsageBin[]): ChartPoint[] {
  const tickLabels = formatTickLabels(bins);
  return bins.map((bin, index) => ({
    cacheRead: bin.totals.cacheRead,
    cost: bin.totals.costUsd,
    end: bin.end,
    input: bin.totals.inputFresh,
    output: bin.totals.output,
    rangeLabel: formatRangeLabel(bin.start, bin.end),
    reasoning: bin.totals.reasoning,
    start: bin.start,
    sessions: bin.totals.activeSessions,
    tickLabel: tickLabels[index] ?? "",
    total: bin.totals.totalTokens,
  }));
}

function toUiSession(session: SessionSummary): UiSession {
  return {
    cacheHitRatio: session.totals.cacheHitRatio ?? 0,
    cacheRead: session.totals.cacheRead,
    cacheWrite: session.totals.cacheWrite,
    cost: session.totals.costUsd,
    firstActivity: formatClock(session.firstActivityAt),
    id: session.nativeSessionId,
    inputTokens: session.totals.inputFresh,
    lastActivity: session.lastActivityAt,
    lastActivityRelative: formatAge(session.lastActivityAt),
    models: session.models,
    outputTokens: session.totals.output,
    provider: session.provider,
    reasoningTokens: session.totals.reasoning,
    state: session.state,
    workspace: session.workspaceLabel ?? session.workspaceId ?? "local",
  };
}

function emptyTotals(): UsageTotals {
  return {
    activeSessions: 0,
    cacheHitRatio: null,
    cacheRead: 0,
    cacheWrite: 0,
    costUsd: 0,
    inputFresh: 0,
    lastActivityAt: null,
    output: 0,
    reasoning: 0,
    totalTokens: 0,
  };
}

function formatNumber(value: number | undefined): string {
  const n = value ?? 0;
  if (n >= 1_000_000_000_000) {
    return `${trimFixed(n / 1_000_000_000_000, 2)}T`;
  }
  if (n >= 1_000_000_000) {
    return `${trimFixed(n / 1_000_000_000, 2)}B`;
  }
  if (n >= 1_000_000) {
    return `${trimFixed(n / 1_000_000, 2)}M`;
  }
  if (n >= 1_000) {
    return `${trimFixed(n / 1_000, 1)}k`;
  }
  return Math.round(n).toLocaleString();
}

function formatAxisNumber(value: number | undefined): string {
  const n = value ?? 0;
  if (n >= 1_000_000_000_000) {
    return `${trimFixed(n / 1_000_000_000_000, 1)}T`;
  }
  if (n >= 1_000_000_000) {
    return `${trimFixed(n / 1_000_000_000, 1)}B`;
  }
  if (n >= 1_000_000) {
    return `${trimFixed(n / 1_000_000, 1)}M`;
  }
  if (n >= 1_000) {
    return `${trimFixed(n / 1_000, 0)}k`;
  }
  return Math.round(n).toLocaleString();
}

function trimFixed(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, "$1");
}

function formatCost(value: number | undefined): string {
  const n = value ?? 0;
  if (n > 0 && n < 0.01) {
    return "<$0.01";
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

function formatPercent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

function formatClock(value: string | undefined): string {
  if (!value) {
    return "--";
  }
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatAge(value: string | null | undefined): string {
  if (!value) {
    return "no activity";
  }
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  if (diff < 60_000) {
    return `${Math.round(diff / 1000)}s ago`;
  }
  if (diff < 60 * 60_000) {
    return `${Math.round(diff / 60_000)}m ago`;
  }
  if (diff < 24 * 60 * 60_000) {
    return `${Math.round(diff / (60 * 60_000))}h ago`;
  }
  return `${Math.round(diff / (24 * 60 * 60_000))}d ago`;
}

function formatAgeShort(value: string | null | undefined): string {
  if (!value) {
    return "--";
  }
  return formatAge(value).replace(" ago", "");
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatRangeLabel(start: string | undefined, end: string | undefined): string {
  if (!start || !end) {
    return "--";
  }
  const startDate = new Date(start);
  const endDate = new Date(end);
  const sameDay = startDate.toDateString() === endDate.toDateString();
  const date = startDate.toLocaleDateString([], { day: "numeric", month: "short" });
  const startTime = startDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const endTime = endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) {
    return `${date}, ${startTime}-${endTime}`;
  }
  const endDateLabel = endDate.toLocaleDateString([], { day: "numeric", month: "short" });
  return `${date} ${startTime} - ${endDateLabel} ${endTime}`;
}

function formatTickLabels(bins: UsageBin[]): string[] {
  if (bins.length === 0) {
    return [];
  }
  const labels = Array.from({ length: bins.length }, () => "");
  const first = Date.parse(bins[0]?.start ?? "");
  const last = Date.parse(bins.at(-1)?.end ?? "");
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return labels;
  }
  const rangeMs = last - first;
  const rangeDays = Math.max(1, Math.ceil(rangeMs / dayMs));
  if (rangeMs > 14 * dayMs) {
    const monthBoundaryIndexes: number[] = [];
    for (let index = 1; index < bins.length - 1; index += 1) {
      const current = new Date(bins[index]!.start);
      const previous = new Date(bins[index - 1]!.start);
      if (
        current.getMonth() !== previous.getMonth() ||
        current.getFullYear() !== previous.getFullYear()
      ) {
        monthBoundaryIndexes.push(index);
      }
    }
    const maxMiddleLabels = rangeDays > 180 ? 4 : 6;
    const monthStep = Math.max(1, Math.ceil(monthBoundaryIndexes.length / maxMiddleLabels));
    const selected = new Set<number>([0, bins.length - 1]);
    monthBoundaryIndexes.forEach((index, position) => {
      if (position % monthStep === 0) {
        selected.add(index);
      }
    });
    if (selected.size <= 2 && bins.length > 2) {
      const stride = Math.max(1, Math.ceil((bins.length - 2) / 4));
      for (let index = stride; index < bins.length - 1; index += stride) {
        selected.add(index);
      }
    }
    for (const index of selected) {
      const start = bins[index]?.start;
      if (start) {
        labels[index] = formatDateTick(start);
      }
    }
    return labels;
  }
  const stride = Math.max(1, Math.ceil(bins.length / 8));
  for (let index = 0; index < bins.length; index += 1) {
    if (index !== 0 && index !== bins.length - 1 && index % stride !== 0) {
      continue;
    }
    const start = bins[index]?.start;
    if (!start) {
      continue;
    }
    if (rangeMs > 36 * hourMs) {
      const previous = bins[index - 1]?.start;
      const isFirstOfDay =
        !previous || new Date(previous).toDateString() !== new Date(start).toDateString();
      labels[index] = isFirstOfDay ? formatDateTick(start) : "";
      continue;
    }
    if (rangeMs > 12 * hourMs) {
      labels[index] = formatDateTick(start);
      continue;
    }
    labels[index] = new Date(start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return labels;
}

function formatDateTick(value: string): string {
  return new Date(value).toLocaleDateString([], { day: "numeric", month: "short" });
}

function shortModel(model: string): string {
  return displayModel(model).slice(0, 28);
}

function displayModel(model: string): string {
  if (model === "All") {
    return model;
  }
  if (model.startsWith("gpt-")) {
    return `GPT-${model
      .slice(4)
      .split("-")
      .map((part) => (part === "codex" ? "Codex" : part))
      .join(" ")}`;
  }
  return model;
}

const styles = `
:root {
  color-scheme: light;
  --background: oklch(0.985 0.002 260);
  --foreground: oklch(0.22 0.012 260);
  --surface: oklch(0.965 0.003 260);
  --surface-elevated: oklch(0.945 0.004 260);
  --card: oklch(1 0 0);
  --muted: oklch(0.94 0.005 260);
  --muted-foreground: oklch(0.48 0.014 260);
  --border: oklch(0.9 0.006 260);
  --primary: oklch(0.55 0.17 235);
  --primary-foreground: oklch(0.99 0.002 260);
  --destructive: oklch(0.55 0.22 25);
  --token-input: oklch(0.55 0.17 235);
  --token-output: oklch(0.55 0.16 155);
  --token-reasoning: oklch(0.55 0.2 295);
  --token-cache-read: oklch(0.55 0.13 200);
  --token-cache-write: oklch(0.5 0.09 200);
  --token-cost: oklch(0.62 0.17 65);
  --spend-warn: oklch(0.62 0.17 65);
  --spend-danger: oklch(0.55 0.22 25);
  --status-active: oklch(0.55 0.16 155);
  --status-idle: oklch(0.62 0.17 65);
  --status-stale: oklch(0.55 0.03 260);
  --status-closed: oklch(0.65 0.015 260);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--background);
  color: var(--foreground);
}
.dark {
  color-scheme: dark;
  --background: oklch(0.16 0.012 260);
  --foreground: oklch(0.97 0.005 260);
  --surface: oklch(0.19 0.013 260);
  --surface-elevated: oklch(0.22 0.014 260);
  --card: oklch(0.19 0.013 260);
  --muted: oklch(0.24 0.014 260);
  --muted-foreground: oklch(0.66 0.018 260);
  --border: oklch(0.28 0.014 260);
  --primary: oklch(0.72 0.16 230);
  --primary-foreground: oklch(0.16 0.012 260);
  --destructive: oklch(0.65 0.21 25);
  --token-input: oklch(0.72 0.16 230);
  --token-output: oklch(0.74 0.17 155);
  --token-reasoning: oklch(0.7 0.2 295);
  --token-cache-read: oklch(0.78 0.13 200);
  --token-cache-write: oklch(0.62 0.09 200);
  --token-cost: oklch(0.78 0.16 75);
  --spend-warn: oklch(0.78 0.16 75);
  --spend-danger: oklch(0.68 0.2 25);
  --status-active: oklch(0.74 0.17 155);
  --status-idle: oklch(0.78 0.16 75);
  --status-stale: oklch(0.65 0.04 260);
  --status-closed: oklch(0.45 0.02 260);
}
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; background: var(--background); color: var(--foreground); -webkit-font-smoothing: antialiased; }
button, input, select { font: inherit; }
button { cursor: pointer; }
.icon { width: 14px; height: 14px; }
.app { min-height: 100vh; background: var(--background); color: var(--foreground); }
.topbar { position: sticky; top: 0; z-index: 40; background: color-mix(in oklab, var(--background) 86%, transparent); backdrop-filter: blur(16px); border-bottom: 1px solid var(--border); }
.scan-line { position: absolute; left: 0; right: 0; top: 0; height: 1px; overflow: hidden; opacity: 0; }
.scan-line.active { opacity: 1; }
.scan-line div { width: 33%; height: 100%; background: color-mix(in oklab, var(--primary) 68%, transparent); animation: scan 2.4s linear infinite; }
.topbar-main, .filterbar, .main { max-width: 1480px; margin: 0 auto; padding-left: 24px; padding-right: 24px; }
.topbar-main { height: 56px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.brand-block, .brand-identity, .top-actions, .filterbar, .filter-label, .select-control, .select-control > button, .metric-top > div, .legend, .live-status, .workspace-cell, .cache-bar, .sessions-head > div, .sessions-tools { display: flex; align-items: center; }
.brand-block { gap: 20px; min-width: 0; }
.brand-identity { gap: 8px; flex: 0 0 auto; border: 0; background: transparent; color: var(--foreground); padding: 0; }
.brand-mark { width: 24px; height: 24px; border-radius: 4px; background: var(--primary); display: grid; place-items: center; flex: 0 0 auto; }
.brand-mark div { width: 8px; height: 8px; border-radius: 99px; background: var(--primary-foreground); }
.brand-identity > span { font-size: 14px; font-weight: 650; letter-spacing: 0; }
nav { display: flex; align-items: center; gap: 4px; font-size: 12px; }
nav button { border: 0; height: 28px; border-radius: 6px; padding: 0 10px; color: var(--muted-foreground); background: transparent; }
nav button.active { color: var(--foreground); background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); }
.top-actions { gap: 8px; }
.action-btn, .icon-btn { height: 32px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--muted-foreground); display: inline-flex; align-items: center; justify-content: center; transition: 160ms ease; }
.action-btn { gap: 6px; padding: 0 10px; font-size: 12px; }
.icon-btn { width: 32px; }
.action-btn:hover, .icon-btn:hover { background: var(--surface-elevated); color: var(--foreground); }
.live-status { gap: 10px; height: 32px; border-radius: 6px; padding: 0 12px 0 10px; background: color-mix(in oklab, var(--status-active) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--status-active) 25%, transparent); }
.live-status span { color: var(--status-active); font: 10px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; }
.live-ring { width: 14px; height: 14px; transform: rotate(-90deg); }
.live-ring circle { fill: none; stroke-width: 4; }
.live-ring circle:first-child { stroke: color-mix(in oklab, var(--status-active) 25%, transparent); }
.live-ring circle:last-child { stroke: var(--status-active); transition: all 1s linear; stroke-linecap: round; }
.filterbar { min-height: 44px; border-top: 1px solid color-mix(in oklab, var(--border) 60%, transparent); gap: 8px; overflow: visible; }
.filter-label { gap: 6px; flex: 0 0 auto; color: var(--muted-foreground); }
.filter-label span, .select-control span, .reset-btn, .panel-head p, .panel-head span, .metric-top span, .updated-clock, .footer, th, .delta { font: 10px/1.1 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.divider { width: 1px; height: 16px; background: var(--border); flex: 0 0 auto; margin: 0 4px; }
.select-control { position: relative; height: 28px; border-radius: 6px; flex: 0 0 auto; background: transparent; color: var(--muted-foreground); }
.select-control > button { height: 28px; border: 0; border-radius: 6px; background: transparent; color: inherit; gap: 8px; padding: 0 8px 0 10px; transition: 160ms ease; }
.select-control > button:hover, .select-control.open > button { background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); color: var(--foreground); }
.select-control.selected > button { background: color-mix(in oklab, var(--primary) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 30%, transparent); }
.select-control strong { color: var(--foreground); font-size: 12px; font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.select-control.disabled { opacity: 0.45; }
.select-control .icon { opacity: 0.65; pointer-events: none; flex: 0 0 auto; transition: transform 160ms ease; }
.select-control.open > button .icon { transform: rotate(180deg); }
.select-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 80; min-width: 180px; max-height: min(420px, calc(100vh - 140px)); overflow-y: auto; padding: 4px; border-radius: 6px; background: color-mix(in oklab, var(--card) 96%, transparent); border: 1px solid var(--border); box-shadow: 0 18px 48px rgba(0,0,0,0.22); backdrop-filter: blur(12px); }
.select-menu-label { padding: 7px 8px 8px; color: var(--muted-foreground); border-bottom: 1px solid var(--border); margin-bottom: 4px; font: 10px/1 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.select-menu button { width: 100%; height: 30px; border: 0; border-radius: 4px; background: transparent; color: var(--foreground); display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 8px; font: 12px/1 "JetBrains Mono", ui-monospace, monospace; }
.select-menu button:hover, .select-menu button.active { background: var(--surface-elevated); }
.reset-btn { margin-left: auto; border: 0; background: transparent; color: var(--muted-foreground); height: 28px; display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; }
.main { padding-top: 24px; padding-bottom: 32px; display: grid; gap: 24px; }
.page-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
h1, h3, p { margin: 0; }
h1 { font-size: 20px; line-height: 1.2; letter-spacing: 0; }
.page-head p { margin-top: 4px; color: var(--muted-foreground); font: 12px/1.5 "JetBrains Mono", ui-monospace, monospace; }
.updated-clock { color: var(--muted-foreground); display: grid; justify-items: end; gap: 4px; font-variant-numeric: tabular-nums; text-transform: none; }
.metrics { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 12px; }
.metric-card, .panel, .sessions-panel { background: var(--card); border-radius: 8px; box-shadow: inset 0 0 0 1px var(--border); }
.metric-card { min-height: 128px; padding: 16px; display: flex; flex-direction: column; gap: 12px; transition: box-shadow 160ms ease; }
.metric-card:hover { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 35%, transparent); }
.metric-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--muted-foreground); }
.metric-top > div { gap: 6px; min-width: 0; }
.delta.positive { color: var(--status-active); }
.delta.negative { color: var(--destructive); }
.delta.neutral { color: var(--muted-foreground); }
.metric-value { font: 500 24px/1.1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.sparkline { width: 100%; height: 32px; margin-top: auto; }
.metric-sub { color: color-mix(in oklab, var(--muted-foreground) 80%, transparent); font: 10px/1.4 "JetBrains Mono", ui-monospace, monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.live-sub { display: inline-flex; align-items: center; gap: 6px; }
.live-dot { width: 6px; height: 6px; border-radius: 999px; background: var(--status-active); animation: tick 1.6s ease-in-out infinite; flex: 0 0 auto; }
.grid-12 { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 16px; }
.panel { overflow: hidden; }
.primary-chart { grid-column: span 8; }
.model-card { grid-column: span 4; display: flex; flex-direction: column; }
.third { grid-column: span 4; }
.panel-head, .sessions-head { min-height: 52px; padding: 14px 20px; border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.panel-head h3, .sessions-head h3 { font-size: 14px; line-height: 1.2; font-weight: 650; letter-spacing: 0; }
.panel-head p, .panel-head span, .sessions-head span { color: var(--muted-foreground); margin-top: 4px; }
.legend-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.legend { gap: 6px; color: var(--muted-foreground); font: 10px/1 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.legend span { display: inline-block; width: 12px; height: 4px; border-radius: 2px; }
.scale-toggle, .segmented { display: inline-flex; align-items: center; gap: 2px; padding: 2px; border-radius: 6px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); }
.scale-toggle button, .segmented button { height: 24px; border: 0; border-radius: 4px; background: transparent; color: var(--muted-foreground); padding: 0 8px; font: 10px/1 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.08em; }
.scale-toggle button.active, .segmented button.active { background: var(--surface-elevated); color: var(--foreground); }
.chart-frame { padding: 12px; }
.chart-frame.tall { height: 300px; }
.chart-frame.mini { height: 180px; }
.chart-tooltip { min-width: 160px; border-radius: 6px; border: 1px solid var(--border); background: color-mix(in oklab, var(--card) 96%, transparent); backdrop-filter: blur(12px); padding: 10px 12px; box-shadow: 0 18px 48px rgba(0,0,0,0.18); font-size: 12px; }
.tooltip-label { margin-bottom: 6px; color: var(--muted-foreground); font: 10px/1.2 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.tooltip-row { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; align-items: center; gap: 8px; font: 11px/1.6 "JetBrains Mono", ui-monospace, monospace; }
.tooltip-row span { width: 8px; height: 8px; border-radius: 2px; }
.tooltip-row p { color: var(--muted-foreground); }
.model-body { padding: 20px; display: flex; align-items: center; gap: 20px; flex: 1; }
.donut-shell { position: relative; width: 128px; height: 128px; flex: 0 0 auto; }
.donut-center { position: absolute; inset: 0; display: grid; place-content: center; text-align: center; pointer-events: none; }
.donut-center span { color: var(--muted-foreground); font: 9px/1 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.donut-center strong { margin-top: 4px; font: 12px/1 "JetBrains Mono", ui-monospace, monospace; }
.mix-list { flex: 1; display: grid; gap: 8px; min-width: 0; }
.mix-list div { display: grid; grid-template-columns: 6px minmax(0, 1fr) auto; align-items: center; gap: 8px; font-size: 11px; }
.mix-list span, .composition-row div span { width: 6px; height: 6px; border-radius: 999px; }
.mix-list p { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted-foreground); font-family: "JetBrains Mono", ui-monospace, monospace; }
.mix-list strong, .composition-row strong, .provider-row strong { font: 11px/1 "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.composition, .provider-list { padding: 20px; display: grid; gap: 14px; }
.stack-bar { height: 8px; display: flex; overflow: hidden; border-radius: 999px; box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--border) 60%, transparent); }
.composition-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; font-size: 11px; }
.composition-row > div:first-child { display: flex; align-items: center; gap: 6px; color: var(--muted-foreground); }
.mini-track { grid-column: 1 / -1; height: 4px; border-radius: 999px; background: var(--muted); overflow: hidden; }
.mini-track span { display: block; height: 100%; border-radius: inherit; background: var(--primary); }
.provider-row { display: grid; gap: 6px; }
.provider-row > div:first-child { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 12px; }
.provider-row span { color: var(--muted-foreground); font: 10px/1 "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.provider-row p { font-weight: 550; }
.breakdown-panel { grid-column: span 8; }
.breakdown-list, .settings-body { padding: 20px; display: grid; gap: 12px; }
.breakdown-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; align-items: center; gap: 10px; font-size: 12px; }
.breakdown-row > span, .breakdown-row em { color: var(--muted-foreground); font: 10px/1 "JetBrains Mono", ui-monospace, monospace; font-style: normal; font-variant-numeric: tabular-nums; }
.breakdown-row p { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.breakdown-row strong { font: 12px/1 "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.breakdown-row .mini-track { grid-column: 2 / 3; }
.settings-grid { display: grid; grid-template-columns: minmax(0, 680px); }
.settings-panel { width: 100%; }
.settings-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px; border-radius: 6px; background: color-mix(in oklab, var(--surface) 45%, transparent); }
.settings-row h4 { margin: 0; font-size: 13px; line-height: 1.2; }
.settings-row p { margin-top: 4px; color: var(--muted-foreground); font: 11px/1.4 "JetBrains Mono", ui-monospace, monospace; }
.threshold-row { align-items: flex-start; }
.threshold-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.threshold-controls label { height: 32px; display: inline-flex; align-items: center; gap: 6px; border-radius: 6px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); padding: 0 8px; color: var(--muted-foreground); font: 10px/1 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.threshold-controls input { width: 76px; height: 24px; border: 0; border-radius: 4px; background: var(--card); box-shadow: inset 0 0 0 1px var(--border); color: var(--foreground); padding: 0 6px; font: 11px/1 "JetBrains Mono", ui-monospace, monospace; }
.threshold-swatch { width: 9px; height: 9px; border-radius: 2px; }
.threshold-swatch.warn { background: var(--spend-warn); }
.threshold-swatch.danger { background: var(--spend-danger); }
.clear-prefs { justify-self: start; height: 32px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--muted-foreground); padding: 0 10px; font-size: 12px; }
.clear-prefs:hover { background: var(--surface-elevated); color: var(--foreground); }
.sessions-panel { overflow: hidden; }
.sessions-head { flex-wrap: wrap; }
.sessions-head > div:first-child { gap: 12px; }
.sessions-tools { gap: 8px; flex-wrap: wrap; }
.state-tabs { display: flex; gap: 2px; padding: 2px; border-radius: 6px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--border); }
.state-tabs button { border: 0; border-radius: 4px; background: transparent; color: var(--muted-foreground); height: 26px; padding: 0 8px; font: 10px/1 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; display: inline-flex; align-items: center; gap: 6px; }
.state-tabs button.active { background: var(--surface-elevated); color: var(--foreground); }
.state-tabs span { opacity: 0.65; margin: 0; }
.searchbox { position: relative; }
.searchbox .icon { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--muted-foreground); }
.searchbox input { width: 288px; height: 32px; border: 0; border-radius: 6px; background: var(--surface); color: var(--foreground); box-shadow: inset 0 0 0 1px var(--border); padding: 0 32px; font-size: 12px; outline: none; }
.searchbox input:focus { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--primary) 50%, transparent); }
.searchbox button { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: 0; background: transparent; color: var(--muted-foreground); padding: 0; display: grid; place-items: center; }
.table-wrap { overflow-x: auto; }
table { width: 100%; min-width: 1180px; border-collapse: collapse; font-size: 12px; }
thead { background: color-mix(in oklab, var(--surface) 50%, transparent); position: sticky; top: 0; z-index: 1; }
tr { border-bottom: 1px solid color-mix(in oklab, var(--border) 64%, transparent); }
tbody tr:hover { background: color-mix(in oklab, var(--surface) 60%, transparent); }
th, td { padding: 12px 16px; text-align: left; white-space: nowrap; }
th { color: var(--muted-foreground); font-weight: 500; }
th.right, td.right { text-align: right; }
th.sortable { cursor: pointer; user-select: none; }
th span { display: inline-flex; align-items: center; gap: 4px; }
th span.active { color: var(--foreground); }
.workspace-cell { gap: 8px; font-weight: 600; }
.warn-icon { width: 12px; height: 12px; color: var(--token-cost); }
.mono { font-family: "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted-foreground); }
.model-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.model-tags span { padding: 3px 6px; border-radius: 4px; background: color-mix(in oklab, var(--muted) 60%, transparent); box-shadow: inset 0 0 0 1px var(--border); font: 10px/1.2 "JetBrains Mono", ui-monospace, monospace; }
.cost-hot, .cost-warn { color: var(--spend-warn); }
.cost-danger { color: var(--spend-danger); }
.cache-bar { justify-content: flex-end; gap: 8px; }
.cache-bar div { width: 48px; height: 4px; border-radius: 999px; background: var(--muted); overflow: hidden; }
.cache-bar span { display: block; height: 100%; border-radius: inherit; }
.cache-bar strong { width: 36px; text-align: right; font: 12px/1 "JetBrains Mono", ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.state-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 7px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--border); font: 10px/1.2 "JetBrains Mono", ui-monospace, monospace; text-transform: uppercase; letter-spacing: 0.08em; }
.state-badge span { width: 6px; height: 6px; border-radius: 999px; }
.state-badge.active { color: var(--status-active); background: color-mix(in oklab, var(--status-active) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--status-active) 25%, transparent); }
.state-badge.active span { background: var(--status-active); animation: tick 1.6s ease-in-out infinite; }
.state-badge.idle { color: var(--status-idle); background: color-mix(in oklab, var(--status-idle) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--status-idle) 25%, transparent); }
.state-badge.idle span { background: var(--status-idle); }
.state-badge.stale { color: var(--muted-foreground); background: color-mix(in oklab, var(--muted) 60%, transparent); }
.state-badge.stale span { background: var(--status-stale); }
.state-badge.closed { color: color-mix(in oklab, var(--muted-foreground) 70%, transparent); }
.state-badge.closed span { background: var(--status-closed); }
.empty, .empty-row { color: var(--muted-foreground); }
.empty-row { text-align: center; padding: 48px 16px; }
.error-banner { display: flex; align-items: center; gap: 8px; border-radius: 8px; padding: 12px 14px; background: color-mix(in oklab, var(--destructive) 10%, transparent); color: var(--destructive); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--destructive) 25%, transparent); font-size: 13px; }
.footer { color: color-mix(in oklab, var(--muted-foreground) 70%, transparent); padding: 16px 0; }
.entrance { animation: entrance 0.5s cubic-bezier(0.16, 1, 0.3, 1) both; }
@keyframes scan { from { transform: translateX(-100%); } to { transform: translateX(400%); } }
@keyframes tick { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
@keyframes entrance { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (max-width: 1180px) {
  .metrics { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .primary-chart, .model-card, .third, .breakdown-panel { grid-column: span 12; }
}
@media (max-width: 760px) {
  nav, .action-btn { display: none; }
  .topbar-main, .filterbar, .main { padding-left: 14px; padding-right: 14px; }
  .metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .metric-card { min-height: 128px; }
  .sessions-tools { width: 100%; }
  .searchbox, .searchbox input { width: 100%; }
  .state-tabs { width: 100%; overflow-x: auto; }
  .legend-row { display: none; }
  .model-body { flex-direction: column; align-items: stretch; }
}
`;

createRoot(document.getElementById("root")!).render(<App />);
