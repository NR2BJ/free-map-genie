import { AbstractRepository } from "./abstract";

import type { Key } from "../../../key";

export interface LocationModelV1 {
  game_id: number;
  user_id: number;
  id: number;
}

export class LocationsRepositoryV1 extends AbstractRepository<
  LocationModelV1,
  [number, number, number]
> {
  public readonly tableName = "locations_v2";
  public readonly index = "[game_id+user_id+id], [game_id+user_id], user_id";

  public async setFound(key: Key, id: number, found: boolean) {
    if (found) {
      await this.table.put({
        game_id: key.gameId,
        user_id: key.userId,
        id,
      });
    } else {
      await this.table.delete([key.gameId, key.userId, id]);
    }
  }

  public async has(key: Key) {
    return this.table
      .where({ game_id: key.gameId, user_id: key.userId })
      .count()
      .then((count) => count > 0);
  }

  public async set(key: Key, locations: number[]) {
    await this.dexie.transaction("rw", this.table, async () => {
      await this.clear(key);
      await this.table.bulkAdd(
        locations.map((id) => ({
          game_id: key.gameId,
          user_id: key.userId,
          id,
        }))
      );
    });
  }

  public async deleteIds(key: Key, ids: number[]) {
    await this.table.bulkDelete(
      ids.map((id) => [key.gameId, key.userId, id])
    );
  }

  public async clear(key: Key) {
    await this.table
      .where({ game_id: key.gameId, user_id: key.userId })
      .delete();
  }

  public async get(key: Key) {
    return this.table
      .where({ game_id: key.gameId, user_id: key.userId })
      .toArray()
      .then((locations) => locations.map((location) => location.id));
  }

  public async getChecklist(key: Key): Promise<Record<number, true>> {
    return this.table
      .where({ game_id: key.gameId, user_id: key.userId })
      .toArray()
      .then((locations) => locations.map((location) => [location.id, true]))
      .then(Object.fromEntries);
  }
}
