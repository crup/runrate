import { formatTotalsLine, renderTable, sessionToRow } from "../utils/format.js";
import { loadRunrateExport, type CommonOptions } from "./common.js";

const headers = [
  "Last Activity",
  "Workspace",
  "Session",
  "Models",
  "Input",
  "Output",
  "Reasoning",
  "Cache Read",
  "Cost",
  "State",
];

export const tableCommand = async (options: CommonOptions): Promise<void> => {
  const data = await loadRunrateExport(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  process.stdout.write(`Runrate ${data.scope.label} ${data.window}\n`);
  process.stdout.write(`${formatTotalsLine(data.totals)}\n\n`);
  process.stdout.write(`${renderTable(headers, data.sessions.map(sessionToRow))}\n`);
};
