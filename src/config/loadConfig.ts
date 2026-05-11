import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { userCacheDir } from "../utils/fs.js";
import { defaultConfig, type RunrateConfig } from "./defaultConfig.js";

const adapterSourceSchema = z.object({
  label: z.string(),
  path: z.string(),
  account: z.string().optional(),
});

const configSchema = z.object({
  timezone: z.string().optional(),
  theme: z.enum(["auto", "light", "dark"]).optional(),
  pricingMode: z.enum(["vendor", "calculated", "hybrid", "compare"]).optional(),
  defaultWindow: z.enum(["1m", "5m", "15m", "30m", "1h", "12h", "24h", "7d", "30d"]).optional(),
  defaultScope: z.enum(["global", "account", "workspace", "session", "billing-block"]).optional(),
  adapters: z
    .record(
      z.string(),
      z.object({
        enabled: z.boolean().optional(),
        sources: z.array(adapterSourceSchema).optional(),
      }),
    )
    .optional(),
});

export const loadConfig = async (configPath?: string): Promise<RunrateConfig> => {
  const paths = [
    configPath,
    path.join(process.cwd(), "runrate.config.json"),
    path.join(userCacheDir(), "config.json"),
  ].filter(Boolean) as string[];

  let config = structuredClone(defaultConfig);
  for (const candidate of paths) {
    const partial = await readConfig(candidate);
    if (!partial) {
      continue;
    }
    config = mergeConfig(config, partial);
  }
  return config;
};

const readConfig = async (filePath: string): Promise<Partial<RunrateConfig> | null> => {
  try {
    const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
    return configSchema.parse(raw) as Partial<RunrateConfig>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const mergeConfig = (base: RunrateConfig, partial: Partial<RunrateConfig>): RunrateConfig => ({
  ...base,
  ...partial,
  adapters: {
    ...base.adapters,
    ...Object.fromEntries(
      Object.entries(partial.adapters ?? {}).map(([id, adapter]) => [
        id,
        {
          enabled: adapter.enabled ?? base.adapters[id]?.enabled ?? true,
          sources: adapter.sources ?? base.adapters[id]?.sources ?? [],
        },
      ]),
    ),
  },
});
