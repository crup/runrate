import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";

export interface JsonlRecord {
  value: unknown;
  lineNumber: number;
  byteStart: number;
  byteEnd: number;
  cursor: string;
}

export const expandHome = (inputPath: string): string => {
  if (inputPath === "~") {
    return os.homedir();
  }
  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }
  return inputPath;
};

export const pathExists = async (inputPath: string): Promise<boolean> => {
  try {
    await fs.access(inputPath);
    return true;
  } catch {
    return false;
  }
};

export const listFilesRecursive = async (
  root: string,
  predicate: (filePath: string) => boolean,
): Promise<string[]> => {
  const files: string[] = [];

  const walk = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.isFile() && predicate(entryPath)) {
        files.push(entryPath);
      }
    }
  };

  await walk(root);
  files.sort();
  return files;
};

export async function* readJsonl(filePath: string): AsyncIterable<JsonlRecord> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ crlfDelay: Infinity, input: stream });
  let offset = 0;
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    const lineBytes = Buffer.byteLength(line, "utf8");
    const byteStart = offset;
    const byteEnd = byteStart + lineBytes;
    offset = byteEnd + 1;

    if (!line.trim()) {
      continue;
    }

    try {
      yield {
        value: JSON.parse(line),
        lineNumber,
        byteStart,
        byteEnd,
        cursor: `${filePath}:${byteEnd}`,
      };
    } catch {
      yield {
        value: {
          malformed: true,
          rawHash: hashString(line),
        },
        lineNumber,
        byteStart,
        byteEnd,
        cursor: `${filePath}:${byteEnd}`,
      };
    }
  }
}

export const hashString = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 16);

export const userCacheDir = (appName = "runrate"): string => {
  const platform = process.platform;
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appName);
  }
  if (platform === "win32") {
    return path.join(process.env.APPDATA ?? os.homedir(), appName);
  }
  return path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), appName);
};
