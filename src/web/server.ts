import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateEvents } from "../core/aggregate.js";
import type { ActiveScope, PricingMode, RunrateExport } from "../core/event.js";
import type { WindowPreset } from "../core/windows.js";
import { collectUsageEvents } from "../adapters/registry.js";

type PeriodPreset =
  | "today"
  | "yesterday"
  | "this-week"
  | "last-week"
  | "this-month"
  | "last-month"
  | "all-time";
type PlotPreset = "auto" | "1m" | "5m" | "15m" | "1h" | "1d";

interface WebDashboardOptions {
  initialWindow: WindowPreset;
  initialScope: ActiveScope;
  pricingMode: PricingMode;
  provider?: string | undefined;
  model?: string | undefined;
  timezone: string;
  port?: string | number | undefined;
  host?: string | undefined;
  open?: boolean | undefined;
}

interface WebUsageResponse {
  period: PeriodOption;
  plot: PlotOption;
  periods: PeriodOption[];
  plots: PlotOption[];
  pollMs: number;
  generatedAt: string;
  data: RunrateExport;
}

interface PeriodOption {
  value: PeriodPreset;
  label: string;
}

interface PlotOption {
  value: PlotPreset;
  label: string;
  binMs: number | null;
}

interface PeriodRange extends PeriodOption {
  sinceMs: number | null;
  untilMs: number;
}

const DEFAULT_PORT = 43871;
const DEFAULT_HOST = "127.0.0.1";
const MAX_PORT_ATTEMPTS = 64;
const MAX_CHART_BINS = 160;
const NORMALIZE_BATCH_SIZE = 2_000;
const RESPONSE_CACHE_MS = 2_000;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

const periodOptions: PeriodOption[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "this-week", label: "This week" },
  { value: "last-week", label: "Last week" },
  { value: "this-month", label: "This month" },
  { value: "last-month", label: "Last month" },
  { value: "all-time", label: "All time" },
];

const plotOptions: PlotOption[] = [
  { value: "auto", label: "Auto", binMs: null },
  { value: "1m", label: "1m", binMs: 60_000 },
  { value: "5m", label: "5m", binMs: 5 * 60_000 },
  { value: "15m", label: "15m", binMs: 15 * 60_000 },
  { value: "1h", label: "1h", binMs: HOUR_MS },
  { value: "1d", label: "1d", binMs: DAY_MS },
];

const responseCache = new Map<string, { expiresAt: number; value: WebUsageResponse }>();
const inFlightResponses = new Map<string, Promise<WebUsageResponse>>();

export const runWebDashboard = async (options: WebDashboardOptions): Promise<void> => {
  const host = options.host ?? DEFAULT_HOST;
  const preferredPort = parsePort(options.port);

  const server = createServer((request, response) => {
    void handleRequest(request, response, options);
  });
  const port = await listenWithPortFallback(server, host, preferredPort);
  const url = `http://${host}:${port}/`;

  process.stdout.write(`Runrate dashboard: ${url}\n`);
  if (options.open !== false) {
    openBrowser(url);
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
};

const handleRequest = async (
  request: IncomingMessage,
  response: ServerResponse,
  options: WebDashboardOptions,
): Promise<void> => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (request.method !== "GET") {
      sendText(response, 405, "Method not allowed");
      return;
    }

    if (url.pathname === "/") {
      sendHtml(response, renderIndexHtml(isDevMode()));
      return;
    }

    if (url.pathname === "/web/app.js") {
      const script = await readFile(new URL("./web/app.global.js", import.meta.url), "utf8");
      send(response, 200, "application/javascript; charset=utf-8", script);
      return;
    }

    if (url.pathname === "/favicon.png") {
      sendBinary(response, 200, "image/png", await readPackageAsset("favicon.png"));
      return;
    }

    if (url.pathname === "/api/usage") {
      sendJson(response, 200, await loadUsageResponse(options, url.searchParams));
      return;
    }

    if (url.pathname === "/api/dev/revision" && isDevMode()) {
      sendJson(response, 200, {
        revision: process.env.RUNRATE_DEV_REVISION ?? "dev",
      });
      return;
    }

    sendText(response, 404, "Not found");
  } catch (error) {
    sendJson(response, 500, {
      error: (error as Error).message,
    });
  }
};

