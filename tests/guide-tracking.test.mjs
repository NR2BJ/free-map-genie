import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import axios from "axios";

async function load(path, mocks = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
    plugins: [{ name: "boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, a => {
        if (a.path in mocks) return { path: a.path, namespace: "mock" };
        if (a.path === "@/common/storage") return { path: fileURLToPath(new URL("../src/common/storage/key.ts", import.meta.url)) };
      });
      b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path], loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { Client } = await load("../src/common/client.ts", {
  "@/services/backend.service": "export default {use: () => globalThis.backend};",
  "@/services/mapgenie.service": "export default {use: () => globalThis.mapgenie};",
  "@/services/client.service": "export default {provide: () => {}};",
  "@/common/object": "export const waitForProperty = async (obj, key) => { if (!obj[key]) throw new Error('Missing property'); return obj[key]; };",
});
globalThis.TestClient = Client;
const { GuidePage } = await load("../src/contexts/page/pages/guide/index.ts", {
  "../page": "export class Page {}",
  "@/common/client": "export const Client = globalThis.TestClient;",
  "@/common/mapgenie": "export const activateBlockedMapgenieScript = async () => true;",
  "@/common/object": "export const waitForProperty = async (obj, key) => obj[key];",
  "@/common/dom": "export const waitForElement = async () => {};",
});

function fixture(saved = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [i + 1, true]))) {
  const writes = [];
  let networkRequests = 0;
  const localAxios = axios.create({ adapter: async () => { networkRequests++; throw new Error("Unexpected server write"); } });
  localAxios.defaults.headers.common["X-Game-ID"] = "241";
  globalThis.window = {
    location: { origin: "https://mapgenie.io", href: "https://mapgenie.io/escape-from-duckov/guides/quests", pathname: "/escape-from-duckov/guides/quests" },
    axios: localAxios, isPro: false, maxFoundLocations: 100,
  };
  globalThis.logger = { debug() {}, log() {}, warn() {} };
  globalThis.state = { foundLocations: {} };
  const checkbox = { id: 101, checked: false, parentElement: null, closest: () => null };
  globalThis.$ = element => typeof element === "string"
    ? { each: fn => fn(0, checkbox), length: 1, prop: (_, value) => { checkbox.checked = value; } }
    : { data: () => element.id, prop: (_, value) => { element.checked = value; }, parent: () => null };
  globalThis.backend = {
    getActiveProfile: async () => ({ id: -7 }),
    isStoragePersisted: async () => true,
    migrate: async () => {},
    getData: async () => ({ locations: structuredClone(saved), trackedCategoryIds: [], notes: [], presets: [], presetOrdering: [] }),
    markLocationFound: async (key, id, found) => {
      writes.push([key.gameId, key.userId, id, found]);
      if (found) saved[id] = true;
      else delete saved[id];
    },
  };
  globalThis.mapgenie = { fetchGame: async () => ({ default_presets: [] }), fetchGames: async () => [
    { id: 241, slug: "escape-from-duckov", domain: "mapgenie.io" },
    { id: 20, slug: "tarkov", domain: "mapgenie.io" },
  ] };
  const page = new GuidePage();
  const mapWindow = { user: { id: -7, realId: 42 }, addEventListener() {} };
  page.getMapWindow = async () => mapWindow;
  page.getMapElement = async () => ({ addEventListener() {} });
  return { page, saved, writes, checkbox, mapWindow, networkRequests: () => networkRequests };
}

// Mirror the public guide handler's cap and Axios calls, using the actual FMG
// interceptor and synthetic records. No requests can reach a real account.
async function changeLocation(id, found) {
  if (window.maxFoundLocations && found && Object.keys(state.foundLocations).length >= window.maxFoundLocations) {
    return false;
  }
  await window.axios[found ? "put" : "delete"](`/api/v1/user/locations/${id}`);
  if (found) state.foundLocations[id] = true;
  else delete state.foundLocations[id];
  return true;
}

