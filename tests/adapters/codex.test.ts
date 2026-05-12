import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexSessionDebug } from "../../src/adapters/codex/debug.js";
import { codexAdapter } from "../../src/adapters/codex/index.js";
import type { DetectedSource, RawAdapterRecord } from "../../src/adapters/sdk.js";
import type { NormalizedUsageEvent } from "../../src/core/event.js";

describe("Codex adapter", () => {
  it("detects and normalizes local Codex JSONL usage", async () => {
    const root = path.resolve("fixtures/codex");
    const sources = await codexAdapter.detect({
      cwd: process.cwd(),
      homeDir: process.cwd(),
      configDir: process.cwd(),
      env: {
        ...process.env,
        RUNRATE_CODEX_HOME: root,
      },
    });

    expect(sources).toHaveLength(1);
    const records = [];
    for await (const record of codexAdapter.scan(sources[0]!)) {
      records.push(record);
    }

    const events = await codexAdapter.normalize(records, {
      pricingMode: "calculated",
      timezone: "local",
    });

    expect(events).toHaveLength(2);
    expect(events.map((event) => event.modelId)).toEqual(["gpt-5.5", "gpt-5.4-mini"]);
    expect(events[0]?.usage).toEqual({
      inputFresh: 800,
      output: 100,
      reasoning: 20,
      cacheRead: 200,
      cacheWrite: 0,
    });
    expect(events[0]?.meta.category).toEqual({ id: "coding", label: "Coding" });
    expect(events[0]?.workspaceLabel).toBe("runrate");
  });

  it("matches Codex token-count semantics for model fallback, dedupe, and cumulative deltas", async () => {
    const source: DetectedSource = {
      id: "codex:test",
      provider: "codex",
      label: "Codex",
      path: "/tmp/codex",
      installationId: "fixture",
    };
    const filePath = "/tmp/codex/sessions/rollout-2026-05-11T10-00-00.jsonl";
    const records: RawAdapterRecord[] = [
      record(source, filePath, 1, {
        timestamp: "2026-05-11T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: "session-1",
          cwd: "/work/runrate",
          model_provider: "openai",
        },
      }),
      record(source, filePath, 2, {
        timestamp: "2026-05-11T10:00:00.500Z",
        type: "event_msg",
        payload: {
          type: "user_message",
          content: [{ text: "debug failing tests and fix the mismatch" }],
        },
      }),
      record(
        source,
        filePath,
        3,
        tokenCount("2026-05-11T10:00:01.000Z", undefined, {
          cached_input_tokens: 10,
          input_tokens: 100,
          output_tokens: 25,
          reasoning_output_tokens: 5,
          total_tokens: 125,
        }),
      ),
      record(
        source,
        filePath,
        4,
        tokenCount("2026-05-11T10:00:02.000Z", undefined, {
          cached_input_tokens: 10,
          input_tokens: 100,
          output_tokens: 25,
          reasoning_output_tokens: 5,
          total_tokens: 125,
        }),
      ),
      record(
        source,
        filePath,
        5,
        tokenCount("2026-05-11T10:00:03.000Z", "gpt-5.5", {
          cached_input_tokens: 30,
          input_tokens: 260,
          output_tokens: 55,
          reasoning_output_tokens: 15,
          total_tokens: 315,
        }),
      ),
    ];

    const events = await codexAdapter.normalize(records, {
      pricingMode: "calculated",
      timezone: "local",
    });

    expect(events).toHaveLength(2);
    expect(events[0]?.modelId).toBe("gpt-5");
    expect(events[0]?.meta.inferredModel).toBe(true);
    expect(events[0]?.meta.category).toEqual({ id: "debugging", label: "Debugging" });
    expect(events[0]?.usage).toEqual({
      cacheRead: 10,
      cacheWrite: 0,
      inputFresh: 90,
      output: 25,
      reasoning: 5,
    });
    expect(events[1]?.modelId).toBe("gpt-5.5");
    expect(events[1]?.meta.category).toEqual({ id: "debugging", label: "Debugging" });
    expect(events[1]?.usage).toEqual({
      cacheRead: 20,
      cacheWrite: 0,
      inputFresh: 140,
      output: 30,
      reasoning: 10,
    });
  });

  it("builds local session debug details with prompt context and cost-ranked culprits", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "runrate-codex-debug-"));
    const filePath = path.join(dir, "rollout-2026-05-11T10-00-00.jsonl");
    await writeFile(
      filePath,
      [
        JSON.stringify({
          timestamp: "2026-05-11T10:00:00.000Z",
          type: "session_meta",
          payload: { id: "session-debug", cwd: "/work/runrate" },
        }),
        JSON.stringify({
          timestamp: "2026-05-11T10:00:01.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            content: [{ text: "Find why reasoning tokens are exploding in this session." }],
          },
        }),
        JSON.stringify({
          timestamp: "2026-05-11T10:00:02.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              last_token_usage: {
                cached_input_tokens: 10,
                input_tokens: 120,
                output_tokens: 40,
                reasoning_output_tokens: 600,
              },
              total_token_usage: {
                cached_input_tokens: 10,
                input_tokens: 120,
                output_tokens: 40,
                reasoning_output_tokens: 600,
                total_tokens: 760,
              },
            },
          },
        }),
      ].join("\n"),
    );

    try {
      const debug = await buildCodexSessionDebug({
        events: [
          normalizedEvent({
            filePath,
            lineNumber: 3,
            sessionId: "session-debug",
            usage: {
              cacheRead: 10,
              cacheWrite: 0,
              inputFresh: 110,
              output: 40,
              reasoning: 600,
            },
          }),
        ],
        pricingMode: "calculated",
        sessionId: "session-debug",
      });

      expect(debug.events).toHaveLength(1);
      expect(debug.culprits[0]?.culpritReason).toBe("reasoning");
      expect(debug.culprits[0]?.prompt).toContain("reasoning tokens are exploding");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});

const normalizedEvent = (args: {
  filePath: string;
  lineNumber: number;
  sessionId: string;
  usage: NormalizedUsageEvent["usage"];
}): NormalizedUsageEvent => ({
  cost: {
    effectiveUsd: 0.5,
    source: "calculated",
  },
  id: `${args.sessionId}:${args.lineNumber}`,
  installationId: "fixture",
  logicalRequestId: `${args.sessionId}:${args.lineNumber}`,
  meta: {
    adapterVersion: "test",
    rawCursor: `${args.filePath}:1`,
    sourcePath: args.filePath,
  },
  modelId: "gpt-5.5",
  nativeSessionId: args.sessionId,
  occurredAt: "2026-05-11T10:00:02.000Z",
  provider: "codex",
  usage: args.usage,
  workspaceId: "/work/runrate",
  workspaceLabel: "runrate",
});

const record = (
  source: DetectedSource,
  filePath: string,
  lineNumber: number,
  value: unknown,
): RawAdapterRecord => ({
  cursor: `${filePath}:${lineNumber}`,
  key: `${filePath}:${lineNumber}`,
  payload: {
    filePath,
    lineNumber,
    value,
  },
  source,
  sourcePath: filePath,
  ts:
    typeof value === "object" &&
    value !== null &&
    "timestamp" in value &&
    typeof value.timestamp === "string"
      ? value.timestamp
      : new Date(0).toISOString(),
});

const tokenCount = (
  timestamp: string,
  modelName: string | undefined,
  totalUsage: Record<string, number>,
) => ({
  timestamp,
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      ...(modelName ? { model_name: modelName } : {}),
      total_token_usage: totalUsage,
    },
  },
});