const loadUsageResponse = async (
  options: WebDashboardOptions,
  params: URLSearchParams,
): Promise<WebUsageResponse> => {
  const period = readPeriod(params.get("period"));
  const plot = readPlot(params.get("plot")).value;
  const provider = params.get("provider") || options.provider;
  const model = params.get("model") || options.model;
  const cacheKey = JSON.stringify({
    model,
    period,
    plot,
    provider,
    pricingMode: options.pricingMode,
    scope: options.initialScope,
    timezone: options.timezone,
  });
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const existing = inFlightResponses.get(cacheKey);
  if (existing) {
    return existing;
  }

  const pending = loadUsageResponseUncached(options, {
    cacheKey,
    model,
    period,
    plot,
    provider,
  });
  inFlightResponses.set(cacheKey, pending);
  try {
    return await pending;
  } finally {
    inFlightResponses.delete(cacheKey);
  }
};

const loadUsageResponseUncached = async (
  options: WebDashboardOptions,
  args: {
    cacheKey: string;
    model?: string | undefined;
    period: PeriodPreset;
    plot: PlotPreset;
    provider?: string | undefined;
  },
): Promise<WebUsageResponse> => {
  const result = await loadDashboardData(
    options,
    args.period,
    args.plot,
    args.provider,
    args.model,
  );

  const value = {
    period: periodOptions.find((item) => item.value === args.period) ?? periodOptions[0]!,
    plot: result.plot,
    periods: periodOptions,
    plots: plotOptions,
    pollMs: result.pollMs,
    generatedAt: new Date().toISOString(),
    data: result.data,
  };
  responseCache.set(args.cacheKey, {
    expiresAt: Date.now() + RESPONSE_CACHE_MS,
    value,
  });
  return value;
};

const loadDashboardData = async (
  options: WebDashboardOptions,
  period: PeriodPreset,
  plot: PlotPreset,
  provider?: string | undefined,
  model?: string | undefined,
): Promise<{
  data: RunrateExport;
  plot: PlotOption;
  pollMs: number;
}> => {
  const now = new Date();
  const range = resolvePeriodRange(period, now);
  const rangeDurationMs = Math.max(1, range.untilMs - (range.sinceMs ?? range.untilMs));
  const binMs = plot === "auto" ? chooseBinMs(rangeDurationMs) : readPlot(plot).binMs!;
  const scanSinceMs = minimumSince(range, binMs);
  const { events } = await collectUsageEvents({
    pricingMode: options.pricingMode,
    timezone: options.timezone,
    sinceMs: scanSinceMs,
    normalizeBatchSize: NORMALIZE_BATCH_SIZE,
  });

  const data = aggregateEvents(events, {
    window: options.initialWindow,
    windowLabel: range.label,
    sinceMs: range.sinceMs,
    untilMs: range.untilMs,
    binMs,
    maxBins: MAX_CHART_BINS,
    scope: options.initialScope,
    pricingMode: options.pricingMode,
    provider,
    model,
  });

  return {
    data,
    plot: {
      value: plot,
      label: plot === "auto" ? `Auto (${formatBin(binMs)})` : readPlot(plot).label,
      binMs,
    },
    pollMs: period === "today" ? Math.max(1500, Math.min(10_000, binMs)) : 15_000,
  };
};

const resolvePeriodRange = (period: PeriodPreset, now: Date): PeriodRange => {
  const nowMs = now.getTime();
  const today = startOfDay(now);
  const yesterday = addDays(today, -1);
  const week = startOfWeek(now);
  const lastWeek = addDays(week, -7);
  const month = startOfMonth(now);
  const lastMonth = addMonths(month, -1);

  switch (period) {
    case "yesterday":
      return {
        value: period,
        label: "Yesterday",
        sinceMs: yesterday.getTime(),
        untilMs: today.getTime(),
      };
    case "this-week":
      return { value: period, label: "This week", sinceMs: week.getTime(), untilMs: nowMs };
    case "last-week":
      return {
        value: period,
        label: "Last week",
        sinceMs: lastWeek.getTime(),
        untilMs: week.getTime(),
      };
    case "this-month":
      return { value: period, label: "This month", sinceMs: month.getTime(), untilMs: nowMs };
    case "last-month":
      return {
        value: period,
        label: "Last month",
        sinceMs: lastMonth.getTime(),
        untilMs: month.getTime(),
      };
    case "all-time":
      return { value: period, label: "All time", sinceMs: null, untilMs: nowMs };
    case "today":
      return { value: period, label: "Today", sinceMs: today.getTime(), untilMs: nowMs };
  }
};

