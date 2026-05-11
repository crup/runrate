import { builtinAdapters, detectAdapters } from "../adapters/registry.js";
import { renderTable } from "../utils/format.js";

export const adaptersListCommand = (): void => {
  process.stdout.write(
    `${renderTable(
      ["Adapter", "Version", "Realtime", "Scopes", "Signals"],
      builtinAdapters.map((adapter) => [
        adapter.id,
        adapter.version,
        adapter.capabilities.realtimeTail,
        [
          adapter.capabilities.accountScope ? "account" : null,
          adapter.capabilities.workspaceScope ? "workspace" : null,
          adapter.capabilities.sessionScope ? "session" : null,
          adapter.capabilities.billingBlockScope ? "billing-block" : null,
        ]
          .filter(Boolean)
          .join(", "),
        [
          adapter.capabilities.reasoningTokens ? "reasoning" : null,
          adapter.capabilities.cacheTokens ? "cache" : null,
          adapter.capabilities.vendorCost ? "vendor-cost" : null,
        ]
          .filter(Boolean)
          .join(", "),
      ]),
    )}\n`,
  );
};

export const adaptersDoctorCommand = async (json = false): Promise<void> => {
  const results = await detectAdapters();
  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    `${renderTable(
      ["Adapter", "Status", "Sources", "Notes"],
      results.map((result) => [
        result.adapter.id,
        result.status,
        String(result.sources.length),
        result.notes.join("; ") || result.sources.map((source) => source.path).join(", "),
      ]),
    )}\n`,
  );
};
