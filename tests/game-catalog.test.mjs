import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/common/mapgenie/gameCatalog.ts", import.meta.url))],
  bundle: true, write: false, platform: "node", format: "esm",
});
const { fetchGameCatalog } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);
const games = [{ id: 1, title: "Game", slug: "game", domain: "mapgenie.io",
  config: { url: "https://mapgenie.io/game" }, maps: [] }];
const key = "fmg:game-catalog:v1";
const updatedKey = "fmg:game-catalog:updated-at:v1";
const url = "https://mapgenie.io/api/v1/games";

test("public catalog request omits credentials and custom headers and caches results", async (t) => {
  let saved;
  t.mock.method(globalThis, "fetch", async (input, options) => {
    assert.equal(input, url);
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => games };
  });
  assert.deepEqual(await fetchGameCatalog(url, {
    get: async () => ({}), set: async (value) => { saved = value; },
  }), games);
  assert.deepEqual(saved[key], games);
});

test("network errors, bad HTTP status and invalid JSON data use the saved catalog", async (t) => {
  let mode;
  t.mock.method(globalThis, "fetch", async () => {
    if (mode === "network") throw new TypeError("Network Error");
    if (mode === "http") return { ok: false, status: 403 };
    return { ok: true, json: async () => ({ message: "Not a catalog" }) };
  });
  for (mode of ["network", "http", "invalid"]) {
    assert.deepEqual(await fetchGameCatalog(url, {
      get: async () => ({ [key]: games }), set: async () => assert.fail("Bad response cached"),
    }), games);
    await new Promise((resolve) => setImmediate(resolve));
  }
});

test("cached catalog returns before the network and the next open sees the refresh", async (t) => {
  let completeRequest;
  let saved = { [key]: games };
  const updated = [{ ...games[0], title: "Updated title" }];
  let didWrite;
  const written = new Promise((resolve) => { didWrite = resolve; });
  t.mock.method(globalThis, "fetch", () => new Promise((resolve) => { completeRequest = resolve; }));
  const storage = {
    get: async () => saved,
    set: async (value) => { saved = value; didWrite(); },
  };
  const immediate = await fetchGameCatalog(url, storage);
  assert.deepEqual(immediate, games);
  assert.deepEqual(saved[key], games);
  completeRequest({ ok: true, json: async () => updated });
  await written;
  assert.deepEqual(await fetchGameCatalog(url, storage), updated);
  completeRequest({ ok: true, json: async () => updated });
  await new Promise((resolve) => setImmediate(resolve));
});

test("unavailable cache falls back to a network request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => games }));
  assert.deepEqual(await fetchGameCatalog(url, {
    get: async () => { throw new Error("Storage unavailable"); },
    set: async () => {},
  }), games);
});

test("cache write errors do not break a successful request", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => games }));
  assert.deepEqual(await fetchGameCatalog(url, {
    set: async () => { throw new Error("Quota"); }, get: async () => ({}),
  }), games);
});

test("missing or corrupt cache preserves the network error", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Offline"); });
  for (const value of [undefined, [], { id: 1 }]) {
    await assert.rejects(fetchGameCatalog(url, {
      get: async () => ({ [key]: value }), set: async () => {},
    }), /Offline/);
  }
});

test("fresh catalog skips requests for an hour", async (t) => {
  t.mock.method(globalThis, "fetch", () => { assert.fail("Unnecessary refresh"); });
  const saved = { [key]: games, [updatedKey]: Date.now() - 1000 };
  assert.deepEqual(await fetchGameCatalog(url, { get: async () => saved, set: async () => {} }), games);
});

test("concurrent catalog requests share one network operation", async (t) => {
  let finish;
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; return new Promise((resolve) => { finish = resolve; }); });
  const storage = { get: async () => ({}), set: async () => {} };
  const first = fetchGameCatalog(url, storage);
  const second = fetchGameCatalog(url, storage);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  finish({ ok: true, json: async () => games });
  assert.deepEqual(await first, games);
  assert.deepEqual(await second, games);
});
