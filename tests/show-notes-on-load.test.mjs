import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  entryPoints: [fileURLToPath(new URL(
    "../src/contexts/page/pages/map/ui/components/Settings/customSettings/settings/showNotesOnLoad.ts",
    import.meta.url
  ))],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  target: "es2022",
});
const { ShowNotesOnLoadSetting } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

function fixture({ gameId = 42, saved = new Map(), shown = false, ready = true, loggedIn = true } = {}) {
  const actions = [];
  const listeners = new Map();
  const state = { user: { notesShown: shown, notes: [{ id: "note-1", description: "Keep me" }] } };
  const win = new EventTarget();
  const map = {
    loaded: () => ready,
    on: (event, listener) => { listeners.set(event, listener); },
  };
  Object.assign(win, {
    setTimeout, clearTimeout,
    game: { id: gameId },
    user: loggedIn ? { id: 1 } : null,
    mapManager: { map },
    store: {
      getState: () => state,
      dispatch(action) {
        actions.push(action);
        state.user.notesShown = action.meta.visible;
      },
    },
  });
  globalThis.window = win;
  globalThis.localStorage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  globalThis.logger = { warn() {} };
  const setting = new ShowNotesOnLoadSetting();
  const loaded = new Promise((resolve) => setting.onLoaded(resolve));
  return { setting, loaded, actions, state, saved, listeners };
}

test("new option is off by default and does not modify notes or settings", async () => {
  const f = fixture();
  await f.loaded;
  assert.equal(f.setting.failed, false);
  assert.equal(f.setting.enabled, false);
  assert.equal(f.state.user.notesShown, false);
  assert.equal(f.actions.length, 0);
  assert.equal(f.saved.size, 0);
  assert.deepEqual(f.state.user.notes, [{ id: "note-1", description: "Keep me" }]);
});

test("enabling shows notes once, and manual hiding remains respected", async () => {
  const f = fixture();
  await f.loaded;
  f.setting.onChange(true);
  assert.equal(f.setting.enabled, true);
  assert.deepEqual(f.actions, [{ type: "MG:USER:SHOW_NOTES", meta: { visible: true } }]);
  assert.equal(f.saved.get("mg:settings:game_42:show_notes_on_load"), "true");
  window.store.dispatch({ type: "MG:USER:SHOW_NOTES", meta: { visible: false } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.state.user.notesShown, false);
  assert.equal(f.actions.length, 2);
  assert.equal(f.setting.enabled, true);
});

test("preference applies after reload and is isolated by game", async () => {
  const saved = new Map([["mg:settings:game_42:show_notes_on_load", "true"]]);
  const sameGame = fixture({ saved });
  await sameGame.loaded;
  assert.equal(sameGame.state.user.notesShown, true);
  assert.equal(sameGame.actions.length, 1);
  const otherGame = fixture({ gameId: 43, saved });
  await otherGame.loaded;
  assert.equal(otherGame.setting.enabled, false);
  assert.equal(otherGame.actions.length, 0);
});

test("already visible notes are not toggled off or redispatched", async () => {
  const f = fixture({ shown: true, saved: new Map([["mg:settings:game_42:show_notes_on_load", "true"]]) });
  await f.loaded;
  assert.equal(f.actions.length, 0);
  assert.equal(f.state.user.notesShown, true);
});

test("disabling only removes the preference, and next load leaves notes alone", async () => {
  const f = fixture();
  await f.loaded;
  f.setting.onChange(true);
  f.setting.onChange(false);
  assert.equal(f.setting.enabled, false);
  assert.equal(f.state.user.notesShown, true);
  assert.equal(f.actions.length, 1);
  assert.equal(f.saved.size, 0);
  const reloaded = fixture({ saved: f.saved });
  await reloaded.loaded;
  assert.equal(reloaded.state.user.notesShown, false);
  assert.equal(reloaded.actions.length, 0);
});

test("enabled option waits for map readiness before dispatch", async () => {
  const f = fixture({ ready: false, saved: new Map([["mg:settings:game_42:show_notes_on_load", "true"]]) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.actions.length, 0);
  f.listeners.get("load")();
  await f.loaded;
  assert.equal(f.setting.failed, false);
  assert.equal(f.actions.length, 1);
});

test("logged-out maps do not dispatch note changes", async () => {
  const f = fixture({ loggedIn: false, saved: new Map([["mg:settings:game_42:show_notes_on_load", "true"]]) });
  await f.loaded;
  assert.equal(f.actions.length, 0);
});
