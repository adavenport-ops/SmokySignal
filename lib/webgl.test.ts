import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseMapMode, isWebGLError, probeWebGL, releaseMap, supportsWebGL, supportsWebGL2 } from "./webgl";

test("chooseMapMode: pending until probed", () => {
  assert.equal(chooseMapMode({ hasWebGL: null, crashed: false }), "pending");
});

test("chooseMapMode: map with WebGL, fallback without", () => {
  assert.equal(chooseMapMode({ hasWebGL: true, crashed: false }), "map");
  assert.equal(chooseMapMode({ hasWebGL: false, crashed: false }), "fallback");
});

test("chooseMapMode: a crash wins over a good probe", () => {
  assert.equal(chooseMapMode({ hasWebGL: true, crashed: true }), "fallback");
  assert.equal(chooseMapMode({ hasWebGL: null, crashed: true }), "fallback");
});

function fakeCanvas(kinds: string[]) {
  const lost: string[] = [];
  const asked: string[] = [];
  return {
    lost,
    asked,
    canvas: {
      getContext(kind: string) {
        asked.push(kind);
        if (!kinds.includes(kind)) return null;
        return { getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext: () => lost.push(kind) } : null) };
      },
    },
  };
}

test("probeWebGL prefers webgl2 and releases the probe context", () => {
  const f = fakeCanvas(["webgl2", "webgl"]);
  assert.equal(probeWebGL(() => f.canvas), true);
  assert.deepEqual(f.asked, ["webgl2"]);
  assert.deepEqual(f.lost, ["webgl2"]);
});

test("probeWebGL falls back to webgl1", () => {
  const f = fakeCanvas(["webgl"]);
  assert.equal(probeWebGL(() => f.canvas), true);
  assert.deepEqual(f.asked, ["webgl2", "webgl"]);
  assert.deepEqual(f.lost, ["webgl"]);
});

test("probeWebGL with webgl2 only refuses a webgl1-only browser", () => {
  const f = fakeCanvas(["webgl"]);
  assert.equal(probeWebGL(() => f.canvas, ["webgl2"]), false);
  assert.deepEqual(f.lost, []);
});

test("probeWebGL: no context, a throwing canvas, or no canvas means no WebGL", () => {
  assert.equal(probeWebGL(() => fakeCanvas([]).canvas), false);
  assert.equal(
    probeWebGL(() => ({
      getContext() {
        throw new Error("blocked");
      },
    })),
    false,
  );
  assert.equal(probeWebGL(() => null), false);
  assert.equal(
    probeWebGL(() => {
      throw new Error("no document");
    }),
    false,
  );
});

test("supportsWebGL is false on the server", () => {
  assert.equal(supportsWebGL(), false);
  assert.equal(supportsWebGL2(), false);
});

test("isWebGLError spots the MapLibre init failure", () => {
  assert.equal(isWebGLError(new Error("Failed to initialize WebGL")), true);
  assert.equal(isWebGLError(new Error("Cannot read properties of undefined")), false);
});

test("releaseMap calls remove and survives a throwing remove", () => {
  let removed = 0;
  releaseMap({ remove: () => void removed++ });
  assert.equal(removed, 1);
  releaseMap({
    remove: () => {
      throw new Error("half built");
    },
  });
  releaseMap(null);
});
