import { promises as fs } from "node:fs";
import path from "node:path";
import type { Checkpoint } from "../adapters/sdk.js";
import { userCacheDir } from "../utils/fs.js";

export class CheckpointStore {
  readonly #directory: string;

  constructor(directory = path.join(userCacheDir(), "checkpoints")) {
    this.#directory = directory;
  }

  async read(adapterId: string): Promise<Checkpoint[]> {
    try {
      return JSON.parse(await fs.readFile(this.#path(adapterId), "utf8")) as Checkpoint[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async write(adapterId: string, checkpoints: Checkpoint[]): Promise<void> {
    await fs.mkdir(this.#directory, { recursive: true });
    await fs.writeFile(this.#path(adapterId), `${JSON.stringify(checkpoints, null, 2)}\n`);
  }

  #path(adapterId: string): string {
    return path.join(this.#directory, `${adapterId}.json`);
  }
}