test("guide marks item 101 locally, restores it on reinitialization, and unmarks it", async () => {
  let f = fixture();
  await f.page.start();
  assert.equal(window.maxFoundLocations, Infinity);
  assert.equal(window.isPro, true);
  assert.equal(window.user.realId, 42);
  assert.equal(window.user.id, -7);
  assert.equal(await changeLocation(101, true), true);
  assert.equal(Object.keys(f.saved).length, 101);
  assert.deepEqual(f.writes, [[241, -7, 101, true]]);
  assert.equal(f.networkRequests(), 0);

  f = fixture(f.saved);
  await f.page.start();
  assert.equal(f.checkbox.checked, true);
  assert.equal(Object.keys(state.foundLocations).length, 101);
  assert.equal(await changeLocation(101, false), true);
  assert.equal(Object.keys(f.saved).length, 100);
  assert.equal(f.networkRequests(), 0);
});

test("guide does not lift the cap if local-save initialization fails", async () => {
  const f = fixture();
  f.page.client.installInterceptor = async () => { throw new Error("Backend unavailable"); };
  await assert.rejects(f.page.start(), /Backend unavailable/);
  assert.equal(window.maxFoundLocations, 100);
  assert.equal(window.isPro, false);
  assert.equal(f.networkRequests(), 0);
  assert.equal(f.writes.length, 0);
});

test("guide waits for the embedded map's delayed account before connecting local saves", async () => {
  for (const initialState of ["missing", "undefined", "empty"]) {
    const f = fixture();
    const user = f.mapWindow.user;
    if (initialState === "missing") delete f.mapWindow.user;
    else f.mapWindow.user = initialState === "empty" ? {} : undefined;
    let finished = false;
    const starting = f.page.start().then(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 10));
    const finishedBeforeAccount = finished;
    f.mapWindow.user = user;
    await starting;
    assert.equal(finishedBeforeAccount, false, "guide silently skipped saving before the iframe account loaded");
    assert.equal(await changeLocation(101, true), true);
    assert.deepEqual(f.writes, [[241, -7, 101, true]]);
    assert.equal(f.networkRequests(), 0);
    const restored = fixture(f.saved);
    await restored.page.start();
    assert.equal(restored.checkbox.checked, true);
  }
});

test("an explicitly signed-out embedded map does not enable local guide tracking", async () => {
  const f = fixture();
  f.mapWindow.user = null;
  await f.page.start();
  assert.equal(window.maxFoundLocations, 100);
  assert.equal(window.user, undefined);
  assert.equal(f.writes.length, 0);
});

test("missing or invalid guide header awaits URL lookup before installing handlers", async () => {
  for (const header of [undefined, "bad", "0"]) {
    const f = fixture();
    window.axios.defaults.headers.common["X-Game-ID"] = header;
    let release;
    const catalog = await mapgenie.fetchGames();
    mapgenie.fetchGames = () => new Promise(resolve => { release = () => resolve(catalog); });
    const start = f.page.start();
    while (!release) await new Promise(resolve => setImmediate(resolve));
    assert.equal(window.maxFoundLocations, 100);
    release();
    await start;
    assert.equal(await changeLocation(101, true), true);
    assert.deepEqual(f.writes[0], [241, -7, 101, true]);
    assert.equal(f.networkRequests(), 0);
  }
});

test("uninitialized clients cannot silently install an interceptor with no handlers", async () => {
  fixture();
  const client = new Client();
  await assert.rejects(client.installInterceptor(), /not logged in/);
});

test("map-to-guide events work without a global markLocationFound helper", async () => {
  const f = fixture();
  await f.page.start();
  delete globalThis.markLocationFound;
  f.page.state.markLocationFound(101, true);
  assert.equal(state.foundLocations[101], true);
  assert.equal(f.checkbox.checked, true);
  f.page.state.markLocationFound(101, false);
  assert.equal(101 in state.foundLocations, false);
  assert.equal(f.checkbox.checked, false);
});
