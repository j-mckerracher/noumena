import { build, context } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");

const watch = process.argv.includes("--watch");

const opts = {
  entryPoints: [resolve(pkg, "src/main/main.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: resolve(pkg, "dist/main.js"),
  external: [
    "electron",
    "better-sqlite3",
    "electron-store",
    "chokidar",
    "@noumena/core",
  ],
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log("[main] watching...");
} else {
  await build(opts);
}
