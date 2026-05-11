import os from "node:os";
import { userCacheDir } from "../utils/fs.js";
import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import type { NormalizedUsageEvent } from "../core/event.js";
import type { AdapterDoctorResult, DetectContext, RawAdapterRecord, UsageAdapter } from "./sdk.js";

export const builtinAdapters: UsageAdapter[] = [codexAdapter, claudeCodeAdapter];

export const createDetectContext = (): DetectContext => ({
  cwd: process.cwd(),
  homeDir: os.homedir(),
  configDir: userCacheDir(),
  env: process.env,
});

export const detectAdapters = async (
  adapters: UsageAdapter[] = builtinAdapters,
): Promise<AdapterDoctorResult[]> => {
  const ctx = createDetectContext();
  const results: AdapterDoctorResult[] = [];

  for (const adapter of adapters) {
    try {
      const sources = await adapter.detect(ctx);
      results.push({
        adapter,
        sources,
        status: sources.length > 0 ? "detected" : "missing",
        notes: sources.length > 0 ? [] : ["No local sources found"],
      });
    } catch (error) {
      results.push({
        adapter,
        sources: [],
        status: "error",
        notes: [(error as Error).message],
      });
    }
  }

  return results;
};

export const collectUsageEvents = async (args: {
  adapters?: UsageAdapter[];
  pricingMode: "vendor" | "calculated" | "hybrid" | "compare";
  timezone: string;
  sinceMs?: number | undefined;
  normalizeBatchSize?: number | undefined;
}) => {
  const adapters = args.adapters ?? builtinAdapters;
  const results = await detectAdapters(adapters);
  const events: NormalizedUsageEvent[] = [];
  const seenEventIds = new Set<string>();
  const normalizeBatchSize = args.normalizeBatchSize ?? 5_000;

  const flushRecords = async (adapter: UsageAdapter, records: RawAdapterRecord[]) => {
    if (records.length === 0) {
      return;
    }
    const normalizedEvents = await adapter.normalize(records, {
      pricingMode: args.pricingMode,
      timezone: args.timezone,
    });
    for (const event of normalizedEvents) {
      if (seenEventIds.has(event.id)) {
        continue;
      }
      seenEventIds.add(event.id);
      events.push(event);
    }
    records.length = 0;
  };

  for (const result of results) {
    if (result.status !== "detected") {
      continue;
    }
    for (const source of result.sources) {
      const records: RawAdapterRecord[] = [];
      let currentSourcePath: string | undefined;
      for await (const record of result.adapter.scan(source, {
        sinceMs: args.sinceMs,
      })) {
        if (
          currentSourcePath !== undefined &&
          record.sourcePath !== currentSourcePath &&
          records.length > 0
        ) {
          await flushRecords(result.adapter, records);
        }
        currentSourcePath = record.sourcePath;
        records.push(record);
        if (result.adapter.id !== "codex" && records.length >= normalizeBatchSize) {
          await flushRecords(result.adapter, records);
        }
      }
      await flushRecords(result.adapter, records);
    }
  }

  return {
    events,
    diagnostics: results,
  };
};
