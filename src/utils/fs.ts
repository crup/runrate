import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

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

export const readCompleteJsonl = async (filePath: string): Promise<JsonlRecord[]> => {
  const buffer = await fs.readFile(filePath);
  const text = buffer.toString("utf8");
  const hasTrailingNewline = text.endsWith("\n");
  const rawLines = text.split("\n");
  const completeLines = hasTrailingNewline ? rawLines.slice(0, -1) : rawLines.slice(0, -1);
  const records: JsonlRecord[] = [];
  let offset = 0;

  for (let index = 0; index < completeLines.length; index += 1) {
    const line = completeLines[index] ?? "";
    const lineBytes = Buffer.byteLength(line, "utf8");
    const byteStart = offset;
    const byteEnd = byteStart + lineBytes;
    offset = byteEnd + 1;

    if (!line.trim()) {
      continue;
    }

    try {
      records.push({
        value: JSON.parse(line),
        lineNumber: index + 1,
        byteStart,
        byteEnd,
        cursor: `${filePath}:${byteEnd}`,
      });
    } catch {
      if (index !== completeLines.length - 1) {
        records.push({
          value: {
            malformed: true,
            rawHash: hashString(line),
          },
          lineNumber: index + 1,
          byteStart,
          byteEnd,
          cursor: `${filePath}:${byteEnd}`,
        });
      }
    }
  }

  return records;
};

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
