import { adaptersDoctorCommand } from "./adapters.js";
import { detectAdapters } from "../adapters/registry.js";

export const doctorCommand = async (json = false): Promise<void> => {
  const payload = {
    node: process.version,
    platform: process.platform,
    cwd: process.cwd(),
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
  process.stdout.write(`CWD: ${payload.cwd}\n\n`);
  await adaptersDoctorCommand(false);
};
