import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../../src/core/aggregate.js";
import type { NormalizedUsageEvent } from "../../src/core/event.js";
import { createScope } from "../../src/core/scope.js";

describe("core reducers", () => {
  it("aggregates multiple models inside the same session", () => {
    const events: NormalizedUsageEvent[] = [
      event("gpt-5.5", "2026-05-11T10:00:00.000Z", 100),
      event("gpt-5.4-mini", "2026-05-11T10:01:00.000Z", 50),
    ];

    const rollup = aggregateEvents(events, {
      now: new Date("2026-05-11T10:02:00.000Z"),
      window: "5m",
      scope: createScope("global"),
      pricingMode: "calculated",
    });

    expect(rollup.sessions).toHaveLength(1);
    expect(rollup.sessions[0]?.models).toEqual(["gpt-5.5", "gpt-5.4-mini"]);
    expect(rollup.sessions[0]?.modelBreakdown).toHaveLength(2);
    expect(rollup.totals.totalTokens).toBe(150);
    expect(rollup.categories).toEqual([
      {
        category: { id: "coding", label: "Coding" },
        eventCount: 2,
        totals: expect.objectContaining({ totalTokens: 150 }),
      },
    ]);
  });
});

const event = (modelId: string, occurredAt: string, inputFresh: number): NormalizedUsageEvent => ({
  id: `${modelId}:${occurredAt}`,
  provider: "codex",
  installationId: "fixture",
  workspaceId: "/work/runrate",
  workspaceLabel: "runrate",
  nativeSessionId: "session-1",
  logicalRequestId: `${modelId}:${occurredAt}`,
  occurredAt,
  modelId,
  usage: {
    inputFresh,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  cost: {
    effectiveUsd: 0,
    source: "estimated",
  },
  meta: {
    sourcePath: "fixture",
    adapterVersion: "test",
    rawCursor: "fixture",
    category: { id: "coding", label: "Coding" },
  },
});
