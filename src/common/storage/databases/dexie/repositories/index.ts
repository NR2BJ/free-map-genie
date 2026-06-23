import { Dexie, type Transaction } from "dexie";

import { LocationsRepositoryV1 } from "./locations";
import { CategoriesRepositoryV1 } from "./categories";
import { PresetsRepositoryV1 } from "./presets";
import { PresetsOrderingRepositoryV1 } from "./presetsOrdering";
import { NotesRepositoryV1 } from "./notes";
import { BookmarksRepositoryV1 } from "./bookmarks";
import { ProfilesRepositoryV1 } from "./profiles";

const legacyLocationsIndex = "[id+user_id], [game_id+user_id], user_id";
const legacyCategoriesIndex = "[id+user_id], [game_id+user_id], user_id";

export {
  LocationsRepositoryV1,
  CategoriesRepositoryV1,
  PresetsRepositoryV1,
  PresetsOrderingRepositoryV1,
  NotesRepositoryV1,
  BookmarksRepositoryV1,
  ProfilesRepositoryV1,
};

export type { LocationModelV1 } from "./locations";
export type { CategoryModelV1 } from "./categories";
export type { PresetModelV1 } from "./presets";
export type { PresetOrderModelV1 } from "./presetsOrdering";
export type { NoteModelV1 } from "./notes";
export type { BookmarkModelV1 } from "./bookmarks";
export type { ProfileModelV1 } from "./profiles";

export class Repositories {
  private readonly dexie: Dexie;

  public readonly locations: LocationsRepositoryV1;
  public readonly categories: CategoriesRepositoryV1;
  public readonly presets: PresetsRepositoryV1;
  public readonly presetsOrdering: PresetsOrderingRepositoryV1;
  public readonly notes: NotesRepositoryV1;
  public readonly bookmarks: BookmarksRepositoryV1;
  public readonly profiles: ProfilesRepositoryV1;

  public constructor(dexie: Dexie) {
    this.dexie = dexie;

    this.locations = new LocationsRepositoryV1(dexie);
    this.categories = new CategoriesRepositoryV1(dexie);
    this.presets = new PresetsRepositoryV1(dexie);
    this.presetsOrdering = new PresetsOrderingRepositoryV1(dexie);
    this.notes = new NotesRepositoryV1(dexie);
    this.bookmarks = new BookmarksRepositoryV1(dexie);
    this.profiles = new ProfilesRepositoryV1(dexie);

    this.prepareStores();
  }

  private prepareStores() {
    this.dexie.version(1).stores({
      locations: legacyLocationsIndex,
      categories: legacyCategoriesIndex,
      presets: this.presets.index,
      presetsOrdering: this.presetsOrdering.index,
      notes: this.notes.index,
      bookmarks: this.bookmarks.index,
      profiles: this.profiles.index,
    });

    this.dexie
      .version(2)
      .stores({
        locations: legacyLocationsIndex,
        categories: legacyCategoriesIndex,
        locations_v2: this.locations.index,
        categories_v2: this.categories.index,
        presets: this.presets.index,
        presetsOrdering: this.presetsOrdering.index,
        notes: this.notes.index,
        bookmarks: this.bookmarks.index,
        profiles: this.profiles.index,
      })
      .upgrade(async (tx) => {
        await this.copyLegacyStore(tx, "locations", this.locations.tableName);
        await this.copyLegacyStore(tx, "categories", this.categories.tableName);
      });
  }

  private async copyLegacyStore(
    tx: Transaction,
    from: string,
    to: string
  ) {
    const target = tx.table(to);
    if ((await target.count()) > 0) return;

    const records = await tx.table(from).toArray();
    if (records.length > 0) {
      await target.bulkPut(records);
    }
  }
}
