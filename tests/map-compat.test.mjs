import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadModule(relativePath, mocks = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    plugins: [{
      name: "test-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in mocks) return { path: args.path, namespace: "mock" };
        });
        builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
          contents: mocks[args.path], loader: "js",
        }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const urls = await loadModule("../src/common/mapgenie/scriptUrl.ts");
const { activateBlockedMapgenieScript } = await loadModule(
  "../src/common/mapgenie/index.ts",
  {
    "@/common/dom": "export const waitForBody = async () => {};",
    "./ads": "export default {};",
    "./page": "export {};",
    "./links": "export {};",
    "./data": "export {};",
  }
);
const { MapPage } = await loadModule("../src/contexts/page/pages/map/index.ts", {
  "../page": "export class Page {}",
  "./ui": "export class UI {}",
  "@/common/client": "export class Client {}",
  "@/common/mapgenie": "export const activateBlockedMapgenieScript = async () => true; export const mapDataUtils = {}; export const fixMapLinks = async () => {};",
  "@/common/object": "export const waitForProperty = async (obj, key) => obj[key];",
  "lazy-get-decorator": "export const LazyGetter = () => () => {};",
});

test("old and hashed scripts are blocked, but their ready URLs are allowed", () => {
  for (const name of ["map", "TarkovQuestToolWidget"]) {
    const rule = new RegExp(urls.getBlockedScriptPattern(name));
    for (const suffix of [".js?id=old", ".f6f9bbcc.js", ".next-build.js?v=2", ".js"]) {
      const src = `https://cdn.mapgenie.io/js/${name}${suffix}`;
      assert.equal(urls.isMapgenieScript(src, name), true, src);
      assert.equal(rule.test(src), true, src);
      const ready = urls.getReadyScriptUrl(src);
      assert.equal(rule.test(ready), false, ready);
      assert.equal(urls.getReadyScriptUrl(ready), ready);
      assert.equal(urls.isMapgenieScript(ready, name), true);
    }
    for (const src of [
      `https://example.com/js/${name}.js`,
      `https://cdn.mapgenie.io/js/${name}.js.map`,
      `https://cdn.mapgenie.io/js/${name}-other.js`,
      `https://cdn.mapgenie.io/js/vendor/${name}.js`,
    ]) {
      assert.equal(urls.isMapgenieScript(src, name), false, src);
      assert.equal(rule.test(src), false, src);
    }
  }
});

test("script activation locates hashed and legacy URLs and preserves query data", async () => {
  for (const suffix of [".f6f9bbcc.js", ".js?id=old"]) {
    const original = `https://cdn.mapgenie.io/js/map${suffix}`;
    let inserted;
    globalThis.document = {
      querySelectorAll: () => [{ src: "https://cdn.mapgenie.io/js/vendor.js" }, { src: original }],
      createElement: () => {
        const handlers = {};
        return { handlers, addEventListener: (type, fn) => { handlers[type] = fn; } };
      },
      body: { appendChild: (script) => { inserted = script; script.handlers.load(); } },
    };
    assert.equal(await activateBlockedMapgenieScript("map"), true);
    assert.equal(inserted.src, urls.getReadyScriptUrl(original));
    assert.equal(inserted.async, false);
  }
  globalThis.document.querySelectorAll = () => [];
  assert.equal(await activateBlockedMapgenieScript("map"), false);
});

function fixture({ loaded = true, legacy = false } = {}) {
  const listeners = new Map();
  const visual = [];
  const actions = [];
  const saved = { 1: true, 2: true, 3: false, 999: true };
  const state = {
    map: { [legacy ? "locationById" : "locationsById"]: { 1: {}, 2: {}, 3: {} } },
    user: { foundLocations: { 1: true }, foundLocationsCount: 1 },
  };
  const map = {
    loaded: () => loaded,
    on: (event, fn) => { listeners.set(event, fn); },
    off: (event) => { listeners.delete(event); },
  };
  globalThis.logger = { log() {}, warn() {} };
  globalThis.window = {
    setTimeout, clearTimeout,
    user: { locations: saved },
    mapData: { locations: [] },
    mapManager: { map, setLocationFound: (id, found) => visual.push([id, found]), updateFoundLocationsStyle() {} },
    store: {
      getState: () => state,
      dispatch: (action) => {
        actions.push(action);
        for (const id of action.meta.locationIds) {
          state.user.foundLocations[id] = true;
          state.user.foundLocationsCount++;
        }
      },
    },
  };
  return { page: new MapPage(), state, saved, visual, actions, listeners };
}

test("restore styles for all saved markers without double counting or cross-map leakage", async () => {
  for (const legacy of [false, true]) {
    const f = fixture({ legacy });
    await f.page.syncSavedLocationsToMap();
    assert.deepEqual(f.visual, [[1, true], [2, true]]);
    assert.deepEqual(f.actions[0].meta.locationIds, [2]);
    assert.equal(f.state.user.foundLocationsCount, 2);
    await f.page.syncSavedLocationsToMap();
    assert.equal(f.actions.length, 1);
    assert.equal(f.state.user.foundLocationsCount, 2);
    assert.deepEqual(f.saved, { 1: true, 2: true, 3: false, 999: true });
  }
});

test("restoration waits for map load and removes its listeners", async () => {
  const f = fixture({ loaded: false });
  const pending = f.page.syncSavedLocationsToMap();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.visual.length, 0);
  assert.equal(f.actions.length, 0);
  f.listeners.get("load")();
  await pending;
  assert.deepEqual(f.visual, [[1, true], [2, true]]);
  assert.equal(f.listeners.size, 0);
});

test("style timeout removes listeners and leaves stored data unchanged", async () => {
  const f = fixture({ loaded: false });
  await assert.rejects(f.page.waitForMapStyle(5), /timed out/);
  assert.equal(f.listeners.size, 0);
  assert.equal(f.actions.length, 0);
  assert.deepEqual(f.saved, { 1: true, 2: true, 3: false, 999: true });
});
