import { adaptersDoctorCommand } from "./adapters.js";
import { detectAdapters } from "../adapters/registry.js";
import { getTerminalInfo } from "../utils/terminal.js";

export const doctorCommand = async (json = false): Promise<void> => {
  const terminal = getTerminalInfo();
  const payload = {
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
    terminal,
  };

  if (json) {
    process.stdout.write(
      `${JSON.stringify({ ...payload, adapters: await detectAdapters() }, null, 2)}\n`,
    );
    return;
  }

  process.stdout.write("Runrate doctor\n");
  process.stdout.write(`Node: ${payload.node}\n`);
  process.stdout.write(`Platform: ${payload.platform}\n`);
  process.stdout.write(`CWD: ${payload.cwd}\n`);
  process.stdout.write(
    `TTY: ${terminal.isTty ? "yes" : "no"} (${terminal.columns}x${terminal.rows})\n\n`,
  );
  await adaptersDoctorCommand(false);
};
