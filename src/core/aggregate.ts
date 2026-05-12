import {
  addUsage,
  emptyTokenSnapshot,
  type ActiveScope,
  type CategoryBreakdown,
  type ModelBreakdown,
  type NormalizedUsageEvent,
  type PricingMode,
  type ProviderSummary,
  type RunrateExport,
  type SessionSummary,
  type TokenSnapshot,
  type UsageBin,
  usageTotals,
} from "./event.js";
import { eventMatchesScope } from "./scope.js";
import { floorToBin, type WindowPreset, WINDOW_PRESETS } from "./windows.js";

export interface AggregateOptions {
  now?: Date;
  window: WindowPreset;
  sinceMs?: number | null | undefined;
  untilMs?: number | undefined;
  binMs?: number | undefined;
  maxBins?: number | undefined;
  windowLabel?: string | undefined;
  scope: ActiveScope;
  pricingMode: PricingMode;
  provider?: string | undefined;
  model?: string | undefined;
}

interface Accumulator {
  usage: TokenSnapshot;
  costUsd: number;
  eventCount: number;
  lastActivityAt: string | null;
  sessions: Set<string>;
}

const createAccumulator = (): Accumulator => ({
  usage: emptyTokenSnapshot(),
  costUsd: 0,
  eventCount: 0,
  lastActivityAt: null,
  sessions: new Set(),
});

const addEventToAccumulator = (accumulator: Accumulator, event: NormalizedUsageEvent): void => {
  accumulator.usage = addUsage(accumulator.usage, event.usage);
  accumulator.costUsd += event.cost.effectiveUsd;
  accumulator.eventCount += 1;
  accumulator.sessions.add(event.nativeSessionId);
  if (!accumulator.lastActivityAt || event.occurredAt > accumulator.lastActivityAt) {
    accumulator.lastActivityAt = event.occurredAt;
  }
};

const eventPassesFilters = (
  event: NormalizedUsageEvent,
  options: AggregateOptions,
  sinceMs: number | null,
  untilMs: number,
): boolean => {
  const occurredMs = Date.parse(event.occurredAt);
  if (
    !Number.isFinite(occurredMs) ||
    (sinceMs !== null && occurredMs < sinceMs) ||
    occurredMs > untilMs
  ) {
    return false;
  }
  if (!eventMatchesScope(event, options.scope)) {
    return false;
  }
  if (options.provider && event.provider !== options.provider) {
    return false;
  }
  if (options.model && event.modelId !== options.model) {
    return false;
  }
  return true;
};

const sessionState = (lastActivityAt: string, nowMs: number): SessionSummary["state"] => {
  const ageMs = nowMs - Date.parse(lastActivityAt);
  if (ageMs <= 2 * 60_000) {
    return "active";
  }
  if (ageMs <= 15 * 60_000) {
    return "idle";
  }
  if (ageMs <= 24 * 60 * 60_000) {
    return "stale";
  }
  return "closed";
};

const toTotals = (accumulator: Accumulator) =>
  usageTotals(
    accumulator.usage,
    accumulator.costUsd,
    accumulator.sessions.size,
    accumulator.lastActivityAt,
  );

