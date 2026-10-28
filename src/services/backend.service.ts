import { nanoid } from "nanoid";
import { DexieDatabase } from "@/common/storage/databases";
import { Migrator } from "@/common/storage/migrator";
import { createService, type ProxiedObject } from "@/common/messaging";
import { getAuthToken, setAuthToken } from "@/common/mapgenie";

import mapgenieService from "./mapgenie.service";

import type { Key, UserData } from "@/common/storage";
import type { Bookmark } from "@/common/bookmark";
import type { PageAccount } from "@/common/mapgenie/account";
import { RecoveryStore, type RecoveryReason } from "@/common/storage/recovery";
import { WriteStatus } from "@/common/storage/writeStatus";
import { UserDataSchema } from "@/common/storage/format";

class BackendService {
  private accountLoggedIn?: boolean;
  private readonly writes = new WriteStatus();
  private readonly recovery = new RecoveryStore();
  private readonly migrator = new Migrator();
  private readonly database = new DexieDatabase();

  private readonly mapgenie = mapgenieService.use();

  public getAuthToken() {
    return getAuthToken();
  }

  public setAuthToken(token: string | null) {
    setAuthToken(token);
  }

  public async isLoggedIn() {
    if (this.accountLoggedIn !== undefined) return this.accountLoggedIn;
    if (this.getAuthToken()) return true;
    return (await this.database.profiles.getUser()) !== null;
  }

  public storageEstimate() {
    return navigator.storage.estimate();
  }

  public isStoragePersisted() {
    return navigator.storage.persisted();
  }

  public async storageRequestPersist() {
    const permission = await navigator.permissions.query({
      name: "persistent-storage",
    });

    if (permission.state === "granted") {
      return navigator.storage.persist();
    } else {
      logger.debug("Persistent storage permission not granted.", {
        state: permission.state,
      });
      return false;
    }
  }

  public async migrate(domain: string, key: Key) {
    await this.migrator.migrate(domain, key);
  }

  public async updateUser(pageUser?: PageAccount | null) {
    if (pageUser !== undefined) {
      if (pageUser) {
        if (!Number.isSafeInteger(pageUser.id) || pageUser.id < 0) {
          throw new Error("Invalid MapGenie account ID");
        }
        const existing = await this.database.profiles.getUser();
        const name = pageUser.name?.trim() ||
          (existing?.id === pageUser.id ? existing.name : "MapGenie account");
        await this.database.profiles.replaceUser(pageUser.id, name);
      }
      this.accountLoggedIn = pageUser !== null;
      // Missing credentials or logout must not remove local save profiles.
      return;
    }
    if (!this.getAuthToken()) {
      return;
    }

    const userData = await this.mapgenie.fetchUser(1);

    await this.database.profiles.replaceUser(userData.id, userData.username);
    this.accountLoggedIn = true;
  }

  public async importFromMapgenieAccount(key: Key) {
    if (!(await this.isLoggedIn())) {
      throw new Error("User is not logged in");
    }

    const user = await this.mapgenie.fetchUser(key.gameId);
    await this.writes.run("account-import", async () => {
      await this.backup(key.userId, [key.gameId], "account-import");
      await this.database.importMapgenie(key, user);
    });
  }

  public async importAccountData(key: Key, data: UserData) {
    const validated = UserDataSchema.parse(data);
    await this.writes.run("account-import", async () => {
      await this.backup(key.userId, [key.gameId], "account-import");
      await this.database.setData(key, validated);
    });
  }

  public async updateAccountName(id: number, name: string) {
    const existing = await this.database.profiles.getUser();
    // A slow name lookup from another tab must not switch the current account.
    if (existing?.id === id && name.trim()) {
      await this.database.profiles.replaceUser(id, name.trim());
    }
  }

  public async import(games: Record<number, UserData>) {
    const user = await this.database.profiles.getActive();
    if (user === null) {
      throw new Error("No active user profile found");
    }

    const validated = Object.fromEntries(Object.entries(games).map(([id, data]) => {
      if (!/^\d+$/.test(id)) throw new Error("Invalid game ID");
      return [id, UserDataSchema.parse(data)];
    }));
    if (!Object.keys(validated).length) throw new Error("No games selected");
    return this.writes.run("import", async () => {
      await this.backup(user.id, Object.keys(validated).map(Number), "import");
      await this.database.import(user.id, validated);
    });
  }

  private async backup(userId: number, gameIds: number[], reason: RecoveryReason, keepId?: string) {
    const games = await this.database.snapshot(userId, gameIds);
    await this.recovery.create(userId, games, reason, keepId);
  }

