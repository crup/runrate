import { describe, expect, it } from "vitest";
import { aggregateEvents } from "../../src/core/aggregate.js";
import { coalesceStreamingSnapshots, cumulativeToDelta } from "../../src/core/coalesce.js";
import type { NormalizedUsageEvent } from "../../src/core/event.js";
import { createScope } from "../../src/core/scope.js";

describe("core reducers", () => {
  it("converts cumulative counters to deltas", () => {
    expect(
      cumulativeToDelta(
        {
          inputFresh: 10,
          output: 5,
          reasoning: 1,
          cacheRead: 2,
          cacheWrite: 0,
        },
        {
          inputFresh: 25,
          output: 9,
          reasoning: 3,
          cacheRead: 7,
          cacheWrite: 1,
        },
      ),
    ).toEqual({
      inputFresh: 15,
      output: 4,
      reasoning: 2,
      cacheRead: 5,
      cacheWrite: 1,
    });
  });

  it("coalesces streaming snapshots with last-wins max usage", () => {
    const snapshots = coalesceStreamingSnapshots([
      {
        logicalRequestId: "a",
        firstSeenAt: "2026-05-11T10:00:00.000Z",
        lastSeenAt: "2026-05-11T10:00:00.000Z",
        occurredAt: "2026-05-11T10:00:00.000Z",
        usage: { inputFresh: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      },
      {
        logicalRequestId: "a",
        firstSeenAt: "2026-05-11T10:00:01.000Z",
        lastSeenAt: "2026-05-11T10:00:01.000Z",
        occurredAt: "2026-05-11T10:00:01.000Z",
        usage: { inputFresh: 1, output: 5, reasoning: 1, cacheRead: 0, cacheWrite: 0 },
      },
    ]);

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.occurredAt).toBe("2026-05-11T10:00:00.000Z");
    expect(snapshots[0]?.usage.output).toBe(5);
  });

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
  },
});
