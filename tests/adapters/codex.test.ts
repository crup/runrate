import path from "node:path";
import { describe, expect, it } from "vitest";
import { codexAdapter } from "../../src/adapters/codex/index.js";

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
      output: 80,
      reasoning: 20,
      cacheRead: 200,
      cacheWrite: 0,
    });
    expect(events[0]?.workspaceLabel).toBe("runrate");
  });
});
