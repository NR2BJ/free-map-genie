import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function load(path, mocks = {}) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm",
    define: { "import.meta.env.SERVICE_TIMEOUT": "1000" },
    plugins: [{ name: "boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => a.path in mocks
        ? { path: a.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "js" }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

const { getPageAccount, waitForPageAccount } = await load("../src/common/mapgenie/account.ts");
const { fetchAccountData } = await load("../src/common/mapgenie/accountImport.ts");
const { default: Backend } = await load("../src/services/backend.service.ts", {
  nanoid: "export const nanoid = () => 'id';",
  "@/common/storage/databases": "export class DexieDatabase { constructor() { return globalThis.db; } }",
  "@/common/storage/migrator": "export class Migrator {}",
  "@/common/messaging": "export const createService = ({context}) => context;",
  "@/common/mapgenie": "export const getAuthToken = () => globalThis.token; export const setAuthToken = (v) => globalThis.token = v;",
  "./mapgenie.service": "export default {use: () => globalThis.api};",
});

function fixture(initialUser = { id: 42, name: "Existing account" }) {
  const writes = [];
  let user = initialUser;
  globalThis.token = null;
  globalThis.db = { profiles: {
    getUser: async () => user,
    replaceUser: async (id, name) => { user = { id, name }; writes.push(user); },
    deleteUser: async () => { throw new Error("Must not delete profiles"); },
  }, setData: async (...args) => writes.push(args) };
  globalThis.api = { fetchUser: async () => ({ id: 42, username: "Legacy account" }) };
  return { backend: new Backend(), writes, user: () => user };
}

test("page identity uses realId, never the selected guest profile", () => {
  assert.equal(getPageAccount({ id: -1, realId: 42 }).id, 42);
  for (const id of [-1, NaN, Infinity, 1.2, "42"]) {
    assert.equal(getPageAccount({ id }), undefined);
  }
  assert.equal(getPageAccount(null), null);
  assert.equal(getPageAccount(undefined), undefined);
});

test("page identity waits for delayed page initialization", async () => {
  globalThis.window = {};
  setTimeout(() => { window.user = { id: 42 }; }, 5);
  assert.equal((await waitForPageAccount(500)).id, 42);
});

test("missing token preserves the stored profile", async () => {
  const f = fixture();
  await f.backend.updateUser();
  assert.equal(f.writes.length, 0);
  assert.equal(await f.backend.isLoggedIn(), true);
});

test("tokenless page identity restores profile and preserves account name", async () => {
  const f = fixture();
  await f.backend.updateUser({ id: 42 });
  assert.deepEqual(f.user(), { id: 42, name: "Existing account" });
  await f.backend.updateUser({ id: 43 });
  assert.deepEqual(f.user(), { id: 43, name: "MapGenie account" });
  assert.equal(await f.backend.isLoggedIn(), true);
});

test("explicit logout disables account import but preserves local profiles", async () => {
  const f = fixture();
  await f.backend.updateUser(null);
  assert.equal(await f.backend.isLoggedIn(), false);
  assert.equal(f.user().id, 42);
  assert.equal(f.writes.length, 0);
});

test("legacy token lookup still works", async () => {
  const f = fixture();
  globalThis.token = "legacy";
  await f.backend.updateUser();
  assert.equal(f.user().name, "Legacy account");
});

test("first-time or previously deleted account profile is recreated", async () => {
  const f = fixture(null);
  assert.equal(await f.backend.isLoggedIn(), false);
  await f.backend.updateUser({ id: 42 });
  assert.equal(f.user().id, 42);
  assert.equal(await f.backend.isLoggedIn(), true);
});

test("late account name response cannot switch accounts", async () => {
  const f = fixture();
  await f.backend.updateUser({ id: 43 });
  await f.backend.updateAccountName(42, "Old account");
  assert.equal(f.user().id, 43);
  await f.backend.updateAccountName(43, "New account");
  assert.equal(f.user().name, "New account");
});

const note = { id: "n1", title: "Note", color: null, latitude: 1, longitude: 2,
  category: null, user_id: 42, map_id: 1, created_at: "2026-10-29" };

test("session import aggregates maps and normalizes notes without duplicates", async () => {
  const requests = [];
  const axios = { get: async (url, options) => {
    requests.push([url, options]);
    return { data: requests.length === 1
      ? { locations: [1, 2], trackedCategoryIds: [7], notes: [note] }
      : { locations: { 2: true, 3: false, 4: true }, trackedCategoryIds: [7, 8], notes: [note] } };
  } };
  const data = await fetchAccountData(axios, [1, 2, 1]);
  assert.deepEqual(data.locations, { 1: true, 2: true, 4: true });
  assert.deepEqual(data.trackedCategoryIds, [7, 8]);
  assert.equal(data.notes.length, 1);
  assert.equal(data.notes[0].description, "");
  assert.equal(requests.length, 2);
  assert.equal(requests[1][1].headers["X-Map-ID"], "2");
  assert.equal(requests[1][1].timeout, 15000);
});

test("failed or malformed map response aborts import instead of returning partial data", async () => {
  for (const response of ["<html>Login</html>", {}, { locations: ["bad"] }]) {
    await assert.rejects(fetchAccountData({ get: async () => ({ data: response }) }, [1]));
  }
  await assert.rejects(fetchAccountData({ get: async (url) => {
    if (url.endsWith("/2")) throw new Error("Unauthorized");
    return { data: { locations: [1] } };
  } }, [1, 2]), /Unauthorized/);
  await assert.rejects(fetchAccountData({}, []), /No maps/);
});
