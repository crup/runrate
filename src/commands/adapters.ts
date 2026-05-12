import { builtinAdapters, detectAdapters } from "../adapters/registry.js";

export const adaptersListCommand = (): void => {
  process.stdout.write(`${JSON.stringify(builtinAdapters.map(adapterSummary), null, 2)}\n`);
};

export const adaptersDoctorCommand = async (json = false): Promise<void> => {
  const results = await detectAdapters();
  if (json) {
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
};

const adapterSummary = (adapter: (typeof builtinAdapters)[number]) => ({
  id: adapter.id,
  version: adapter.version,
  realtime: adapter.capabilities.realtimeTail,
  scopes: [
    adapter.capabilities.accountScope ? "account" : null,
    adapter.capabilities.workspaceScope ? "workspace" : null,
    adapter.capabilities.sessionScope ? "session" : null,
    adapter.capabilities.billingBlockScope ? "billing-block" : null,
  ].filter(Boolean),
  signals: [
    adapter.capabilities.reasoningTokens ? "reasoning" : null,
    adapter.capabilities.cacheTokens ? "cache" : null,
    adapter.capabilities.vendorCost ? "vendor-cost" : null,
  ].filter(Boolean),
});
