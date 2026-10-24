import { mkdir, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const entry = require.resolve("onnxruntime-web");
const distribution = dirname(entry);
const destination = join(process.cwd(), "public", "ort");
await mkdir(destination, { recursive: true });

for (const extension of ["mjs", "wasm"]) {
  await copyFile(
    join(distribution, `ort-wasm-simd-threaded.${extension}`),
    join(destination, `ort-wasm-simd-threaded.${extension}`),
  );
}
