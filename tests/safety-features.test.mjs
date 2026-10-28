import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function load(path) {
  const built = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
}
const { WriteStatus } = await load("../src/common/storage/writeStatus.ts");
const { diagnosticMapUrl, bounded } = await load("../src/common/diagnostics.ts");
const { SaveReaderV3 } = await load("../src/common/storage/saves/reader/v3.ts");

test("save indicator follows committed writes and serializes rapid changes", async () => {
  const status = new WriteStatus();
  const order = [];
  let finish;
  const first = status.run("marker", () => new Promise((resolve) => { finish = resolve; }));
  const second = status.run("marker", async () => { order.push("second"); });
  assert.equal(status.get().state, "saving");
  assert.equal(status.get().pending, 2);
  assert.equal(status.get().savedAt, null);
  await Promise.resolve();
  assert.deepEqual(order, []);
  finish();
  await first;
  await second;
  assert.deepEqual(order, ["second"]);
  assert.equal(status.get().state, "saved");
  assert.equal(status.get().pending, 0);
});

test("write failures are retained and redact private exception text", async () => {
  const status = new WriteStatus();
  await assert.rejects(status.run("note", async () => { throw new Error("private-note and token"); }));
  await status.run("marker", async () => {});
  const report = status.get();
  assert.equal(report.state, "failed");
  assert.equal(report.pending, 0);
  assert.equal(report.errors[0].code, "WriteError");
  assert.equal(JSON.stringify(report).includes("private-note"), false);
  report.errors.length = 0;
  assert.equal(status.get().errors.length, 1);
});

test("diagnostics retain only map path and numeric map override", () => {
  assert.equal(diagnosticMapUrl("https://mapgenie.io/game/maps/world?token=secret&fmgMapId=12#note-private"),
    "https://mapgenie.io/game/maps/world?fmgMapId=12");
  assert.equal(diagnosticMapUrl("https://mapgenie.io/game/maps/world?fmgMapId=private"), "https://mapgenie.io/game/maps/world");
  for (const raw of ["bad", "https://mapgenie.io/account?email=private", "moz-extension://id/page.html"]) {
    assert.equal(diagnosticMapUrl(raw), null);
  }
});

test("diagnostics timeout without hanging or leaking late rejections", async () => {
  await assert.rejects(bounded(new Promise(() => {}), 5), /Timed out/);
  assert.equal(await bounded(Promise.resolve(1)), 1);
});

test("JSON reader defaults only missing note descriptions, preserving strict fields", () => {
  const failures = [];
  const reader = new SaveReaderV3({ error: (_file, err) => failures.push(err) });
  const note = { id: "n", title: "Private note", color: null, latitude: 1, longitude: 2,
    category: null, user_id: 1, map_id: 2, created_at: "2026-10-29" };
  const make = (n) => ({ filename: "backup.json", content: { version: 3, userId: 1,
    createdAt: "2026-10-29", games: { 1: { locations: [1], trackedCategoryIds: [],
      presets: [], presetOrdering: [], notes: [n] } } } });
  const original = make(note);
  assert.equal(reader.parse(original).content.games[1].notes[0].description, "");
  assert.equal(original.content.games[1].notes[0].description, undefined);
  assert.equal(reader.parse(make({ ...note, description: "Keep this" })).content.games[1].notes[0].description, "Keep this");
  assert.equal(reader.parse(make({ ...note, description: 42 })), null);
  assert.equal(reader.parse(make({ ...note, map_id: "invalid" })), null);
  assert.equal(failures.length, 2);
});
