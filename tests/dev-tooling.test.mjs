import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function load(path, mocks) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm", target: "es2022",
    plugins: [{ name: "tooling-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in mocks ? { path: a.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path], loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const storage = await load("../e2e/helpers/index.ts", {
  "node:fs": "export default {promises:{readFile:(...args)=>globalThis.readTestState(...args)}};",
  "@playwright/test": "export const chromium = {}; export const firefox = {};",
  "playwright-webextext": "export const withExtension = () => { throw new Error('Browser launch not expected'); };",
  "./firefox": "export const setFirefoxExtensionInfo = () => {}; export const resolveFirefoxExtensionInfo = async () => ({});",
});
const firefoxInfo = await load("../e2e/helpers/firefox.ts", {
  "playwright-webextext/dist/firefox_remote.js": "export const connectWithMaxRetries = async () => {}; export const findFreeTcpPort = async () => 1;",
});
const { default: iconModule } = await load("../modules/fantasticon.ts", {
  "wxt/modules": "export const defineWxtModule = module => module;",
  "fantasticon": "export const generateFonts = (...args) => globalThis.generateTestFonts(...args);",
  "node:fs": "export default {existsSync:()=>true};",
});

test("missing storage state is empty and does not initialize cookies or localStorage", async () => {
  assert.deepEqual(await storage.resolveStorageState(undefined), {});
  const context = { addCookies: () => assert.fail("No cookies expected"), addInitScript: () => assert.fail("No script expected") };
  await storage.loadStorageState(context, undefined);
  assert.deepEqual(await storage.extendStorageState(undefined, undefined), { cookies: [], origins: [] });
});

test("storage state accepts partial objects and JSON files without losing their data", async () => {
  const state = { origins: [{ origin: "https://example.test", localStorage: [{ name: "saved", value: "yes" }] }] };
  assert.deepEqual(await storage.resolveStorageState(state), state);
  globalThis.readTestState = async (filename, encoding) => {
    assert.equal(filename, "test-state.json");
    assert.equal(encoding, "utf-8");
    return JSON.stringify(state);
  };
  assert.deepEqual(await storage.resolveStorageState("test-state.json"), state);
});

test("invalid JSON storage state reports an error instead of returning null", async () => {
  for (const data of ["null", "[]", "42", '"text"']) {
    globalThis.readTestState = async () => data;
    await assert.rejects(storage.resolveStorageState("bad.json"), /Invalid storage state.*expected an object/);
  }
  globalThis.readTestState = async () => "{";
  await assert.rejects(storage.resolveStorageState("bad.json"), SyntaxError);
});

test("storage state loading applies only localStorage for the current origin", async () => {
  const writes = [], cookies = [];
  globalThis.window = { location: { origin: "https://example.test" }, localStorage: { setItem: (...args) => writes.push(args) } };
  await storage.loadStorageState({
    addCookies: async values => cookies.push(...values),
    addInitScript: async (fn, value) => fn(value),
  }, {
    cookies: [{ name: "test", value: "1", domain: "example.test", path: "/" }],
    origins: [
      { origin: "https://other.test", localStorage: [{ name: "wrong", value: "no" }] },
      { origin: "https://example.test", localStorage: [{ name: "saved", value: "yes" }] },
    ],
  });
  assert.equal(cookies.length, 1);
  assert.deepEqual(writes, [["saved", "yes"]]);
});

test("extending state preserves primary entries and accepts a missing primary state", async () => {
  const primary = { cookies: [{ name: "login", domain: "example.test", value: "primary" }], origins: [] };
  const additional = { cookies: [
    { name: "login", domain: "example.test", value: "secondary" },
    { name: "test", domain: "example.test", value: "extra" },
  ] };
  const merged = await storage.extendStorageState(primary, additional);
  assert.equal(merged.cookies.length, 2);
  assert.equal(merged.cookies.find(c => c.name === "login").value, "primary");
  assert.deepEqual(await storage.extendStorageState(undefined, additional), { cookies: additional.cookies, origins: [] });
});

test("Firefox extension information must be registered for the same context", () => {
  const context = {}, other = {};
  assert.throws(() => firefoxInfo.getFirefoxContextInfo(context), /not initialized/);
  const info = { extensionId: "test", baseUrl: "moz-extension://test" };
  firefoxInfo.setFirefoxExtensionInfo(context, info);
  assert.deepEqual(firefoxInfo.getFirefoxContextInfo(context), info);
  assert.throws(() => firefoxInfo.getFirefoxContextInfo(other), /not initialized/);
});

function iconFixture(options) {
  const hooks = {}, calls = [], errors = [];
  globalThis.generateTestFonts = async options => {
    calls.push(options);
    return { writeResults: [] };
  };
  iconModule.setup({ config: { browser: "firefox" }, hook: (name, fn) => { hooks[name] = fn; }, logger: { error: (...args) => errors.push(args) } }, options);
  return { hooks, calls, errors };
}

test("omitted icon options use consistent generator and public-path defaults", async () => {
  const f = iconFixture({ inputDir: "icons" });
  const paths = [];
  await f.hooks["prepare:publicPaths"]({}, paths);
  await f.hooks["build:publicAssets"]({}, []);
  assert.deepEqual(paths, ["assets/icons.css", "assets/icons.eot", "assets/icons.woff2", "assets/icons.woff"]);
  assert.deepEqual(f.calls[0].fontTypes, []);
  assert.deepEqual(f.calls[0].assetTypes, ["ts"]);
  assert.deepEqual(f.calls[1].fontTypes, ["eot", "woff2", "woff"]);
  assert.deepEqual(f.calls[1].assetTypes, ["css", "html", "json", "ts"]);
  assert.deepEqual(f.errors, []);
});

test("explicit icon formats and empty lists are respected", async () => {
  for (const fontTypes of [["ttf", "woff2"], []]) {
    const f = iconFixture({ inputDir: "icons", name: "test", fontTypes, assetTypes: [] });
    const paths = [];
    await f.hooks["prepare:publicPaths"]({}, paths);
    assert.deepEqual(paths, fontTypes.map(type => `assets/test.${type}`));
    assert.equal(f.calls.length, 0);
    await f.hooks["build:publicAssets"]({}, []);
    assert.deepEqual(f.calls[0].fontTypes, fontTypes);
    assert.deepEqual(f.calls[0].assetTypes, []);
  }
  assert.deepEqual(iconFixture(undefined).hooks, {});
});
