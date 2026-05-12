export type PricingMode = "vendor" | "calculated" | "hybrid" | "compare";

export type ScopeKind = "global" | "account" | "workspace" | "session" | "billing-block";

export type UsageCategoryId =
  | "coding"
  | "feature-dev"
  | "debugging"
  | "testing"
  | "build-deploy"
  | "git-ops"
  | "refactoring"
  | "exploration"
  | "conversation"
  | "delegation"
  | "docs"
  | "other";

export interface UsageCategory {
  id: UsageCategoryId;
  label: string;
}

export interface ActiveScope {
  kind: ScopeKind;
  value?: string | undefined;
  label: string;
}

export interface TokenSnapshot {
  inputFresh: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UsageCost {
  vendorUsd?: number | undefined;
  calculatedUsd?: number | undefined;
  effectiveUsd: number;
  source: "vendor" | "calculated" | "estimated";
}

export interface NormalizedUsageEvent {
  id: string;
  provider: string;
  installationId: string;
  accountId?: string | undefined;
  workspaceId?: string | undefined;
  workspaceLabel?: string | undefined;
  nativeSessionId: string;
  logicalRequestId: string;
  occurredAt: string;
  firstSeenAt?: string | undefined;
  lastSeenAt?: string | undefined;
  modelId: string;
  modelDisplayName?: string | undefined;
  usage: TokenSnapshot;
  cost: UsageCost;
  meta: {
    sourcePath: string;
    adapterVersion: string;
    rawCursor: string;
    replayed?: boolean | undefined;
    inferredModel?: boolean | undefined;
    category?: UsageCategory | undefined;
    warnings?: string[] | undefined;
  };
}

export interface UsageTotals extends TokenSnapshot {
  totalTokens: number;
  costUsd: number;
  cacheHitRatio: number | null;
  activeSessions: number;
  lastActivityAt: string | null;
}

export interface UsageBin {
  start: string;
  end: string;
  totals: UsageTotals;
}

export interface ModelBreakdown {
  provider: string;
  modelId: string;
  modelDisplayName?: string | undefined;
  totals: UsageTotals;
}

export interface SessionSummary {
  provider: string;
  nativeSessionId: string;
  workspaceId?: string | undefined;
  workspaceLabel?: string | undefined;
  models: string[];
  modelBreakdown: ModelBreakdown[];
  totals: UsageTotals;
  firstActivityAt: string;
  lastActivityAt: string;
  state: "active" | "idle" | "stale" | "closed";
}

export interface ProviderSummary {
  provider: string;
  totals: UsageTotals;
}

export interface CategoryBreakdown {
  category: UsageCategory;
  eventCount: number;
  totals: UsageTotals;
}

export interface RunrateExport {
  generatedAt: string;
  window: string;
  scope: ActiveScope;
  pricingMode: PricingMode;
  totals: UsageTotals;
  bins: UsageBin[];
  sessions: SessionSummary[];
  models: ModelBreakdown[];
  providers: ProviderSummary[];
  categories: CategoryBreakdown[];
}

export const emptyTokenSnapshot = (): TokenSnapshot => ({
  inputFresh: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

export const totalTokenCount = (usage: TokenSnapshot): number =>
  usage.inputFresh + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;

export const addUsage = (left: TokenSnapshot, right: TokenSnapshot): TokenSnapshot => ({
  inputFresh: left.inputFresh + right.inputFresh,
  output: left.output + right.output,
  reasoning: left.reasoning + right.reasoning,
  cacheRead: left.cacheRead + right.cacheRead,
  cacheWrite: left.cacheWrite + right.cacheWrite,
});

export const cacheHitRatio = (usage: TokenSnapshot): number | null => {
  const denominator = usage.inputFresh + usage.cacheRead;
  if (denominator === 0) {
    return null;
  }
  return usage.cacheRead / denominator;
};

export const usageTotals = (
  usage: TokenSnapshot,
  costUsd: number,
  activeSessions = 0,
  lastActivityAt: string | null = null,
): UsageTotals => ({
  ...usage,
  totalTokens: totalTokenCount(usage),
  costUsd,
  cacheHitRatio: cacheHitRatio(usage),
  activeSessions,
  lastActivityAt,
});
