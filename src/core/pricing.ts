import prices from "../pricing/prices.json" with { type: "json" };
import type { PricingMode, TokenSnapshot, UsageCost } from "./event.js";

export interface ModelPricing {
  provider: string;
  modelId: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  reasoningPerMillionUsd?: number | undefined;
  cacheReadPerMillionUsd?: number | undefined;
  cacheWritePerMillionUsd?: number | undefined;
  updatedAt: string;
  source: "bundled" | "user" | "remote";
}

export const bundledPricing = prices as ModelPricing[];

export const normalizeModelId = (modelId: string): string => modelId.trim().toLowerCase();

const providerPricingAliases: Record<string, string> = {
  codex: "openai",
};

export const findPricing = (
  provider: string,
  modelId: string,
  table: ModelPricing[] = bundledPricing,
): ModelPricing | null => {
  const rawProvider = provider.trim().toLowerCase();
  const normalizedProvider = providerPricingAliases[rawProvider] ?? rawProvider;
  const normalizedModel = normalizeModelId(modelId);
  return (
    table.find(
      (pricing) =>
        pricing.provider.toLowerCase() === normalizedProvider &&
        normalizeModelId(pricing.modelId) === normalizedModel,
    ) ?? null
  );
};

export const calculateCostUsd = (usage: TokenSnapshot, pricing: ModelPricing): number => {
  const input = (usage.inputFresh * pricing.inputPerMillionUsd) / 1_000_000;
  const output = (usage.output * pricing.outputPerMillionUsd) / 1_000_000;
  const reasoning =
    (usage.reasoning * (pricing.reasoningPerMillionUsd ?? pricing.outputPerMillionUsd)) / 1_000_000;
  const cacheRead = (usage.cacheRead * (pricing.cacheReadPerMillionUsd ?? 0)) / 1_000_000;
  const cacheWrite = (usage.cacheWrite * (pricing.cacheWritePerMillionUsd ?? 0)) / 1_000_000;
  return input + output + reasoning + cacheRead + cacheWrite;
};

export const resolveCost = (args: {
  usage: TokenSnapshot;
  provider: string;
  modelId: string;
  pricingMode: PricingMode;
  vendorUsd?: number | undefined;
  table?: ModelPricing[] | undefined;
}): UsageCost => {
  const pricing = findPricing(args.provider, args.modelId, args.table ?? bundledPricing);
  const calculatedUsd = pricing ? calculateCostUsd(args.usage, pricing) : undefined;

  if (args.pricingMode === "vendor" && args.vendorUsd !== undefined) {
    return {
      vendorUsd: args.vendorUsd,
      calculatedUsd,
      effectiveUsd: args.vendorUsd,
      source: "vendor",
    };
  }

  if (args.pricingMode === "calculated" && calculatedUsd !== undefined) {
    return {
      vendorUsd: args.vendorUsd,
      calculatedUsd,
      effectiveUsd: calculatedUsd,
      source: "calculated",
    };
  }

  if (
    (args.pricingMode === "hybrid" || args.pricingMode === "compare") &&
    args.vendorUsd !== undefined
  ) {
    return {
      vendorUsd: args.vendorUsd,
      calculatedUsd,
      effectiveUsd: args.vendorUsd,
      source: "vendor",
    };
  }

  if (calculatedUsd !== undefined) {
    return {
      vendorUsd: args.vendorUsd,
      calculatedUsd,
      effectiveUsd: calculatedUsd,
      source: "calculated",
    };
  }

  return {
    vendorUsd: args.vendorUsd,
    effectiveUsd: args.vendorUsd ?? 0,
    source: args.vendorUsd === undefined ? "estimated" : "vendor",
  };
};
