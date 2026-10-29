import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { firefox } from "playwright";

test("guide restoration updates the visible row state as well as the checkbox", { timeout: 30000 }, async (t) => {
  const mocks = {
    "@/common/client": "export class Client {}",
    "@/common/mapgenie": "export const activateBlockedMapgenieScript = async () => true;",
  };
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("..", import.meta.url)), contents: `
      import $ from 'jquery';
      import {GuidePage} from './src/contexts/page/pages/guide/index.ts';
      Object.assign(globalThis, {$, TestGuide: GuidePage});
    ` },
    bundle: true, write: false, platform: "browser", format: "iife",
    plugins: [{ name: "service-boundaries", setup(b) {
      b.onResolve({ filter: /.*/ }, a => a.path in mocks ? { path: a.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({ contents: mocks[a.path], loader: "js" }));
    } }],
  });
  const browser = await firefox.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><title>FMG guide restoration fixture</title>
      <table><tbody>
        <tr id="plain"><td><input class="check" type="checkbox" data-location-id="101"></td></tr>
        <tr id="legacy" class="checklist-item"><td><input class="check" type="checkbox" data-location-id="101"></td></tr>
        <tr id="stale" class="found"><td data-sort="x"><input class="check" type="checkbox" data-location-id="102" checked></td></tr>
      </tbody></table>
      <div id="card" class="guide-item"><label><input class="check" type="checkbox" data-location-id="101"></label></div>`);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      globalThis.logger = { warn() {}, log() {} };
      globalThis.state = { foundLocations: { 101: true } };
      window.foundLocations = state.foundLocations;
      window.updateFoundLocationsCount = () => {};
      window.guide = new TestGuide();
      window.changeEvents = 0;
      document.addEventListener("change", () => changeEvents++);
    });
    const read = () => page.evaluate(() => Object.fromEntries(
      ["plain", "legacy", "stale", "card"].map(id => {
        const row = document.getElementById(id);
        const checkbox = row.querySelector(".check");
        return [id, { checked: checkbox.checked, found: row.classList.contains("found"), sort: checkbox.parentElement.getAttribute("data-sort") }];
      })
    ));
    await t.test("saved records restore plain rows, legacy rows, cards and sorting without firing saves", async () => {
      await page.evaluate(() => guide.fixCheckboxes());
      const restored = await read();
      assert.deepEqual(restored.plain, { checked: true, found: true, sort: "x" });
      assert.deepEqual(restored.legacy, restored.plain);
      assert.deepEqual(restored.card, restored.plain);
      assert.deepEqual(restored.stale, { checked: false, found: false, sort: "y" });
      assert.equal(await page.evaluate(() => changeEvents), 0);
    });
    await t.test("map-to-guide updates keep every duplicate row and card visually synchronized", async () => {
      await page.evaluate(() => guide.state.markLocationFound(101, false));
      const unmarked = await read();
      for (const id of ["plain", "legacy", "card"]) {
        assert.deepEqual(unmarked[id], { checked: false, found: false, sort: "y" });
      }
      await page.evaluate(() => guide.state.markLocationFound(101, true));
      const marked = await read();
      for (const id of ["plain", "legacy", "card"]) {
        assert.deepEqual(marked[id], { checked: true, found: true, sort: "x" });
      }
      assert.equal(await page.evaluate(() => changeEvents), 0);
    });
  } finally {
    await browser.close();
  }
});
