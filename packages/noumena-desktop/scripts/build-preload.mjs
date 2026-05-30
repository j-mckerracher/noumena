import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");

await build({
  entryPoints: [resolve(pkg, "src/preload/preload.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: resolve(pkg, "dist/preload.js"),
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
});
