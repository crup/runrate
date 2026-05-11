import path from "node:path";
import { createHash } from "node:crypto";
import type {
  DetectedSource,
  DetectContext,
  NormalizeContext,
  RawAdapterRecord,
  ScanContext,
  UsageAdapter,
} from "../sdk.js";
import { resolveCost } from "../../core/pricing.js";
import type { NormalizedUsageEvent, TokenSnapshot } from "../../core/event.js";
import {
  expandHome,
  hashString,
  listFilesRecursive,
  pathExists,
  readCompleteJsonl,
} from "../../utils/fs.js";

const ADAPTER_VERSION = "0.1.0";

export const claudeCodeAdapter: UsageAdapter = {
  sdkVersion: 1,
  id: "claude-code",
  displayName: "Claude Code",
  version: ADAPTER_VERSION,
  capabilities: {
    accountScope: false,
    workspaceScope: true,
    sessionScope: true,
    billingBlockScope: true,
    reasoningTokens: false,
    cacheTokens: true,
    vendorCost: true,
    realtimeTail: "poll",
  },
  async detect(ctx: DetectContext): Promise<DetectedSource[]> {
    const roots = [
      expandHome(ctx.env.RUNRATE_CLAUDE_HOME ?? path.join(ctx.homeDir, ".claude")),
      path.join(ctx.homeDir, ".config", "claude"),
    ];
    const sources: DetectedSource[] = [];

    for (const root of roots) {
      const projects = path.join(root, "projects");
      if (!(await pathExists(projects))) {
        continue;
      }
      sources.push({
        id: `claude-code:${hashString(root)}`,
        provider: "claude-code",
        label: path.basename(root),
        path: root,
        installationId: hashString(root),
      });
    }

    return sources;
  },
  async *scan(
    source: DetectedSource,
    _checkpoint,
    ctx?: ScanContext,
  ): AsyncIterable<RawAdapterRecord> {
    const roots = [path.join(source.path, "projects")];

    for (const root of roots) {
      if (!(await pathExists(root))) {
        continue;
      }
      const files = await listFilesRecursive(
        root,
        (filePath) =>
          filePath.endsWith(".jsonl") && fileMayContainUsageSince(filePath, ctx?.sinceMs),
      );
      for (const filePath of files) {
        const records = await readCompleteJsonl(filePath);
        for (const record of records) {
          yield {
            key: `${filePath}:${record.lineNumber}`,
            ts: timestampOf(record.value) ?? new Date(0).toISOString(),
            payload: {
              filePath,
              lineNumber: record.lineNumber,
              value: record.value,
            },
            cursor: record.cursor,
            sourcePath: filePath,
            source,
          };
        }
      }
    }
  },
  async normalize(
    records: RawAdapterRecord[],
    ctx: NormalizeContext,
  ): Promise<NormalizedUsageEvent[]> {
    const events: NormalizedUsageEvent[] = [];

    for (const record of records) {
      const payload = unwrapPayload(record.payload);
      if (!payload) {
        continue;
      }
      const usage = claudeUsage(payload.value);
      if (!usage) {
        continue;
      }
      const timestamp = timestampOf(payload.value) ?? new Date().toISOString();
      const sessionId =
        stringAt(payload.value, "sessionId") ??
        stringAt(payload.value, "session_id") ??
        path.basename(payload.filePath, ".jsonl");
      const cwd = stringAt(payload.value, "cwd") ?? inferWorkspaceFromClaudePath(payload.filePath);
      const modelId = modelOf(payload.value) ?? "unknown";
      const vendorUsd = numberAt(payload.value, "costUSD") ?? numberAt(payload.value, "cost_usd");
      const cost = resolveCost({
        usage,
        provider: "claude-code",
        modelId,
        pricingMode: ctx.pricingMode,
        vendorUsd,
      });

      events.push({
        id: stableId(`${payload.filePath}:${payload.lineNumber}:${JSON.stringify(usage)}`),
        provider: "claude-code",
        installationId: record.source.installationId,
        accountId: record.source.accountId,
        workspaceId: cwd,
        workspaceLabel: cwd ? path.basename(cwd) : undefined,
        nativeSessionId: sessionId,
        logicalRequestId: `${sessionId}:${payload.lineNumber}`,
        occurredAt: timestamp,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        modelId,
        usage,
        cost,
        meta: {
          sourcePath: payload.filePath,
          adapterVersion: ADAPTER_VERSION,
          rawCursor: record.cursor,
          inferredModel: modelId === "unknown",
          warnings:
            modelId === "unknown"
              ? ["Model id was not present in the Claude Code record"]
              : ["Claude Code adapter is best-effort until validated with local Claude Code data"],
        },
      });
    }

    return events;
  },
};

const claudeUsage = (value: unknown): TokenSnapshot | null => {
  const message = objectAt(value, "message");
  const usage = objectAt(message, "usage") ?? objectAt(value, "usage");
  if (!usage) {
    return null;
  }
  const input = numberAt(usage, "input_tokens") ?? 0;
  const output = numberAt(usage, "output_tokens") ?? 0;
  const cacheRead =
    numberAt(usage, "cache_read_input_tokens") ?? numberAt(usage, "cacheReadInputTokens") ?? 0;
  const cacheWrite =
    numberAt(usage, "cache_creation_input_tokens") ??
    numberAt(usage, "cacheCreationInputTokens") ??
    0;

  if (input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0) {
    return null;
  }

  return {
    inputFresh: Math.max(0, input - cacheRead),
    output,
    reasoning: 0,
    cacheRead,
    cacheWrite,
  };
};

const fileMayContainUsageSince = (filePath: string, sinceMs: number | undefined): boolean => {
  if (!sinceMs) {
    return true;
  }
  const match = /(\d{4})-(\d{2})-(\d{2})/.exec(filePath);
  if (!match) {
    return true;
  }
  const [, year, month, day] = match;
  const fileDayStart = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const fileDayEnd = fileDayStart + 24 * 60 * 60_000;
  return fileDayEnd >= sinceMs;
};

const modelOf = (value: unknown): string | undefined =>
  stringAt(value, "model") ?? stringAt(objectAt(value, "message"), "model");

const timestampOf = (value: unknown): string | undefined =>
  stringAt(value, "timestamp") ?? stringAt(value, "created_at");

const inferWorkspaceFromClaudePath = (filePath: string): string | undefined => {
  const parts = filePath.split(path.sep);
  const projectsIndex = parts.lastIndexOf("projects");
  if (projectsIndex === -1 || !parts[projectsIndex + 1]) {
    return undefined;
  }
  return parts[projectsIndex + 1]?.replace(/-/g, "/");
};

const unwrapPayload = (
  payload: unknown,
): { filePath: string; lineNumber: number; value: unknown } | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const filePath = stringAt(payload, "filePath");
  const lineNumber = numberAt(payload, "lineNumber");
  if (!filePath || !lineNumber) {
    return null;
  }
  return {
    filePath,
    lineNumber,
    value: payload.value,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const objectAt = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
};

const stringAt = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[key];
  return typeof nested === "string" ? nested : undefined;
};

const numberAt = (value: unknown, key: string): number | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[key];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : undefined;
};

const stableId = (value: string): string => createHash("sha256").update(value).digest("hex");
