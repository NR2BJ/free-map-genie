import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import axios, { AxiosError } from "axios";
import { setupCache } from "axios-cache-interceptor";

globalThis.testAxios = axios;
globalThis.testSetupCache = setupCache;

async function load(path, mocks = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
    define: {
      "import.meta.env.MAPGENIE_API_URL": JSON.stringify("https://example.invalid/api/v1"),
      "import.meta.env.SERVICE_TIMEOUT": "1000",
      "import.meta.env.DEV": "false",
    },
    plugins: [{ name: "boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in mocks ? { path: a.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path], loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { selectMapFromGame } = await load("../src/common/mapgenie/mapResponse.ts");
const dataUtils = await load("../src/common/mapgenie/data.ts");
const { installMapDataResponseOverride, prepareMapDataResponseOverride } = await load("../src/common/mapgenie/mapDataResponse.ts");
const { default: MapgenieService } = await load("../src/services/mapgenie.service.ts", {
  "axios": "export default globalThis.testAxios;",
  "axios-cache-interceptor": "export const setupCache = globalThis.testSetupCache;",
  "wxt/browser": "export const browser = { storage: { local: {} } };",
  "@/common/messaging": "export const createService = ({context}) => context; export const Memoize = () => f => f;",
  "./backend.service": "export default {use: () => ({})};",
});
const { MapPage } = await load("../src/contexts/page/pages/map/index.ts", {
  "../page": "export class Page {}",
  "./ui": "export class UI {}",
  "@/common/client": "export class Client {}",
  "@/common/mapgenie": "export const activateBlockedMapgenieScript = async () => true; export const mapDataUtils = {loadMapData: (...a) => globalThis.dataUtils.loadMapData(...a), getStoredTileCoordinateSwap: () => false}; export const fixMapLinks = async () => {};",
  "@/common/mapgenie/mapLoadError": "export const showMapLoadError = () => globalThis.alerts++;",
  "@/common/mapgenie/mapDataResponse": "export const prepareMapDataResponseOverride = () => {};",
  "@/common/object": "export const waitForProperty = async (obj, key) => obj[key];",
  "lazy-get-decorator": "export const LazyGetter = () => () => {};",
});
globalThis.logger = { log() {}, warn() {}, error() {} };
globalThis.dataUtils = dataUtils;

function map(id = 64) {
  return {
    id, game_id: 20, title: `Map ${id}`, locations_count: 1,
    config: { initial_zoom: 10, start_lat: 1, start_lng: 2,
      tile_sets: [{ path: "test/map", extension: "jpg", pattern: "test/map/{z}/{x}/{y}.jpg" }] },
    groups: [{ id: 1, categories: [{ id: 2, locations: [{ id: id * 10, map_id: id, category_id: 2 }] }] }],
    regions: [],
  };
}
function game() { return { id: 20, title: "Test", maps: [map(), map(577)], config: { url: "https://example.invalid/test" }, default_presets: [] }; }

test("game-full response becomes the requested map with lightweight game metadata", () => {
  const original = game();
  const result = selectMapFromGame(original, 20, 577);
  assert.equal(result.id, 577);
  assert.equal(result.groups[0].categories[0].locations[0].map_id, 577);
  assert.deepEqual(result.game.maps.map(m => m.id), [64, 577]);
  assert.equal(result.game.maps[0].groups, undefined);
  assert.ok(original.maps[0].groups);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test("rejects catalog-only, wrong-game, foreign-location and withheld-marker responses", () => {
  for (const mutate of [
    g => { g.id = 30; },
    g => { g.maps[0].game_id = 30; },
    g => { g.maps = []; },
    g => { delete g.maps[0].groups; },
    g => { delete g.maps[0].config; },
    g => { delete g.maps[0].regions; },
    g => { g.maps[0].config.start_lat = NaN; },
    g => { delete g.maps[0].groups[0].categories; },
    g => { delete g.maps[0].groups[0].categories[0].locations; },
    g => { g.maps[0].groups[0].categories[0].locations[0].map_id = 577; },
    g => { g.maps[0].groups[0].categories[0].locations = []; },
  ]) {
    const g = game(); mutate(g);
    assert.throws(() => selectMapFromGame(g, 20, 64));
  }
  const empty = game();
  empty.maps[0].locations_count = 0;
  empty.maps[0].groups = [];
  assert.equal(selectMapFromGame(empty, 20, 64).groups.length, 0);
});

function apiFixture() {
  globalThis.$headers = { "X-FMG-Test": "retained" };
  const api = new MapgenieService();
  const requests = [];
  api.axios.defaults.adapter = async config => {
    requests.push(config);
    const data = config.url.includes("/games/") ? game() : map(Number(config.url.split("/").at(-1)));
    return { data, status: 200, statusText: "OK", headers: {}, config };
  };
  return { api, requests };
}

test("fetchMap uses metadata + game/full with existing headers and shared game cache", async () => {
  const f = apiFixture();
  assert.equal((await f.api.fetchMap("64")).id, 64);
  assert.equal((await f.api.fetchMap(577)).id, 577);
  assert.deepEqual(f.requests.map(r => r.url), ["/maps/64", "/games/20/full", "/maps/577"]);
  assert.ok(f.requests.every(r => r.headers.get("X-FMG-Test") === "retained" && r.timeout > 0));
  for (const id of ["x", 0, -1, 1.5, Infinity]) await assert.rejects(f.api.fetchMap(id), /Invalid map ID/);
  assert.equal(f.requests.length, 3);
});

test("map fetch errors propagate and a retry can succeed", async () => {
  const f = apiFixture();
  const adapter = f.api.axios.defaults.adapter;
  f.api.axios.defaults.adapter = async config => {
    throw new AxiosError("Unavailable", "ERR_BAD_RESPONSE", config, null, { status: 503, headers: {}, config });
  };
  await assert.rejects(f.api.fetchMap(64), /Unavailable/);
  f.api.axios.defaults.adapter = adapter;
  assert.equal((await f.api.fetchMap(64)).id, 64);
});

test("tile patterns honor the response and a reversible manual X/Y override", () => {
  const m = selectMapFromGame(game(), 20, 64);
  for (const [swap, pattern] of [[false, "test/map/{z}/{x}/{y}.jpg"], [true, "test/map/{z}/{y}/{x}.jpg"], [false, "test/map/{z}/{x}/{y}.jpg"]]) {
    globalThis.window = { mapData: { map: { id: 1 }, mapConfig: { tile_sets: [] } } };
    dataUtils.loadMapData(m, { swapTileCoordinates: swap });
    assert.equal(window.mapData.mapConfig.tile_sets[0].pattern, pattern);
  }
  delete m.config.tile_sets[0].pattern;
  dataUtils.loadMapData(m, { swapTileCoordinates: true });
  assert.equal(window.mapData.mapConfig.tile_sets[0].pattern, "test/map/{z}/{y}/{x}.jpg");
  globalThis.window.mapData.mapConfig = { tile_sets: [] };
  dataUtils.loadMapData(m);
  assert.equal(window.mapData.mapConfig.tile_sets[0].pattern, "test/map/{z}/{y}/{x}.jpg");
});

test("map application is atomic when config normalization fails", () => {
  const original = { map: { id: 1 }, locations: [{ id: 123 }], mapConfig: { tile_sets: [] } };
  globalThis.window = { mapData: structuredClone(original) };
  const m = map(); m.config.tile_sets = null;
  assert.throws(() => dataUtils.loadMapData(m));
  assert.deepEqual(window.mapData, original);
});

function pageFixture(query = "?fmgMapId=64") {
  globalThis.alerts = 0;
  globalThis.window = {
    location: { search: query }, game: { id: 20 }, axios: {},
    mapData: { map: { id: 1, game_id: 20 }, locations: [], categories: {}, mapConfig: { tile_sets: [] } },
    user: { locations: {} },
  };
  const page = new MapPage();
  page.client = { mapgenie: { fetchMap: async () => selectMapFromGame(game(), 20, 64) } };
  return page;
}

test("failed target fetch stops boot instead of showing the original map as the target", async () => {
  const page = pageFixture();
  let activated = false;
  page.setupUser = async () => {};
  page.activateMapScript = async () => { activated = true; };
  page.client.mapgenie.fetchMap = async () => { throw new Error("404"); };
  await assert.rejects(page.start(), /404/);
  assert.equal(activated, false);
  assert.equal(window.mapData.map.id, 1);
  assert.equal(globalThis.alerts, 1);
});

test("foreign-game and invalid target IDs cannot replace the original map", async () => {
  for (const query of ["?fmgMapId=bad", "?fmgMapId=0", "?fmgMapId="]) {
    const page = pageFixture(query);
    await assert.rejects(page.loadRemoteMapData(), /Invalid/);
    assert.equal(window.mapData.map.id, 1);
  }
  const page = pageFixture();
  window.game.id = 254;
  await assert.rejects(page.loadRemoteMapData(), /does not belong/);
  assert.equal(window.mapData.map.id, 1);
});

test("optional heatmap failure does not discard a successfully loaded target", async () => {
  const page = pageFixture();
  page.loadHeatmaps = async () => { throw new Error("503"); };
  await page.loadRemoteMapData();
  assert.equal(window.mapData.map.id, 64);
  assert.equal(globalThis.alerts, 0);
});

test("empty maps never inherit other maps' saved progress or erase backend data", async () => {
  const page = pageFixture();
  const saved = { locations: { 640: true }, trackedCategoryIds: [], notes: [], presets: [] };
  page.client = { migrate: async () => {}, getData: async () => saved };
  await page.loadUserData();
  assert.deepEqual(window.user.locations, {});
  assert.deepEqual(saved.locations, { 640: true });
});

test("new async boot response preserves Pro markers and current metadata", async () => {
  window.location.origin = "https://mapgenie.io";
  let payload = { map: { id: 64 }, locations: [], styles: { mapStyle: "current" }, roads: [1], tags: [2] };
  const http = axios.create({ adapter: async config => ({ data: payload, config, status: 200, headers: {} }) });
  const saved = [{ id: 10, map_id: 64, title: "Original", latitude: "1" }];
  installMapDataResponseOverride(http, 64, saved);
  const first = (await http.get("/api/v1/maps/64/data")).data;
  assert.deepEqual(first.locations, saved);
  assert.deepEqual(first.styles, payload.styles);
  assert.deepEqual(first.roads, [1]);
  assert.deepEqual(payload.locations, []);
  payload = { ...payload, locations: [{ id: 10, map_id: 64, title: "New" }, { id: 20, map_id: 64 }] };
  const second = (await http.get("/api/v1/maps/64/data?retry=1")).data;
  assert.equal(second.locations.length, 2);
  assert.deepEqual(second.locations[0], { ...saved[0], title: "New" });
  assert.equal(saved[0].title, "Original");
});

test("boot override does not touch other maps, user data, writes or other origins", async () => {
  window.location.origin = "https://mapgenie.io";
  const payload = { untouched: true };
  const http = axios.create({ adapter: async config => ({ data: payload, config, status: 200, headers: {} }) });
  installMapDataResponseOverride(http, 64, [{ id: 10, map_id: 64 }]);
  for (const url of ["/api/v1/maps/577/data", "/api/v1/user/map-data/64", "https://example.test/api/v1/maps/64/data"]) {
    assert.deepEqual((await http.get(url)).data, payload);
  }
  assert.deepEqual((await http.post("/api/v1/maps/64/data")).data, payload);
  await assert.rejects(http.get("/api/v1/maps/64/data"), /Invalid map data/);
});

test("boot override catches the very first request when map.js creates Axios", async () => {
  globalThis.window = { location: { origin: "https://mapgenie.io" } };
  prepareMapDataResponseOverride(64, [{ id: 10, map_id: 64 }]);
  window.axios = axios.create({ adapter: async config => ({ data: {map:{id:64},locations:[]}, config, status:200,headers:{} }) });
  assert.deepEqual((await window.axios.get("/api/v1/maps/64/data")).data.locations, [{ id:10, map_id:64 }]);
  assert.equal(Object.getOwnPropertyDescriptor(window, "axios").writable, true);
});