const minimumSince = (range: PeriodRange, binMs: number): number | undefined => {
  if (range.sinceMs === null) {
    return undefined;
  }
  return Math.max(0, range.sinceMs - binMs);
};

const readPeriod = (value: string | null): PeriodPreset => {
  if (!value) {
    return "today";
  }
  if (periodOptions.some((option) => option.value === value)) {
    return value as PeriodPreset;
  }
  throw new Error(`Unsupported period "${value}".`);
};

const readPlot = (value: string | null | PlotPreset): PlotOption => {
  const selected = value ?? "auto";
  const plot = plotOptions.find((option) => option.value === selected);
  if (!plot) {
    throw new Error(`Unsupported plot "${selected}".`);
  }
  return plot;
};

const chooseBinMs = (durationMs: number): number => {
  if (durationMs <= 2 * HOUR_MS) {
    return 60_000;
  }
  if (durationMs <= DAY_MS) {
    return 5 * 60_000;
  }
  if (durationMs <= 7 * DAY_MS) {
    return HOUR_MS;
  }
  return DAY_MS;
};

const formatBin = (binMs: number): string => {
  if (binMs < HOUR_MS) {
    return `${Math.round(binMs / 60_000)}m`;
  }
  if (binMs < DAY_MS) {
    return `${Math.round(binMs / HOUR_MS)}h`;
  }
  return `${Math.round(binMs / DAY_MS)}d`;
};

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const startOfWeek = (date: Date): Date => {
  const start = startOfDay(date);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(start, offset);
};

const startOfMonth = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), 1);

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const addMonths = (date: Date, months: number): Date =>
  new Date(date.getFullYear(), date.getMonth() + months, 1);

const listenWithPortFallback = async (
  server: ReturnType<typeof createServer>,
  host: string,
  preferredPort: number,
): Promise<number> => {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset += 1) {
    const port = preferredPort + offset;
    const listening = await tryListen(server, host, port);
    if (listening) {
      return port;
    }
  }

  throw new Error(
    `No local port available from ${preferredPort} to ${preferredPort + MAX_PORT_ATTEMPTS - 1}`,
  );
};

const tryListen = (
  server: ReturnType<typeof createServer>,
  host: string,
  port: number,
): Promise<boolean> =>
  new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      cleanup();
      if (error.code === "EADDRINUSE" || error.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    };
    const onListening = () => {
      cleanup();
      resolve(true);
    };
    const cleanup = () => {
      server.off("error", onError);
      server.off("listening", onListening);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });

const openBrowser = (url: string): void => {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
  });
  child.once("error", () => undefined);
  child.unref();
};

const parsePort = (value: string | number | undefined): number => {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`Invalid port "${String(value)}"; use a number from 1024 to 65535`);
  }
  return port;
};

const isDevMode = (): boolean => process.env.RUNRATE_DEV === "1";

const readPackageAsset = async (name: string): Promise<Buffer> => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(moduleDir, "..", "assets", name),
    join(moduleDir, "..", "..", "assets", name),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return await readFile(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to read asset ${name}`);
};

const renderIndexHtml = (devMode: boolean): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" type="image/png" href="/favicon.png" />
    <title>Runrate</title>
  </head>
  <body>
    <div id="root"></div>
    <script src="/web/app.js"></script>
    ${
      devMode
        ? `<script>
      (() => {
        let current = "";
        const check = async () => {
          try {
            const response = await fetch("/api/dev/revision", { cache: "no-store" });
            const data = await response.json();
            if (current && data.revision !== current) location.reload();
            current = data.revision;
          } catch {}
        };
        setInterval(check, 1000);
        void check();
      })();
    </script>`
        : ""
    }
  </body>
</html>`;

const sendHtml = (response: ServerResponse, body: string): void => {
  send(response, 200, "text/html; charset=utf-8", body);
};

const sendText = (response: ServerResponse, status: number, body: string): void => {
  send(response, status, "text/plain; charset=utf-8", body);
};

const sendJson = (response: ServerResponse, status: number, body: unknown): void => {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(body));
};

const sendBinary = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: Buffer,
): void => {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
};

const send = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
): void => {
  response.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  response.end(body);
};
