#!/usr/bin/env node
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const serverArgs = process.argv.slice(2);
const watchedFiles = new Set(["cli.js", "app.global.js"]);
const watchers = [];
let builder;
let server;
let restartTimer;
let stopping = false;

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      ...options,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with ${code ?? signal}`));
    });
  });

const startBuilder = () => {
  builder = spawn("pnpm", ["exec", "tsup", "--watch"], {
    cwd: root,
    stdio: "inherit",
  });
  builder.once("exit", (code, signal) => {
    if (!stopping) {
      process.stderr.write(`tsup watch exited with ${code ?? signal}\n`);
      shutdown(1);
    }
  });
};

const startServer = () => {
  server = spawn("node", ["dist/cli.js", "--no-open", ...serverArgs], {
    cwd: root,
    env: {
      ...process.env,
      RUNRATE_DEV: "1",
      RUNRATE_DEV_REVISION: String(Date.now()),
    },
    stdio: "inherit",
  });
  server.once("exit", (code, signal) => {
    if (!stopping && code !== 0 && code !== null) {
      process.stderr.write(`runrate dev server exited with ${code ?? signal}\n`);
    }
  });
};

const stopServer = () =>
  new Promise((resolve) => {
    if (!server || server.killed) {
      resolve();
      return;
    }
    const current = server;
    const timer = setTimeout(() => {
      if (!current.killed) {
        current.kill("SIGKILL");
      }
    }, 2500);
    current.once("exit", () => {
      clearTimeout(timer);
      if (server === current) {
        server = undefined;
      }
      resolve();
    });
    current.kill("SIGTERM");
  });

const scheduleRestart = () => {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(async () => {
    if (stopping) {
      return;
    }
    await stopServer();
    startServer();
  }, 350);
};

const watchDist = () => {
  for (const dir of ["dist", "dist/web"]) {
    const absolute = join(root, dir);
    if (!existsSync(absolute)) {
      continue;
    }
    watchers.push(
      watch(absolute, (_event, filename) => {
        if (filename && watchedFiles.has(String(filename))) {
          scheduleRestart();
        }
      }),
    );
  }
};

const shutdown = async (code = 0) => {
  if (stopping) {
    return;
  }
  stopping = true;
  clearTimeout(restartTimer);
  for (const watcher of watchers) {
    watcher.close();
  }
  if (builder && !builder.killed) {
    builder.kill("SIGTERM");
  }
  await stopServer();
  process.exit(code);
};

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

await run("pnpm", ["exec", "tsup"]);
startBuilder();
watchDist();
startServer();
