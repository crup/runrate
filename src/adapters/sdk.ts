import type { NormalizedUsageEvent, PricingMode } from "../core/event.js";

export interface AdapterCapabilities {
  accountScope: boolean;
  workspaceScope: boolean;
  sessionScope: boolean;
  billingBlockScope: boolean;
  reasoningTokens: boolean;
  cacheTokens: boolean;
  vendorCost: boolean;
  realtimeTail: "fs-watch" | "poll" | "sqlite-poll" | "none";
}

export interface DetectContext {
  cwd: string;
  homeDir: string;
  configDir: string;
  env: NodeJS.ProcessEnv;
}

export interface DetectedSource {
  id: string;
  provider: string;
  label: string;
  path: string;
  installationId: string;
  accountId?: string | undefined;
}

export interface Checkpoint {
  sourceId: string;
  cursor: string;
  trailingHash?: string | undefined;
  parserVersion: string;
  updatedAt: string;
}

export interface RawAdapterRecord {
  key: string;
  ts: string;
  payload: unknown;
  cursor: string;
  sourcePath: string;
  source: DetectedSource;
}

export interface ScanContext {
  sinceMs?: number | undefined;
  maxFiles?: number | undefined;
  newestFirst?: boolean | undefined;
}

export interface NormalizeContext {
  pricingMode: PricingMode;
  timezone: string;
}

export interface UsageAdapter {
  sdkVersion: 1;
  id: string;
  displayName: string;
  version: string;
  capabilities: AdapterCapabilities;
  detect(ctx: DetectContext): Promise<DetectedSource[]>;
  scan(
    source: DetectedSource,
    checkpoint?: Checkpoint,
    ctx?: ScanContext,
  ): AsyncIterable<RawAdapterRecord>;
  normalize(records: RawAdapterRecord[], ctx: NormalizeContext): Promise<NormalizedUsageEvent[]>;
}

export interface AdapterDoctorResult {
  adapter: UsageAdapter;
  sources: DetectedSource[];
  status: "detected" | "missing" | "disabled" | "error";
  notes: string[];
}
