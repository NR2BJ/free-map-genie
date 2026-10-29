import { Page } from "../page";
import { UI } from "./ui";

import { Client } from "@/common/client";
import { activateBlockedMapgenieScript } from "@/common/mapgenie";
import { mapDataUtils } from "@/common/mapgenie";
import { waitForProperty } from "@/common/object";

import { fixMapLinks } from "@/common/mapgenie";
import { LazyGetter } from "lazy-get-decorator";
import { showMapLoadError } from "@/common/mapgenie/mapLoadError";
import { prepareMapDataResponseOverride } from "@/common/mapgenie/mapDataResponse";

export class MapPage extends Page {
  private client = new Client();
  private ui = new UI();

  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    message: string
  ) {
    let handle: number | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      handle = window.setTimeout(
        () => reject(new Error(`${message} timed out after ${timeout}ms.`)),
        timeout
      );
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (handle !== undefined) {
        window.clearTimeout(handle);
      }
    }
  }

  private async setupUser() {
    const user = window.user;
    if (!user) return;

    user.realId = user.id;
    window.isPro = true;
    user.hasPro = true;

    window.mapData!.maxMarkedLocations = Infinity;

    try {
      const activeUserId = await this.withTimeout(
        this.client.getActiveUserId(),
        5000,
        "Active FMG profile lookup"
      );

      user.id = activeUserId ?? user.id;
    } catch (err) {
      logger.warn("Could not load active FMG profile before map boot.", err);
    }
  }

  private getTrackedCategoryIdsForCurrentMap(categoryIds: number[]) {
    const categories = window.mapData?.categories ?? {};
    const availableCategoryIds = new Set(
      Object.keys(categories).map((id) => Number(id))
    );

    const filteredCategoryIds = categoryIds.filter((id) =>
      availableCategoryIds.has(id)
    );

    if (filteredCategoryIds.length !== categoryIds.length) {
      const ignoredCategoryIds = categoryIds.filter(
        (id) => !availableCategoryIds.has(id)
      );
      logger.warn(
        "Ignoring tracked categories that are not available on the current map.",
        ignoredCategoryIds
      );
    }

    return filteredCategoryIds;
  }

  private filterTrackedCategoriesForCurrentMap() {
    if (!window.user) return;

    window.user.trackedCategoryIds = this.getTrackedCategoryIdsForCurrentMap(
      window.user.trackedCategoryIds ?? []
    );
  }

  private async loadUserData() {
    await this.client.migrate();
    const data = await this.client.getData();

    const pageLocations = window.mapData!.locations ?? [];
    const locationsById = Object.fromEntries(
      pageLocations.map((loc) => [loc.id, loc])
    );

    const filteredLocations = Object.fromEntries(
      Object.keys(data.locations)
        .filter((id) => data.locations[Number(id)] && !!locationsById[id])
        .map((id) => [id, true])
    );

    const filteredNotes = data.notes.filter(
      (note) => note.map_id === window.mapData!.map.id
    );

    window.user!.locations = filteredLocations;
    window.user!.trackedCategoryIds = this.getTrackedCategoryIdsForCurrentMap(
      data.trackedCategoryIds
    );

    window.mapData!.notes = filteredNotes;
    window.mapData!.presets = data.presets;

    logger.log(
      `Loaded ${Object.keys(filteredLocations).length} saved FMG locations.`
    );
  }

  private getSavedLocationIdsForCurrentMap() {
    const savedLocationIds = Object.keys(window.user?.locations ?? {})
      .filter((id) => window.user!.locations[id])
      .map(Number);

    const mapState = window.store?.getState().map;
    const stateLocationIds = Object.keys(
      mapState?.locationsById ?? mapState?.locationById ?? {}
    ).map(Number);

    const currentMapLocationIds =
      stateLocationIds.length > 0
        ? stateLocationIds
        : (window.mapData?.locations ?? []).map((loc) => loc.id);

    if (currentMapLocationIds.length === 0) return [];

    const currentMapLocationIdsSet = new Set(currentMapLocationIds);
    return savedLocationIds.filter((id) => currentMapLocationIdsSet.has(id));
  }

  private async waitForMapObject(timeout = 5000) {
    await waitForProperty(window, "mapManager", timeout);

    const deadline = Date.now() + timeout;
    while (!window.mapManager?.map && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }

    return window.mapManager?.map ?? null;
  }

  private async waitForMapStyle(timeout = 30000) {
    const map = await this.waitForMapObject(timeout);
    if (!map) throw new Error("MapGenie map object is not ready.");

    if (typeof map.loaded === "function" && map.loaded()) {
      return;
    }

    if (typeof map.on !== "function") {
      return;
    }

    let onReady: () => void = () => {};
    const ready = new Promise<void>((resolve) => {
      onReady = resolve;
      map.on("load", onReady);
      map.on("idle", onReady);
    });
    try {
      await this.withTimeout(ready, timeout, "Waiting for MapGenie map style");
    } finally {
      map.off("load", onReady);
      map.off("idle", onReady);
    }
  }

  private async updateFoundLocationsStyle() {
    try {
      window.mapManager?.updateFoundLocationsStyle();
      return;
    } catch (err) {
      logger.warn(
        "Could not update found location style immediately; retrying after map load.",
        err
      );
    }

    try {
      await this.waitForMapStyle();
      window.mapManager?.updateFoundLocationsStyle();
    } catch (err) {
      logger.warn("Could not update found location style after retry.", err);
    }
  }

  private async syncSavedLocationsToMap() {
    try {
      await this.waitForMapStyle();
    } catch (err) {
      logger.warn("Could not restore saved marker styles before map load.", err);
      return;
    }

    const store = window.store;
    if (!store) return;

    const locationIds = this.getSavedLocationIdsForCurrentMap();
    if (locationIds.length === 0) return;

    const state = store.getState();
    const foundLocations = state.user.foundLocations ?? {};
    const missingLocationIds = locationIds.filter(
      (id) => !foundLocations[id]
    );

    if (missingLocationIds.length > 0) {
      store.dispatch({
        type: "MG:USER:MARK_LOCATIONS",
        meta: {
          locationIds: missingLocationIds,
          found: true,
        },
      } as any);
    }

    // Redux counters and MapLibre feature states are separate. Reapply every
    // saved marker visually, even when Redux already counted it during boot.
    try {
      for (const id of locationIds) {
        window.mapManager!.setLocationFound(id, true);
      }
      await this.updateFoundLocationsStyle();
    } catch (err) {
      logger.warn("Could not restore saved marker styles.", err);
    }

    logger.log(
      `Synced ${locationIds.length} saved FMG locations to the map` +
        ` (${missingLocationIds.length} newly marked).`
    );
  }

  private lockValue(obj: object, key: PropertyKey, value: unknown) {
    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: () => {},
    });
  }

  private lockProData() {
    if (window.user) {
      this.lockValue(window, "isPro", true);
      this.lockValue(window.user, "hasPro", true);
      this.lockValue(window.user, "locations", window.user.locations);
      this.lockValue(
        window.user,
        "trackedCategoryIds",
        window.user.trackedCategoryIds
      );
    }

    if (window.mapData) {
      this.lockValue(window.mapData, "maxMarkedLocations", Infinity);
      this.lockValue(window.mapData, "notes", window.mapData.notes);
      this.lockValue(window.mapData, "presets", window.mapData.presets);
    }
  }

  private async unlockMapLinks() {
    try {
      await fixMapLinks(this.client.mapgenie);
    } catch (err) {
      logger.error("Failed to unlock map links, loading map anyway.", err);
    }
  }

  @LazyGetter()
  private get fmgMapId() {
    const urlParams = new URLSearchParams(window.location.search);
    const value = urlParams.get("fmgMapId");
    if (value === null) return null;
    const mapId = Number(value);
    if (!Number.isSafeInteger(mapId) || mapId <= 0) {
      throw new Error("Invalid requested map ID.");
    }
    return mapId;
  }

  private async loadMapDataForMapId(mapId: number) {
    const map = await this.client.mapgenie.fetchMap(mapId);
    const gameId = window.game?.id ?? window.mapData?.map.game_id;
    if (map.id !== mapId || map.game_id !== gameId) {
      throw new Error("Requested map does not belong to this game's page.");
    }
    mapDataUtils.loadMapData(map, {
      preserveMapConfig: mapId === window.mapData?.map.id,
      swapTileCoordinates: mapDataUtils.getStoredTileCoordinateSwap(
        map.game_id,
        map.id
      ),
    });
    prepareMapDataResponseOverride(mapId, window.mapData!.locations);
  }

  private async loadMapData() {
    if (!window.mapData) return;

    if (this.fmgMapId !== null) {
      await this.loadMapDataForMapId(this.fmgMapId);
    }
  }

  private async loadHeatmaps() {
    if (!window.mapData?.heatmapGroups) return;
    if (this.fmgMapId === null) return;

    const hasHeatmaps = window.mapData.heatmapGroups.length > 0;
    if (!hasHeatmaps) return;

    const heatmaps = await this.client.mapgenie.fetchHeatmaps(
      window.mapData!.map.id
    );

    mapDataUtils.loadHeatmaps(heatmaps);
  }

  private async loadRemoteMapData() {
    try {
      await this.loadMapData();
    } catch (err) {
      // Never label the original page's map as a successfully loaded target.
      showMapLoadError();
      throw err;
    }
    try {
      await this.loadHeatmaps();
    } catch (err) {
      logger.warn("Could not load optional heatmaps; continuing with the requested map.", err);
    }
  }

  private setupEventListeners() {
    this.client.on("locationMarked", (e) => {
      // Forward to guide page
      window.dispatchEvent(
        new CustomEvent<Client.LocationEvent>("locationMarked", {
          detail: e.detail,
        })
      );
    });
  }

  private fixAltMapSdk() {
    if (window.config?.altMapSdk) {
      window.google = window.google || {};
      window.google.maps = window.google.maps || {
        Size: function () {},
      };
    }
  }

  private restoreFmgMapId() {
    if (this.fmgMapId !== null) {
      const params = new URLSearchParams();
      params.set("fmgMapId", this.fmgMapId.toString());

      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}?${params}`
      );
    }
  }

  private async login() {
    await waitForProperty(window, "mapManager");

    const $loginLink = $(`#user-panel a[href$="/login"]`);
    if ($loginLink.length > 0) {
      const href = $loginLink[0].getAttribute("href");
      if (href) {
        window.location.href = href;
      }
    } else {
      logger.warn("Login link not found.");
    }
  }

  private async activateMapScript() {
    if (window.mapManager) return;

    const activated = await activateBlockedMapgenieScript("map");
    if (!activated) {
      logger.warn("MapGenie map script not found.");
      return;
    }

    await waitForProperty(window, "mapManager", 30000);
  }

  private async installRequestInterceptor() {
    try {
      await this.withTimeout(
        this.client.installInterceptor(),
        10000,
        "FMG request interceptor installation"
      );
    } catch (err) {
      logger.error("Failed to install FMG request interceptor.", err);
    }
  }

  public async start() {
    await waitForProperty(window, "mapData");

    await this.setupUser();

    // Load map data and heatmaps for pro maps and maps with heatmaps
    await this.loadRemoteMapData();

    // MapGenie stores tracked categories per game. Only pass categories that
    // exist on this map or its map script may fail during initialization.
    this.filterTrackedCategoriesForCurrentMap();

    // Overwrite some game config options
    if (window.config) {
      window.config.proOnlyMedia = false;
      window.config.checklistEnabled = true;
      window.config.presetsEnabled = true;
      window.config.iconSizeToggleEnabled = true;
    }

    // Unlock pro map links
    await this.unlockMapLinks();

    if (!window.user) {
      await this.activateMapScript();

      // In development mode, auto-login and load map data to speed up testing
      if (import.meta.env.DEV) {
        await this.login();
      }

      return;
    }

    try {
      await this.withTimeout(
        (async () => {
          // Request persistend storage
          await this.client.storageRequestPersist();

          // Login client from map data
          this.client.loginFromMap();

          // Load user data
          await this.loadUserData();
        })(),
        5000,
        "FMG user data loading"
      );
    } catch (err) {
      logger.error("Failed to load FMG user data, loading map anyway.", err);
    }

    // Fix alt map sdk if needed
    this.fixAltMapSdk();

    this.lockProData();

    await this.activateMapScript();
    await this.installRequestInterceptor();
    await this.syncSavedLocationsToMap();

    this.setupEventListeners();
    await this.ui.mount();

    // Restore fmgMapId param on pro maps
    this.restoreFmgMapId();
  }

  public async info() {
    const userId = window.user?.id ?? "not logged in";
    const game = window.game?.title ?? null;
    const gameId = window.game?.id ?? null;
    const map = window.mapData?.map.title ?? null;
    const mapId = window.mapData?.map.id ?? null;

    return {
      userId,
      game,
      gameId,
      map,
      mapId,
    };
  }
}
