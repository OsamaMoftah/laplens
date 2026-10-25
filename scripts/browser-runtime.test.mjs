import assert from "node:assert/strict";
import test from "node:test";
import browserRuntime from "./browser-runtime.cjs";

test("preserves bundled WASM asset resolution while removing build-path expressions", () => {
  const source =
    'const base=import.meta.url; const wasm=new URL("engine.wasm",import.meta.url);';
  const output = browserRuntime(source);
  assert.ok(output.includes('new URL("engine.wasm",import.meta.url)'));
  assert.ok(output.includes("const base=self.location.href"));
});
