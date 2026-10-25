import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import {
  readFileSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync as read,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function uploadHandler(decode) {
  const text = readFileSync(
    new URL("../src/components/Workspace.tsx", import.meta.url),
    "utf8",
  );
  const tree = ts.createSourceFile(
    "Workspace.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let handler;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(tree) === "handleLogoFile"
    )
      handler = node.initializer.getText(tree);
    ts.forEachChild(node, visit);
  };
  visit(tree);
  const errors = [];
  const context = vm.createContext({
    Error,
    setError: (value) => errors.push(value),
    createImageBitmap: decode,
  });
  vm.runInContext(
    ts.transpileModule("globalThis.handler=" + handler, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText,
    context,
  );
  return { handler: context.handler, errors };
}
for (const file of [
  { type: "image/png", size: 6 * 1024 * 1024 },
  { type: "image/svg+xml", size: 200 },
]) {
  test(
    "rejects unsafe logo before decoding: " + file.type + " / " + file.size,
    async () => {
      let decoded = false;
      const { handler, errors } = uploadHandler(async () => {
        decoded = true;
        throw new Error("should not decode");
      });
      await handler({ target: { files: [file], value: "selected" } });
      assert.equal(decoded, false);
      assert.ok(errors.length);
    },
  );
}
test("corrupt logo decode produces a readable error", async () => {
  const { handler, errors } = uploadHandler(async () => {
    throw new Error("Invalid image data");
  });
  await handler({
    target: { files: [{ type: "image/png", size: 100 }], value: "selected" },
  });
  assert.equal(errors[0], "Invalid image data");
});
test("export inserts CSP before scripts and hashes inline bootstrap", () => {
  const dir = mkdtempSync(join(tmpdir(), "laplens-security-"));
  try {
    mkdirSync(join(dir, "out"));
    for (const name of [
      "README.md",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "SECURITY.md",
      "screenshot.png",
    ])
      writeFileSync(join(dir, name), "fixture");
    writeFileSync(
      join(dir, "out/index.html"),
      '<html><head lang="en"><meta charset="utf-8"><script>self.fixture=1;</script></head></html>',
    );
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL("./prepare-space.mjs", import.meta.url))],
      { cwd: dir },
    );
    const html = read(join(dir, "out/index.html"), "utf8");
    assert.ok(html.includes("Content-Security-Policy"));
    assert.ok(
      html.indexOf("Content-Security-Policy") < html.indexOf("<script>"),
    );
    assert.ok(html.includes("'sha256-"));
    assert.ok(html.includes("object-src 'none'"));
    assert.ok(!html.includes("script-src 'self' 'unsafe-inline'"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("oversized decoded image is closed and rejected", async () => {
  let closed = false;
  const { handler, errors } = uploadHandler(async () => ({
    width: 5000,
    height: 5000,
    close() {
      closed = true;
    },
  }));
  await handler({
    target: { files: [{ type: "image/png", size: 100 }], value: "selected" },
  });
  assert.equal(closed, true);
  assert.match(errors[0], /16 million pixels/);
});
