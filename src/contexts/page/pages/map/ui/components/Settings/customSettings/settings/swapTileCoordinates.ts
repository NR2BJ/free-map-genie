import { CustomSetting, type StorageEntry } from "../customSetting";

export class SwapTileCoordinatesSetting extends CustomSetting {
  public readonly label = "Swap Map Tile X/Y";

  private setting?: StorageEntry<boolean>;

  public get enabled() {
    return this.setting?.value === true;
  }

  public get applicable(): boolean {
    return new URLSearchParams(window.location.search).has("fmgMapId");
  }

  public async init() {
    const gameId = await this.waitForGameId();
    const fmgMapId = new URLSearchParams(window.location.search).get(
      "fmgMapId"
    );
    const mapId = Number(fmgMapId ?? window.mapData!.map.id);

    this.setting = this.StorageEntry.get<boolean>(
      ["game", gameId],
      ["map", mapId],
      "swap_tile_coordinates"
    );
  }

  public load() {}

  protected enable(): void {
    if (!this.setting) return;

    this.setting.value = true;
    window.location.reload();
  }

  protected disable(): void {
    if (!this.setting) return;

    this.setting.value = null;
    window.location.reload();
  }
}
