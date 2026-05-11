import { describe, expect, it } from "vitest";
import { calculateCostUsd, findPricing } from "../../src/core/pricing.js";

describe("pricing", () => {
  it("uses model pricing per token class", () => {
    const pricing = findPricing("codex", "gpt-5.4");
    expect(pricing).not.toBeNull();
    expect(
      calculateCostUsd(
        {
          inputFresh: 1_000_000,
          output: 1_000_000,
          reasoning: 0,
          cacheRead: 1_000_000,
          cacheWrite: 0,
        },
        pricing!,
      ),
    ).toBe(17.75);
  });
});
