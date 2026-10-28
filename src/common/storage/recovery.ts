import Dexie, { type Table } from "dexie";
import { UserDataSchema, type UserData } from "./format";

export type RecoveryReason = "import" | "account-import" | "clear-map" | "clear-game" | "restore";
export interface RecoverySnapshot {
  id: string;
  userId: number;
  createdAt: string;
  reason: RecoveryReason;
  games: Record<number, UserData>;
}

export class RecoveryStore {
  private readonly db: Dexie;
  private readonly snapshots: Table<RecoverySnapshot, string>;

  public constructor(name = "fmg:recovery") {
    this.db = new Dexie(name);
    this.db.version(1).stores({ snapshots: "id, userId, createdAt" });
    this.snapshots = this.db.table("snapshots");
  }

  public async create(userId: number, games: Record<number, UserData>, reason: RecoveryReason, keepId?: string) {
    const snapshot: RecoverySnapshot = {
      id: crypto.randomUUID(), userId, createdAt: new Date().toISOString(), reason,
      games: structuredClone(games),
    };
    await this.db.transaction("rw", this.snapshots, async () => {
      const previous = await this.snapshots.where({ userId }).sortBy("createdAt");
      const lastTime = previous.length ? Date.parse(previous[previous.length - 1].createdAt) : 0;
      snapshot.createdAt = new Date(Math.max(Date.now(), lastTime + 1)).toISOString();
      await this.snapshots.put(snapshot);
      await this.snapshots.bulkDelete(previous.filter((item) => item.id !== keepId)
        .slice(0, Math.max(0, previous.length - 4)).map((item) => item.id));
    });
    return snapshot.id;
  }

  public async list(userId: number) {
    const snapshots = await this.snapshots.where({ userId }).sortBy("createdAt");
    return snapshots.reverse().map(({ id, createdAt, reason, games }) => ({
      id, createdAt, reason, gameIds: Object.keys(games).map(Number),
      locations: Object.values(games).reduce((sum, game) => sum + Object.keys(game.locations).length, 0),
      notes: Object.values(games).reduce((sum, game) => sum + game.notes.length, 0),
    }));
  }

  public async get(id: string, userId: number) {
    const snapshot = await this.snapshots.get(id);
    if (!snapshot || snapshot.userId !== userId) throw new Error("Recovery point not found for this profile");
    const games = Object.fromEntries(Object.entries(snapshot.games).map(([gameId, data]) => {
      if (!/^\d+$/.test(gameId)) throw new Error("Invalid recovery game ID");
      return [gameId, UserDataSchema.parse(data)];
    }));
    return games as Record<number, UserData>;
  }

  public close() { this.db.close(); }
}

export type RecoveryEntry = Awaited<ReturnType<RecoveryStore["list"]>>[number];
