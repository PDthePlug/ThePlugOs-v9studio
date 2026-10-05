/** Nitro bundles PGlite JS; retain its WASM/data companions for local build QA. */
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const functions = join(root, ".vercel/output/functions");
const source = dirname(fileURLToPath(import.meta.resolve("@electric-sql/pglite")));
if (existsSync(functions)) {
  for (const fn of readdirSync(functions)) {
    const libs = join(functions, fn, "_libs");
    if (!existsSync(libs) || !readdirSync(libs).some(name => name.includes("pglite"))) continue;
    for (const name of ["pglite.data", "pglite.wasm", "initdb.wasm"]) copyFileSync(join(source,name),join(libs,name));
  }
}
