import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/cli.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    banner: {
      js: "#!/usr/bin/env node",
    },
  },
  {
    entry: {
      "web/app": "src/web/app.tsx",
    },
    format: ["iife"],
    platform: "browser",
    target: "es2020",
    dts: false,
    sourcemap: true,
    clean: false,
    define: {
      "process.env.NODE_ENV": '"production"',
    },
  },
]);
