import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { firefox } from "playwright";

test("data manager and diagnostics UI on desktop and mobile", { timeout: 90000 }, async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const popupCss = await readFile(path.join(root, "src/contexts/popup/style.css"), "utf8");
  const mocks = `
    const games=[{id:1,title:'Cloudheim',slug:'cloudheim',maps:[]}];
    const points=[{id:'one',createdAt:'2026-10-29T12:00:00Z',reason:'clear-game',gameIds:[1],locations:543,notes:2}];
    const api={
      fetchGames:async()=>games, getRecoveryPoints:async()=>points,
      restoreRecoveryPoint:async()=>{globalThis.restored=true},
      import:async()=>{globalThis.imported=true},
      reloadMap:async()=>{globalThis.reloaded=true},
      getDiagnostics:async()=>{
        await new Promise(resolve=>setTimeout(resolve,globalThis.diagnosticDelay||0));
        globalThis.diagnosticsCompleted=(globalThis.diagnosticsCompleted||0)+1;
        return {mapUrl:'https://mapgenie.io/cloudheim/maps/world',state:'running'};
      },
      getExtensionEnabled:async()=>true, ping:async()=>true,
      getBookmarks:async()=>[], getProfiles:async()=>[],
      getInfo:async()=>({state:'running',map:'World',game:'Cloudheim',gameId:254,mapId:860}),
      getPageType:async()=>'map', isLoggedIn:async()=>true, getActiveProfile:async()=>({id:10}),
      createBookmark:async()=>({url:'https://mapgenie.io/cloudheim/maps/world',title:'Cloudheim',preview:'/preview.jpg',pageType:'map',createdAt:'2026-10-29'}),
      addBookmark:async(bookmark)=>bookmark,
      getSaveStatus:async()=>({state:'saved',pending:0,savedAt:'2026-10-29T12:00:00Z',errors:[]}),
      isStoragePersisted:async()=>false, storageEstimate:async()=>({usage:100,quota:100000}),
    }; export default {use:()=>api};
  `;
  const built = await build({ configFile: false, root, logLevel: "error",
    define: { 'import.meta.env.PKG_VERSION': JSON.stringify(pkg.version),
      'import.meta.env.PKG_AUTHOR': JSON.stringify(pkg.author),
      'import.meta.env.PKG_HOMEPAGE': JSON.stringify(pkg.homepage) },
    resolve: { alias: { "@": path.join(root, "src") } },
    css: { modules: { localsConvention: "camelCase" } },
    build: { write: false, minify: false, rollupOptions: { input: path.join(root, "tests/ui-safety-preview.tsx") } },
    plugins: [{ name: "ui-service-fixtures", enforce: "pre",
      resolveId(id) { if (/services\/[^/]+\.service$/.test(id)) return "\0fixture-service"; },
      load(id) { if (id === "\0fixture-service") return mocks; },
      transform(code, id) {
        if (id.endsWith(".tsx") && !/import\s+(?:\*\s+as\s+)?React\b/.test(code)) {
          return { code: 'import React from "react";\n' + code, map: null };
        }
      },
    }],
  });
  const output = built.output;
  const script = output.find((item) => item.type === "chunk" && item.isEntry);
  const css = output.filter((item) => item.type === "asset" && item.fileName.endsWith(".css"));
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (/^\/assets\/fmg-icons\.(css|woff2?|ttf)$/.test(pathname)) {
      res.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : "application/octet-stream");
      try { res.end(await readFile(path.join(root, ".output/firefox-mv3", pathname))); }
      catch { res.statusCode = 404; res.end(); }
      return;
    }
    const asset = output.find((item) => "/" + item.fileName === req.url);
    if (asset) {
      res.setHeader("Content-Type", asset.type === "chunk" ? "text/javascript" : "text/css");
      res.end(asset.type === "chunk" ? asset.code : asset.source);
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html><head><link rel="stylesheet" href="/assets/fmg-icons.css">${css.map((a) => `<link rel="stylesheet" href="/${a.fileName}">`).join("")}${pathname === '/popup' ? `<style>${popupCss}</style>` : ''}</head><body><div id="root"></div><script type="module" src="/${script.fileName}"></script></body></html>`);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await firefox.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error("UI error:", error.message); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route('https://api.github.com/**', route => route.fulfill({json:{tag_name:'v3.0.12'}}));
    await page.goto(origin);
    await page.getByRole("button", { name: "Recovery points", exact: true }).click();
    await page.getByText("543 locations").waitFor();
    assert.ok((await page.getByText("Before clearing game", { exact: true }).boundingBox()).width > 200);
    await mkdir(path.join(root, "research/safety-ui"), { recursive: true });
    await page.screenshot({ path: path.join(root, "research/safety-ui/desktop.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Restore", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByText("Recovery point restored.").waitFor();
    assert.equal(await page.evaluate(() => globalThis.restored), true);
    await page.getByRole("button", { name: "Reload map", exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.reloaded), true);
    await page.getByRole("button", { name: "JSON files", exact: true }).click();
    const backup = { version: 3, userId: 10, createdAt: "2026-10-29", games: {
      1: { locations: [1, 2], trackedCategoryIds: [], notes: [], presets: [], presetOrdering: [] },
    } };
    await page.locator('input[type="file"]').setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
    await page.getByText("backup.json", { exact: true }).click();
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.getByRole("button", { name: "Reload map", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => globalThis.imported), true);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Recovery points", exact: true }).click();
    await page.screenshot({ path: path.join(root, "research/safety-ui/mobile.png"), fullPage: true, animations: "disabled" });
    assert.ok((await page.getByRole("heading", { name: "Recovery points" }).boundingBox()).y >= 55);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.goto(origin + "/diagnostics");
    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await page.getByRole("textbox", { name: "Diagnostic report" }).waitFor();
    const report = JSON.parse(await page.getByRole("textbox").inputValue());
    assert.equal(report.version, "test");
    assert.equal(report.saves.state, "saved");
    await page.getByText("Saved locally").waitFor();
    await page.screenshot({ path: path.join(root, "research/safety-ui/diagnostics.png"), fullPage: true });
    await page.getByRole("button", { name: "Close diagnostics", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Diagnostic report" }).count(), 0);

    await page.setViewportSize({ width: 400, height: 600 });
    await page.goto(origin + "/popup");
    await page.getByText("connected", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Bookmark current page" }).click();
    await page.waitForFunction(() => popupStore.getState().bookmarks.list.length === 1);
    await page.getByRole("button", { name: "Bookmark current page" }).click();
    await page.waitForFunction(() => !popupStore.getState().bookmarks.adding);
    assert.equal(await page.evaluate(() => popupStore.getState().bookmarks.list.length), 1);
    const before = await page.locator("body").boundingBox();
    await page.getByTitle("page", { exact: true }).click();
    const infoHeight = (await page.locator("body").boundingBox()).height;
    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await page.getByRole("textbox", { name: "Diagnostic report" }).waitFor();
    assert.equal((await page.locator("body").boundingBox()).height, infoHeight);
    await page.screenshot({ path: path.join(root, "research/safety-ui/popup-diagnostics.png"), fullPage: true });
    for (const tab of ["bookmarks", "profiles", "data"]) {
      await page.getByTitle(tab, { exact: true }).click();
      assert.ok((await page.locator("body").boundingBox()).height <= before.height + 1, tab);
      assert.equal(await page.getByRole("textbox", { name: "Diagnostic report" }).isVisible(), false);
    }
    await page.getByTitle("page", { exact: true }).click();
    await page.getByRole("button", { name: "Close diagnostics" }).click();
    await page.getByText("World", { exact: true }).waitFor();
    assert.equal((await page.locator("body").boundingBox()).height, infoHeight);
    await page.evaluate(() => { globalThis.diagnosticDelay = 200; globalThis.diagnosticsCompleted = 0; });
    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await page.getByRole("button", { name: "Close diagnostics" }).click();
    await page.waitForFunction(() => globalThis.diagnosticsCompleted === 1);
    assert.equal(await page.getByRole("textbox", { name: "Diagnostic report" }).count(), 0);
    await page.getByText("World", { exact: true }).waitFor();
    await page.evaluate(() => { document.documentElement.dataset.iframe = 'true'; });
    await page.setViewportSize({ width: 320, height: 600 });
    await page.getByRole("button", { name: "Diagnostics", exact: true }).click();
    await page.getByRole("textbox", { name: "Diagnostic report" }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight));
    await page.screenshot({ path: path.join(root, "research/safety-ui/popup-diagnostics-narrow.png"), fullPage: true });
    await page.getByRole("button", { name: "NR2BJ", exact: true }).click();
    assert.equal(await page.evaluate(() => globalThis.openedTab), "https://github.com/NR2BJ/free-map-genie");
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
