import path from "node:path";
import { describe, expect, it } from "vitest";
import { claudeCodeAdapter } from "../../src/adapters/claude-code/index.js";

describe("Claude Code adapter", () => {
  it("normalizes best-effort Claude Code usage records", async () => {
    const root = path.resolve("fixtures/claude-code");
    const sources = await claudeCodeAdapter.detect({
      cwd: process.cwd(),
      homeDir: process.cwd(),
      configDir: process.cwd(),
      env: {
        ...process.env,
        RUNRATE_CLAUDE_HOME: root,
      },
    });

    expect(sources).toHaveLength(1);
    const records = [];
    for await (const record of claudeCodeAdapter.scan(sources[0]!)) {
      records.push(record);
    }
    const events = await claudeCodeAdapter.normalize(records, {
      pricingMode: "hybrid",
      timezone: "local",
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.provider).toBe("claude-code");
    expect(events[0]?.usage.inputFresh).toBe(1000);
    expect(events[0]?.usage.cacheRead).toBe(600);
    expect(events[0]?.cost.effectiveUsd).toBe(0.0123);
  });
});
