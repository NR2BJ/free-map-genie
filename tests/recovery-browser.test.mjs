import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { firefox } from "playwright";

test("Firefox IndexedDB: destructive operations and recovery round trip", { timeout: 60000 }, async (t) => {
  const mocks = {
    "@/common/messaging": "export const createService = ({context}) => context;",
    "@/common/mapgenie": "export const getAuthToken=()=>null; export const setAuthToken=()=>{};",
    "@/common/storage/migrator": "export class Migrator {}",
    "./mapgenie.service": "export default {use:()=>({})};",
  };
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL("../src/services/backend.service.ts", import.meta.url))],
    bundle: true, write: false, platform: "browser", format: "iife", globalName: "TestBackend",
    define: { "import.meta.env.SERVICE_TIMEOUT": "1000" },
    plugins: [{ name: "service-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, (a) => a.path in mocks ? { path: a.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "js" }));
    } }],
  });
  const server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end("<!doctype html><title>FMG isolated recovery test</title>"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await firefox.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ content: "globalThis.logger={debug(){},warn(){},error(){}};" + bundle.outputFiles[0].text });
    await page.evaluate(async () => {
      globalThis.backend = new TestBackend.default();
      await backend.database.profiles.addUser(10, "Test user");
      await backend.database.profiles.setActive(10);
      globalThis.key = { userId: 10, gameId: 1 };
      globalThis.seed = { locations: { 11: true, 12: true }, trackedCategoryIds: [7],
        notes: [{ id: "original", title: "Remember", description: "Full text", color: null,
          latitude: 1, longitude: 2, category: null, user_id: 10, map_id: 3, created_at: "2026-10-29" }],
        presets: [{ id: 8, title: "Custom", categories: [7] }], presetOrdering: [8] };
      await backend.database.setData(key, seed);
    });
    await t.test("adding the same bookmark twice updates one persistent bookmark", async () => {
      const result = await page.evaluate(async () => {
        const bookmark = { title: "Cloudheim", url: "https://mapgenie.io/cloudheim/maps/world",
          pageType: "map", preview: "https://example.test/preview.jpg" };
        await backend.addBookmark(bookmark);
        const saved = await backend.addBookmark({ ...bookmark, title: "Cloudheim | World" });
        const other = new TestBackend.default();
        return { saved, bookmarks: await other.getBookmarks(), data: await backend.getData(key) };
      });
      assert.equal(result.bookmarks.length, 1);
      assert.deepEqual(result.bookmarks[0], result.saved);
      assert.equal(result.saved.title, "Cloudheim | World");
      assert.equal(typeof result.saved.createdAt, "string");
      assert.deepEqual(result.data.locations, { 11: true, 12: true });
    });
    await t.test("clear-game backs up and restore recovers markers, notes and preset order", async () => {
      const result = await page.evaluate(async () => {
        await backend.removeData(key);
        const empty = await backend.getData(key);
        const point = (await backend.getRecoveryPoints())[0];
        await backend.restoreRecoveryPoint(point.id);
        const restored = await backend.getData(key);
        return { empty, point, restored, status: backend.getSaveStatus() };
      });
      assert.deepEqual(result.empty.locations, {});
      assert.equal(result.point.reason, "clear-game");
      assert.deepEqual(result.restored.locations, { 11: true, 12: true });
      assert.equal(result.restored.notes[0].description, "Full text");
      assert.equal(result.restored.presets[0].title, "Custom");
      assert.equal(result.restored.presetOrdering[0], result.restored.presets[0].id);
      assert.equal(result.status.state, "saved");
    });
    await t.test("clear-map only removes its selected markers and creates a recovery point", async () => {
      const result = await page.evaluate(async () => {
        await backend.deleteLocations(key, [11]);
        return { data: await backend.getData(key), points: await backend.getRecoveryPoints() };
      });
      assert.deepEqual(result.data.locations, { 12: true });
      assert.equal(result.points[0].reason, "clear-map");
      assert.equal(result.data.notes.length, 1);
    });
    await t.test("failed recovery write prevents data deletion", async () => {
      const result = await page.evaluate(async () => {
        const original = backend.recovery.create.bind(backend.recovery);
        backend.recovery.create = async () => { throw new DOMException("No space", "QuotaExceededError"); };
        let failed = false;
        try { await backend.removeData(key); } catch { failed = true; }
        backend.recovery.create = original;
        return { failed, data: await backend.getData(key), status: backend.getSaveStatus() };
      });
      assert.equal(result.failed, true);
      assert.deepEqual(result.data.locations, { 12: true });
      assert.equal(result.status.errors.at(-1).code, "QuotaExceededError");
    });
    await t.test("JSON import backs up affected games only and can restore an empty game", async () => {
      const result = await page.evaluate(async () => {
        await backend.import({ 2: { ...seed, notes: [], presets: [], presetOrdering: [] } });
        const points = await backend.getRecoveryPoints();
        const point = points.find((p) => p.reason === "import");
        const imported = await backend.getData({ ...key, gameId: 2 });
        await backend.restoreRecoveryPoint(point.id);
        return { point, imported, restored: await backend.getData({ ...key, gameId: 2 }), unaffected: await backend.getData(key) };
      });
      assert.deepEqual(result.point.gameIds, [2]);
      assert.equal(result.point.locations, 0);
      assert.equal(Object.keys(result.imported.locations).length, 2);
      assert.deepEqual(result.restored.locations, {});
      assert.deepEqual(result.unaffected.locations, { 12: true });
    });
    await t.test("recovery is persistent, isolated by profile and bounded to five points", async () => {
      const result = await page.evaluate(async () => {
        for (let i = 0; i < 7; i++) await backend.removeData({ ...key, gameId: 100 + i });
        const points = await backend.getRecoveryPoints();
        await backend.database.profiles.addGuest();
        await backend.database.profiles.setActive(-1);
        let denied = false;
        try { await backend.restoreRecoveryPoint(points[0].id); } catch { denied = true; }
        const guestPoints = await backend.getRecoveryPoints();
        await backend.database.profiles.setActive(10);
        const other = new TestBackend.default();
        return { points, guestPoints, denied, reopened: await other.getRecoveryPoints() };
      });
      assert.equal(result.points.length, 5);
      assert.equal(result.guestPoints.length, 0);
      assert.equal(result.denied, true);
      assert.deepEqual(result.reopened, result.points);
    });
    await t.test("failed restore cannot evict its source recovery point", async () => {
      const result = await page.evaluate(async () => {
        const before = await backend.getRecoveryPoints();
        const oldest = before[before.length - 1];
        const original = backend.database.import.bind(backend.database);
        backend.database.import = async () => { throw new Error("Write failed"); };
        let failed = false;
        try { await backend.restoreRecoveryPoint(oldest.id); } catch { failed = true; }
        backend.database.import = original;
        const after = await backend.getRecoveryPoints();
        return { failed, retained: after.some((point) => point.id === oldest.id), count: after.length };
      });
      assert.equal(result.failed, true);
      assert.equal(result.retained, true);
      assert.equal(result.count, 5);
    });
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
