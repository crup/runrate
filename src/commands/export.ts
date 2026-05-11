import { loadRunrateExport, type CommonOptions } from "./common.js";

export interface ExportOptions extends CommonOptions {
  format?: "json" | "ndjson" | undefined;
  live?: boolean | undefined;
}

export const exportCommand = async (options: ExportOptions): Promise<void> => {
  const format = options.format ?? "json";

  if (options.live) {
    await streamExport(format, options);
    return;
  }

  const data = await loadRunrateExport(options);
  if (format === "ndjson") {
    for (const session of data.sessions) {
      process.stdout.write(
        `${JSON.stringify({
          type: "usage.session",
          ts: data.generatedAt,
          provider: session.provider,
          workspace: session.workspaceLabel ?? session.workspaceId,
          session: session.nativeSessionId,
          models: session.models,
          tokens: session.totals.totalTokens,
          costUsd: session.totals.costUsd,
        })}\n`,
      );
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
};

const streamExport = async (format: "json" | "ndjson", options: ExportOptions): Promise<void> => {
  const write = async () => {
    const data = await loadRunrateExport(options);
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(data)}\n`);
      return;
    }
    process.stdout.write(
      `${JSON.stringify({
        type: "usage.updated",
        ts: data.generatedAt,
        scope: data.scope,
        tokens: data.totals.totalTokens,
        costUsd: data.totals.costUsd,
        activeSessions: data.totals.activeSessions,
      })}\n`,
    );
  };

  await write();
  const interval = setInterval(() => {
    void write();
  }, 1000);
  process.once("SIGINT", () => {
    clearInterval(interval);
    process.exit(0);
  });
};