export const aggregateEvents = (
  events: NormalizedUsageEvent[],
  options: AggregateOptions,
): RunrateExport => {
  const preset = WINDOW_PRESETS[options.window];
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const untilMs = options.untilMs ?? nowMs;
  const sinceMs =
    options.sinceMs === null ? null : (options.sinceMs ?? untilMs - preset.durationMs);
  const binMs = options.binMs ?? preset.binMs;
  const maxBins = options.maxBins ?? Number.POSITIVE_INFINITY;

  const filtered = events.filter((event) => eventPassesFilters(event, options, sinceMs, untilMs));
  filtered.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const globalAccumulator = createAccumulator();
  const binAccumulators = new Map<number, Accumulator>();
  const modelAccumulators = new Map<string, Accumulator>();
  const providerAccumulators = new Map<string, Accumulator>();
  const categoryAccumulators = new Map<string, Accumulator>();
  const sessionEvents = new Map<string, NormalizedUsageEvent[]>();

  for (const event of filtered) {
    addEventToAccumulator(globalAccumulator, event);

    const binStart = floorToBin(Date.parse(event.occurredAt), binMs);
    addEventToAccumulator(getOrCreate(binAccumulators, binStart, createAccumulator), event);

    const modelKey = `${event.provider}\u0000${event.modelId}`;
    addEventToAccumulator(getOrCreate(modelAccumulators, modelKey, createAccumulator), event);
    addEventToAccumulator(
      getOrCreate(providerAccumulators, event.provider, createAccumulator),
      event,
    );
    addEventToAccumulator(
      getOrCreate(
        categoryAccumulators,
        `${event.meta.category?.id ?? "other"}\u0000${event.meta.category?.label ?? "Other"}`,
        createAccumulator,
      ),
      event,
    );

    const sessionKey = `${event.provider}\u0000${event.nativeSessionId}`;
    const existing = sessionEvents.get(sessionKey);
    if (existing) {
      existing.push(event);
    } else {
      sessionEvents.set(sessionKey, [event]);
    }
  }

  const bins: UsageBin[] = [];
  const firstEventMs = Date.parse(filtered[0]?.occurredAt ?? new Date(untilMs).toISOString());
  const rangeStartMs = sinceMs ?? firstEventMs;
  const lastBin = floorToBin(untilMs, binMs);
  const maxBinsStartMs =
    Number.isFinite(maxBins) && maxBins > 0 ? lastBin - (maxBins - 1) * binMs : rangeStartMs;
  const firstBin = floorToBin(Math.max(rangeStartMs, maxBinsStartMs), binMs);
  for (let start = firstBin; start <= lastBin; start += binMs) {
    const accumulator = binAccumulators.get(start) ?? createAccumulator();
    bins.push({
      start: new Date(start).toISOString(),
      end: new Date(start + binMs).toISOString(),
      totals: toTotals(accumulator),
    });
  }

  const models: ModelBreakdown[] = [...modelAccumulators.entries()]
    .map(([key, accumulator]) => {
      const [provider, modelId] = key.split("\u0000");
      return {
        provider: provider ?? "unknown",
        modelId: modelId ?? "unknown",
        totals: toTotals(accumulator),
      };
    })
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);

  const providers: ProviderSummary[] = [...providerAccumulators.entries()]
    .map(([provider, accumulator]) => ({
      provider,
      totals: toTotals(accumulator),
    }))
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);

  const categories: CategoryBreakdown[] = [...categoryAccumulators.entries()]
    .map(([key, accumulator]) => {
      const [id, label] = key.split("\u0000");
      return {
        category: {
          id: (id ?? "other") as CategoryBreakdown["category"]["id"],
          label: label ?? "Other",
        },
        eventCount: accumulator.eventCount,
        totals: toTotals(accumulator),
      };
    })
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);

  const sessions: SessionSummary[] = [...sessionEvents.values()]
    .map((session) => summarizeSession(session, nowMs))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  return {
    generatedAt: now.toISOString(),
    window: options.windowLabel ?? options.window,
    scope: options.scope,
    pricingMode: options.pricingMode,
    totals: toTotals(globalAccumulator),
    bins,
    sessions,
    models,
    providers,
    categories,
  };
};

const summarizeSession = (events: NormalizedUsageEvent[], nowMs: number): SessionSummary => {
  const accumulator = createAccumulator();
  const modelAccumulators = new Map<string, Accumulator>();
  let firstActivityAt = events[0]?.occurredAt ?? new Date(0).toISOString();
  let lastActivityAt = firstActivityAt;
  const first = events[0];

  for (const event of events) {
    addEventToAccumulator(accumulator, event);
    firstActivityAt = event.occurredAt < firstActivityAt ? event.occurredAt : firstActivityAt;
    lastActivityAt = event.occurredAt > lastActivityAt ? event.occurredAt : lastActivityAt;
    addEventToAccumulator(
      getOrCreate(modelAccumulators, `${event.provider}\u0000${event.modelId}`, createAccumulator),
      event,
    );
  }

  const modelBreakdown: ModelBreakdown[] = [...modelAccumulators.entries()]
    .map(([key, modelAccumulator]) => {
      const [provider, modelId] = key.split("\u0000");
      return {
        provider: provider ?? "unknown",
        modelId: modelId ?? "unknown",
        totals: toTotals(modelAccumulator),
      };
    })
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens);

  return {
    provider: first?.provider ?? "unknown",
    nativeSessionId: first?.nativeSessionId ?? "unknown",
    workspaceId: first?.workspaceId,
    workspaceLabel: first?.workspaceLabel,
    models: modelBreakdown.map((model) => model.modelId),
    modelBreakdown,
    totals: toTotals(accumulator),
    firstActivityAt,
    lastActivityAt,
    state: sessionState(lastActivityAt, nowMs),
  };
};

const getOrCreate = <K, V>(map: Map<K, V>, key: K, create: () => V): V => {
  const existing = map.get(key);
  if (existing) {
    return existing;
  }
  const value = create();
  map.set(key, value);
  return value;
};
