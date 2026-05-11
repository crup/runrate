import os from "node:os";
import { userCacheDir } from "../utils/fs.js";
import { claudeCodeAdapter } from "./claude-code/index.js";
import { codexAdapter } from "./codex/index.js";
import type { AdapterDoctorResult, DetectContext, UsageAdapter } from "./sdk.js";

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
}) => {
  const adapters = args.adapters ?? builtinAdapters;
  const results = await detectAdapters(adapters);
  const events = [];

  for (const result of results) {
    if (result.status !== "detected") {
      continue;
    }
    for (const source of result.sources) {
      const records = [];
      for await (const record of result.adapter.scan(source, undefined, {
        sinceMs: args.sinceMs,
      })) {
        records.push(record);
      }
      const normalizedEvents = await result.adapter.normalize(records, {
        pricingMode: args.pricingMode,
        timezone: args.timezone,
      });
      for (const event of normalizedEvents) {
        events.push(event);
      }
    }
  }

  return {
    events,
    diagnostics: results,
  };
};
