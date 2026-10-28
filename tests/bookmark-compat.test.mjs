import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const mocks = {
  "@/common/messaging": "export const createService = ({context}) => context;",
  "@/common/mapgenie": "export const getPageType = async () => 'map';",
};
const result = await build({
  entryPoints: [fileURLToPath(new URL("../src/services/page.service.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node",
  define: { "import.meta.env.SERVICE_TIMEOUT": "1000" },
  plugins: [{ name: "service-boundaries", setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => a.path in mocks ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a) => ({ contents: mocks[a.path], loader: "js" }));
  } }],
});
const { PageService } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);

function fixture() {
  const meta = {
    "meta[property='og:url']": { content: "https://mapgenie.io/cloudheim/maps/world" },
    "meta[property='og:title']": { content: "Cloudheim Map | MapGenie" },
    "meta[property='og:image']": { content: "https://media.mapgenie.io/v2/assets/prod/games/cloudheim/preview.jpg" },
  };
  globalThis.document = { title: "Cloudheim Map", head: { querySelector: (selector) => meta[selector] } };
  // Current pages have map/mapConfig but no maps list. The icon is optional.
  globalThis.window = { location: new URL(meta["meta[property='og:url']"].content),
    mapData: { map: { id: 860, title: "World", slug: "world" } },
    game: { id: 254, title: "Cloudheim", slug: "cloudheim" },
  };
  globalThis.logger = { error() {} };
  return { meta, service: new PageService({ failed: false, page: {} }) };
}

test("bookmark creation accepts current map data without a maps list or icon", async () => {
  const { service } = fixture();
  const bookmark = await service.createBookmark();
  assert.equal(bookmark.title, "Cloudheim | World");
  assert.equal(bookmark.url, "https://mapgenie.io/cloudheim/maps/world");
  assert.equal(bookmark.preview, "https://media.mapgenie.io/v2/assets/prod/games/cloudheim/preview.jpg");
  assert.equal(bookmark.icon, undefined);
  assert.equal(bookmark.pageType, "map");
  assert.equal(new Date(bookmark.createdAt).toISOString(), bookmark.createdAt);
});

test("legacy multi-map bookmark previews retain their fallback", async () => {
  const { service } = fixture();
  window.mapData.maps = [{ id: 1 }, { id: 860 }];
  const bookmark = await service.createBookmark();
  assert.equal(bookmark.preview.url, "https://cdn.mapgenie.io/images/games/cloudheim/maps/world.jpg");
  assert.match(bookmark.preview.fallback, /media\.mapgenie\.io/);
});

test("bookmarks retain fmgMapId without corrupting an existing query", async () => {
  const { service, meta } = fixture();
  window.location = new URL("https://mapgenie.io/cloudheim/maps/world?fmgMapId=860");
  meta["meta[property='og:url']"].content += "?mini=true&fmgMapId=1";
  const url = new URL((await service.createBookmark()).url);
  assert.equal(url.searchParams.get("mini"), "true");
  assert.deepEqual(url.searchParams.getAll("fmgMapId"), ["860"]);
});

test("bookmarks fall back to the actual page URL and title when metadata is absent", async () => {
  const { service, meta } = fixture();
  delete meta["meta[property='og:url']"];
  delete meta["meta[property='og:title']"];
  delete window.mapData;
  const bookmark = await service.createBookmark();
  assert.equal(bookmark.url, window.location.href);
  assert.equal(bookmark.title, document.title);
});

test("missing required bookmark metadata produces a useful error", async () => {
  const { service, meta } = fixture();
  delete meta["meta[property='og:image']"];
  await assert.rejects(service.createBookmark(), /missing: preview/);
});

test("bookmarks do not silently save the wrong map while it is loading", async () => {
  const { service } = fixture();
  window.location = new URL("https://mapgenie.io/cloudheim/maps/world?fmgMapId=999");
  await assert.rejects(service.createBookmark(), /Map ID mismatch/);
  delete window.mapData;
  await assert.rejects(service.createBookmark(), /Map data is not ready/);
});