  public getSaveStatus() { return this.writes.get(); }

  public async getRecoveryPoints() {
    const user = await this.database.profiles.getActive();
    if (!user) throw new Error("No active user profile found");
    return this.recovery.list(user.id);
  }

  public async restoreRecoveryPoint(id: string) {
    const user = await this.database.profiles.getActive();
    if (!user) throw new Error("No active user profile found");
    return this.writes.run("restore", async () => {
      const games = await this.recovery.get(id, user.id);
      await this.backup(user.id, Object.keys(games).map(Number), "restore", id);
      await this.database.import(user.id, games);
    });
  }

  public async export(userId: number, gameId?: number) {
    const games = await this.database.export(userId, gameId);

    return { userId, games };
  }

  public async exportActiveUser(gameId?: number) {
    const user = await this.database.profiles.getActive();
    if (user === null) {
      throw new Error("No active user profile found");
    }
    return this.export(user.id, gameId);
  }

  public async getData(key: Key) {
    return this.database.getData(key);
  }

  public async removeData(key: Key) {
    await this.writes.run("clear-game", async () => {
      await this.backup(key.userId, [key.gameId], "clear-game");
      await this.database.removeData(key);
    });
  }

  public async markLocationFound(key: Key, locationId: number, found: boolean) {
    await this.writes.run("marker", () => this.database.locations.setFound(key, locationId, found));
  }

  public async deleteLocations(key: Key, locationIds: number[]) {
    await this.writes.run("clear-map", async () => {
      await this.backup(key.userId, [key.gameId], "clear-map");
      await this.database.locations.deleteIds(key, locationIds);
    });
  }

  public async trackCategory(key: Key, categoryId: number, track: boolean) {
    await this.writes.run("category", () => this.database.categories.setTracked(key, categoryId, track));
  }

  public async addNote(key: Key, note: Omit<MG.Note, "id" | "created_at">) {
    const created_at = new Date().toISOString();
    const id = await this.writes.run("note", () => this.database.notes.add(key, { ...note, created_at }));
    const user_id = key.userId;
    return { ...note, user_id, created_at, id };
  }

  public async updateNote(id: string, updates: Partial<MG.Note>) {
    return this.writes.run("note", () => this.database.notes.update(id, updates));
  }

  public async deleteNote(noteId: string) {
    return this.writes.run("note", () => this.database.notes.delete(noteId));
  }

  public async addPreset(
    key: Key,
    preset: Omit<MG.Preset, "id" | "order">,
    ordering: number[]
  ) {
    return this.writes.run("preset", () => this.database.transaction(
      "rw",
      this.database.presets.table,
      this.database.presetsOrdering.table,
      async () => {
        const order = ordering.length;
        const id = await this.database.presets.add(key, preset);

        await this.database.presetsOrdering.set(key, [...ordering, id]);

        return { ...preset, order, id };
      }
    ));
  }

  public async deletePreset(presetId: number) {
    await this.writes.run("preset", () => this.database.transaction("rw",
      this.database.presets.table, this.database.presetsOrdering.table, async () => {
        await this.database.presets.delete(presetId);
        await this.database.presetsOrdering.delete(presetId);
      }));
  }

  public async reorderPresets(key: Key, ordering: number[]) {
    await this.writes.run("preset", () => this.database.presetsOrdering.set(key, ordering));
  }

  public async getBookmarks() {
    return this.database.bookmarks.get();
  }

  public async addBookmark(bookmark: Omit<Bookmark, "createdAt">) {
    const createdAt = new Date().toISOString();
    const saved = { ...bookmark, createdAt };
    await this.database.bookmarks.add(saved);
    return saved;
  }

  public async deleteBookmark(url: string) {
    await this.database.bookmarks.delete(url);
  }

  public async getActiveProfile() {
    return this.database.profiles.getActive();
  }

  public async getProfiles() {
    return this.database.profiles.get();
  }

  public async addGuestProfile() {
    return this.database.profiles.addGuest();
  }

  public async deleteGuestProfile() {
    await this.database.profiles.deleteGuest();
    return this.database.profiles.get();
  }

  public async setActiveProfile(id: number) {
    await this.database.profiles.setActive(id);
  }
}

const backendService = createService({
  context: BackendService,
  namespace: "BackendService",
  heartbeatTimeout: import.meta.env.SERVICE_TIMEOUT,
});

namespace backendService {
  export type Instance = ProxiedObject<BackendService>;
}

export default backendService;
