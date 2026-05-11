import { promises as fs } from "node:fs";
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
  readJsonl,
} from "../../utils/fs.js";

const ADAPTER_VERSION = "0.1.0";

interface CodexSessionMeta {
  sessionId: string;
  cwd?: string | undefined;
  modelProvider?: string | undefined;
  model?: string | undefined;
}

interface CodexCumulativeUsage {
  cached: number;
  input: number;
  output: number;
  reasoning: number;
  total: number;
}

export const codexAdapter: UsageAdapter = {
  sdkVersion: 1,
  id: "codex",
  displayName: "Codex",
  version: ADAPTER_VERSION,
  capabilities: {
    accountScope: false,
    workspaceScope: true,
    sessionScope: true,
    billingBlockScope: false,
    reasoningTokens: true,
    cacheTokens: true,
    vendorCost: false,
    realtimeTail: "poll",
  },
  async detect(ctx: DetectContext): Promise<DetectedSource[]> {
    const root = expandHome(ctx.env.RUNRATE_CODEX_HOME ?? path.join(ctx.homeDir, ".codex"));
    const sessionsPath = path.join(root, "sessions");
    if (!(await pathExists(sessionsPath))) {
      return [];
    }
    return [
      {
        id: `codex:${hashString(root)}`,
        provider: "codex",
        label: "Codex",
        path: root,
        installationId: await readInstallationId(root),
      },
    ];
  },
  async *scan(source: DetectedSource, ctx?: ScanContext): AsyncIterable<RawAdapterRecord> {
    const roots = [path.join(source.path, "sessions"), path.join(source.path, "archived_sessions")];

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
        for await (const record of readJsonl(filePath)) {
          const value = slimCodexValue(record.value);
          if (!value) {
            continue;
          }
          yield {
            key: `${filePath}:${record.lineNumber}`,
            ts: extractTimestamp(value) ?? new Date(0).toISOString(),
            payload: {
              filePath,
              lineNumber: record.lineNumber,
              value,
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
    const metadataByLine = buildMetadataTimeline(records);
    const previousUsageByFile = new Map<string, CodexCumulativeUsage>();
    const seenCodexCalls = new Set<string>();
    const events: NormalizedUsageEvent[] = [];

    for (const record of records) {
      const payload = unwrapCodexPayload(record.payload);
      if (!payload) {
        continue;
      }
      const value = payload.value;
      const eventPayload = objectValue(value, "payload");
      if (
        stringValue(value, "type") !== "event_msg" ||
        stringValue(eventPayload, "type") !== "token_count"
      ) {
        continue;
      }
      const info = objectValue(eventPayload, "info");
      const lastTokenUsage = objectValue(info, "last_token_usage");
      const totalTokenUsage = objectValue(info, "total_token_usage");
      const previousUsage = previousUsageByFile.get(payload.filePath);
      const cumulativeUsage = totalTokenUsage
        ? cumulativeFromUsage(totalTokenUsage)
        : emptyCumulativeUsage();
      if (previousUsage && cumulativeUsage.total === previousUsage.total) {
        continue;
      }
      const usage = lastTokenUsage
        ? codexUsageToSnapshot(lastTokenUsage)
        : previousUsage
          ? codexUsageToSnapshot({
              input_tokens: Math.max(0, cumulativeUsage.input - previousUsage.input),
              cached_input_tokens: Math.max(0, cumulativeUsage.cached - previousUsage.cached),
              output_tokens: Math.max(0, cumulativeUsage.output - previousUsage.output),
              reasoning_output_tokens: Math.max(
                0,
                cumulativeUsage.reasoning - previousUsage.reasoning,
              ),
            })
          : codexUsageToSnapshot({
              input_tokens: cumulativeUsage.input,
              cached_input_tokens: cumulativeUsage.cached,
              output_tokens: cumulativeUsage.output,
              reasoning_output_tokens: cumulativeUsage.reasoning,
            });
      previousUsageByFile.set(payload.filePath, cumulativeUsage);
      if (!usage || snapshotTokenTotal(usage) === 0) {
        continue;
      }

      const metadata =
        metadataByLine.get(`${payload.filePath}:${payload.lineNumber}`) ??
        fallbackMetadata(payload.filePath);
      const timestamp =
        stringValue(value, "timestamp") ?? metadataTimestamp(metadata) ?? new Date().toISOString();
      const resolvedModelId = modelFromRecord(value) ?? metadata.model;
      const modelId = resolvedModelId ?? "gpt-5";
      const dedupKey = `${metadata.sessionId}:${timestamp}:${cumulativeUsage.total}`;
      if (seenCodexCalls.has(dedupKey)) {
        continue;
      }
      seenCodexCalls.add(dedupKey);
      const cost = resolveCost({
        usage,
        provider: "codex",
        modelId,
        pricingMode: ctx.pricingMode,
      });

      events.push({
        id: stableId(`${payload.filePath}:${payload.lineNumber}:${JSON.stringify(lastTokenUsage)}`),
        provider: "codex",
        installationId: record.source.installationId,
        accountId: record.source.accountId,
        workspaceId: metadata.cwd,
        workspaceLabel: metadata.cwd ? path.basename(metadata.cwd) : undefined,
        nativeSessionId: metadata.sessionId,
        logicalRequestId: `${metadata.sessionId}:${payload.lineNumber}`,
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
          inferredModel: resolvedModelId === undefined,
          warnings:
            resolvedModelId === undefined
              ? ["Model id was not present in the Codex record; defaulted to gpt-5"]
              : [],
        },
      });
    }

    return events;
  },
};

const readInstallationId = async (root: string): Promise<string> => {
  try {
    return (await fs.readFile(path.join(root, "installation_id"), "utf8")).trim();
  } catch {
    return hashString(root);
  }
};

const fileMayContainUsageSince = (filePath: string, sinceMs: number | undefined): boolean => {
  if (!sinceMs) {
    return true;
  }

  const match = /rollout-(\d{4})-(\d{2})-(\d{2})T/.exec(path.basename(filePath));
  if (!match) {
    return true;
  }

  const [, year, month, day] = match;
  const fileDayStart = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const fileDayEnd = fileDayStart + 24 * 60 * 60_000;
  return fileDayEnd >= sinceMs;
};

const buildMetadataTimeline = (records: RawAdapterRecord[]): Map<string, CodexSessionMeta> => {
  const currentByFile = new Map<string, CodexSessionMeta>();
  const byLine = new Map<string, CodexSessionMeta>();

  const sortedRecords = [...records].sort((a, b) => {
    if (a.sourcePath !== b.sourcePath) {
      return a.sourcePath.localeCompare(b.sourcePath);
    }
    const left = unwrapCodexPayload(a.payload)?.lineNumber ?? 0;
    const right = unwrapCodexPayload(b.payload)?.lineNumber ?? 0;
    return left - right;
  });

  for (const record of sortedRecords) {
    const payload = unwrapCodexPayload(record.payload);
    if (!payload) {
      continue;
    }
    const value = payload.value;
    const current = currentByFile.get(payload.filePath) ?? fallbackMetadata(payload.filePath);

    if (stringValue(value, "type") === "session_meta") {
      const metaPayload = objectValue(value, "payload");
      const id = stringValue(metaPayload, "id");
      const cwd = stringValue(metaPayload, "cwd");
      const modelProvider = stringValue(metaPayload, "model_provider");
      currentByFile.set(payload.filePath, {
        ...current,
        sessionId: id ?? current.sessionId,
        cwd: cwd ?? current.cwd,
        modelProvider: modelProvider ?? current.modelProvider,
        model: modelFromRecord(value) ?? current.model,
      });
      byLine.set(`${payload.filePath}:${payload.lineNumber}`, currentByFile.get(payload.filePath)!);
      continue;
    }

    const model = modelFromRecord(value);
    if (model && current.model !== model) {
      currentByFile.set(payload.filePath, {
        ...current,
        model,
      });
    }
    byLine.set(
      `${payload.filePath}:${payload.lineNumber}`,
      currentByFile.get(payload.filePath) ?? current,
    );
  }

  return byLine;
};

const fallbackMetadata = (filePath: string): CodexSessionMeta => ({
  sessionId: path.basename(filePath, ".jsonl").replace(/^rollout-[^-]+-/, ""),
});

const metadataTimestamp = (_metadata: CodexSessionMeta): string | undefined => undefined;

const codexUsageToSnapshot = (usage: Record<string, unknown>): TokenSnapshot => {
  const inputTokens = numberValue(usage, "input_tokens");
  const cachedInputTokens = numberValue(usage, "cached_input_tokens");
  const outputTokens = numberValue(usage, "output_tokens");
  const reasoningTokens = numberValue(usage, "reasoning_output_tokens");

  return {
    inputFresh: Math.max(0, inputTokens - cachedInputTokens),
    output: outputTokens,
    reasoning: reasoningTokens,
    cacheRead: cachedInputTokens,
    cacheWrite: 0,
  };
};

const cumulativeFromUsage = (usage: Record<string, unknown>): CodexCumulativeUsage => ({
  cached: numberValue(usage, "cached_input_tokens"),
  input: numberValue(usage, "input_tokens"),
  output: numberValue(usage, "output_tokens"),
  reasoning: numberValue(usage, "reasoning_output_tokens"),
  total: numberValue(usage, "total_tokens"),
});

const emptyCumulativeUsage = (): CodexCumulativeUsage => ({
  cached: 0,
  input: 0,
  output: 0,
  reasoning: 0,
  total: 0,
});

const snapshotTokenTotal = (usage: TokenSnapshot): number =>
  usage.inputFresh + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;

const modelFromRecord = (value: unknown): string | undefined => {
  const payload = objectValue(value, "payload");
  const info = objectValue(payload, "info");
  return (
    stringValue(payload, "model") ??
    stringValue(info, "model") ??
    stringValue(info, "model_name") ??
    stringValue(objectValue(objectValue(payload, "collaboration_mode"), "settings"), "model")
  );
};

const slimCodexValue = (value: unknown): Record<string, unknown> | null => {
  if (!isRecord(value)) {
    return null;
  }

  const type = stringValue(value, "type");
  const timestamp = stringValue(value, "timestamp");
  const payload = objectValue(value, "payload");
  if (!type || !payload) {
    return null;
  }

  if (type === "session_meta") {
    return {
      type,
      timestamp,
      payload: {
        id: stringValue(payload, "id"),
        cwd: stringValue(payload, "cwd"),
        model_provider: stringValue(payload, "model_provider"),
        model: stringValue(payload, "model"),
        info: pickStringFields(objectValue(payload, "info"), ["model", "model_name"]),
        collaboration_mode: objectValue(payload, "collaboration_mode"),
      },
    };
  }

  const payloadType = stringValue(payload, "type");
  const info = objectValue(payload, "info");
  if (type === "event_msg" && payloadType === "token_count" && info) {
    return {
      type,
      timestamp,
      payload: {
        type: payloadType,
        model: stringValue(payload, "model"),
        info: {
          ...(pickStringFields(info, ["model", "model_name"]) ?? {}),
          last_token_usage: objectValue(info, "last_token_usage"),
          total_token_usage: objectValue(info, "total_token_usage"),
        },
      },
    };
  }

  const model = modelFromRecord(value);
  if (!model) {
    return null;
  }

  return {
    type,
    timestamp,
    payload: {
      model,
      info: pickStringFields(info, ["model", "model_name"]),
      collaboration_mode: objectValue(payload, "collaboration_mode"),
    },
  };
};

const extractTimestamp = (value: unknown): string | undefined => stringValue(value, "timestamp");

const unwrapCodexPayload = (
  payload: unknown,
): { filePath: string; lineNumber: number; value: unknown } | null => {
  if (!isRecord(payload)) {
    return null;
  }
  const filePath = stringValue(payload, "filePath");
  const lineNumber = numberValue(payload, "lineNumber");
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

const objectValue = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
};

const stringValue = (value: unknown, key: string): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const nested = value[key];
  return typeof nested === "string" ? nested : undefined;
};

const pickStringFields = (
  value: Record<string, unknown> | undefined,
  keys: string[],
): Record<string, string> | undefined => {
  if (!value) {
    return undefined;
  }
  const picked: Record<string, string> = {};
  for (const key of keys) {
    const field = stringValue(value, key);
    if (field) {
      picked[key] = field;
    }
  }
  return Object.keys(picked).length ? picked : undefined;
};

const numberValue = (value: unknown, key: string): number => {
  if (!isRecord(value)) {
    return 0;
  }
  const nested = value[key];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : 0;
};

const stableId = (value: string): string => createHash("sha256").update(value).digest("hex");
