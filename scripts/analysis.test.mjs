import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import ts from "typescript";

function source(path) {
  return ts
    .transpileModule(
      readFileSync(new URL("../" + path, import.meta.url), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    )
    .outputText.replaceAll("import.meta.url", '"file:///test/analyzer.js"');
}
function client() {
  const timers = [];
  const workers = [];
  const context = vm.createContext({
    exports: {},
    URL,
    DOMException,
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout() {},
    Worker: class {
      constructor() {
        workers.push(this);
      }
      postMessage(message) {
        this.last = message;
      }
      terminate() {
        this.closed = true;
      }
    },
  });
  vm.runInContext(source("src/lib/analyzer.ts"), context);
  const analyzer = new context.exports.LocalRaceAnalyzer();
  analyzer.ready.catch(() => {});
  return { analyzer, worker: workers[0], timers };
}
test("worker crash rejects readiness and terminates the worker", async () => {
  const { analyzer, worker } = client();
  assert.equal(typeof worker.onerror, "function");
  worker.onerror({ preventDefault() {} });
  await assert.rejects(analyzer.ready, /worker/i);
  assert.equal(worker.closed, true);
});
test("unresponsive worker requests time out", async () => {
  const { analyzer, timers } = client();
  assert.ok(timers.length);
  timers[0]();
  await assert.rejects(analyzer.ready, /timed out/i);
});
test("worker decode errors reject pending requests", async () => {
  const { analyzer, worker } = client();
  assert.equal(typeof worker.onmessageerror, "function");
  worker.onmessageerror({});
  await assert.rejects(analyzer.ready, /worker/i);
});
test("clearing a sponsor reference is sent to the worker", async () => {
  const { analyzer, worker } = client();
  worker.onmessage({ data: { id: 1, result: { provider: "WASM" } } });
  const pending = analyzer.setReference(null, null);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(worker.last.type, "set-reference");
  assert.equal(worker.last.reference, null);
  worker.onmessage({ data: { id: worker.last.id, result: true } });
  await pending;
  analyzer.dispose();
});
test("rejects excessive frame dimensions before allocating a canvas", async () => {
  const { analyzer, worker } = client();
  worker.onmessage({ data: { id: 1, result: { provider: "WASM" } } });
  await assert.rejects(
    analyzer.analyze(
      { videoWidth: 16000, videoHeight: 16000, duration: 10 },
      [],
      new AbortController().signal,
      () => {},
    ),
    /resolution|pixels/i,
  );
  analyzer.dispose();
});

test("feature extraction releases every OpenCV matrix", () => {
  const context = vm.createContext({ exports: {}, self: { postMessage() {} } });
  vm.runInContext(source("src/lib/vision.worker.ts"), context);
  const live = vm.runInContext(
    `(()=>{ const live=new Set(); class Mat{constructor(){this.data=new Uint8Array(32);this.cols=32;live.add(this);}delete(){live.delete(this);}} cv={Mat,KeyPointVector:class{size(){return 0;}delete(){}},ORB:class{detectAndCompute(){}delete(){}},cvtColor(){}};computeFeatures({channels:()=>4});return live.size;})()`,
    context,
  );
  assert.equal(live, 0);
});

test("worker clears stale references without loading OpenCV", async () => {
  const context = vm.createContext({ exports: {}, self: { postMessage() {} } });
  vm.runInContext(source("src/lib/vision.worker.ts"), context);
  vm.runInContext('session={}; references.set("stale", {});', context);
  await context.self.onmessage({
    data: { id: 2, type: "set-reference", reference: null },
  });
  assert.equal(vm.runInContext("references.size", context), 0);
  assert.equal(vm.runInContext("cvReady", context), undefined);
});

test("cancellation rejects pending work with AbortError", async () => {
  const { analyzer, worker } = client();
  analyzer.dispose(new DOMException("Analysis cancelled.", "AbortError"));
  await assert.rejects(analyzer.ready, { name: "AbortError" });
  assert.equal(worker.closed, true);
});
