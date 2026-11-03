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
import { fetchProLocations } from "@/common/mapgenie/proMarkers";

export class MapPage extends Page {
  private client = new Client();
  private ui = new UI();
  private savedLocationsForRestore?: Record<string, boolean>;

  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    message: string
  ) {
    let handle: ReturnType<typeof setTimeout> | undefined;

    // Bare timers resolve to the script global in the browser and to the test
    // global in unit tests, where `window` is only a partial stub.
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      handle = setTimeout(
        () => reject(new Error(`${message} timed out after ${timeout}ms.`)),
        timeout
      );
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (handle !== undefined) {
        clearTimeout(handle);
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

    // The initial page can omit markers until its asynchronous map-data request.
    // Keep the full save for restoration once the runtime map is ready.
    this.savedLocationsForRestore = { ...data.locations };

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
    const saved = this.savedLocationsForRestore ?? window.user?.locations ?? {};
    const savedLocationIds = Object.keys(saved)
      .filter((id) => saved[id])
      .map(Number);

    const mapState = window.store?.getState().map;
    const stateLocations = mapState?.locationsById ?? mapState?.locationById;

    const currentMapLocationIds =
      stateLocations != null
        ? Object.keys(stateLocations).map(Number)
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

    // Update the locked object only after dispatch: Redux may share this object,
    // and pre-populating it would suppress the counter update for restored IDs.
    if (this.savedLocationsForRestore && window.user) {
      for (const id of Object.keys(window.user.locations)) {
        delete window.user.locations[id];
      }
      for (const id of locationIds) window.user.locations[id] = true;
      this.savedLocationsForRestore = undefined;
    }
    if (locationIds.length === 0) return;

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
      // This is a cosmetic link rewrite that needs a backend round trip. It must
      // never hold the boot: on Firefox the call waits for the backend service to
      // answer, and a slow or missing responder used to stall the map forever
      // because the map script is only replayed after this returns.
      await this.withTimeout(
        fixMapLinks(this.client.mapgenie),
        8000,
        "Map link unlock"
      );
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

  /**
   * Premium markers are fetched here, in the page context, because a Firefox
   * content script has no cross-origin access to the IGN API without an opt-in
   * host permission, while page-origin requests are CORS-allowed. The service
   * falls back to its own request when this returns nothing.
   */
  private async loadProLocationsForMap(mapId: number) {
    try {
      const info = await this.client.mapgenie.fetchMapInfo(mapId);
      if (!(info.locations_count > 0) || !info.ign_slug) return undefined;
      const locations = await fetchProLocations({
        objectSlug: info.ign_slug,
        mapSlug: info.slug,
        mapId,
      });
      logger.log(`Fetched ${locations.length} premium markers in the page context.`);
      return locations;
    } catch (err) {
      logger.warn(
        "Could not fetch premium markers in the page context; falling back to the backend request.",
        err
      );
      return undefined;
    }
  }

  private async loadMapDataForMapId(mapId: number) {
    const proLocations = await this.loadProLocationsForMap(mapId);
    const map = await this.client.mapgenie.fetchMap(mapId, proLocations);
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
      // fetchMap is a backend round trip; bound it so a silent responder cannot
      // keep the map script from ever being replayed.
      await this.withTimeout(this.loadMapData(), 20000, "Remote map data loading");
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

    // `/js/map.` skips maplibre.*.js, which also contains "js/map".
    const tagCount = document.querySelectorAll(
      'script[src*="cdn.mapgenie.io/js/map."]'
    ).length;

    const activated = await activateBlockedMapgenieScript("map");
    if (!activated) {
      // No script tag to replay: the page either never requested map.js or the
      // tag was removed. Nothing else in the boot flow can recover this.
      logger.error(
        `MapGenie map script tag not found (tags=${tagCount}); the map cannot boot.`
      );
      showMapLoadError();
      return;
    }

    try {
      await waitForProperty(window, "mapManager", 15000);
      logger.log("MapGenie map script started.", { tagCount });
    } catch (error) {
      // The replayed URL was fetched but never produced a runtime: an ad blocker
      // or tracker protection is the usual cause, since the same request is
      // already being rewritten by declarativeNetRequest.
      logger.error(
        `MapGenie map script did not start (tags=${tagCount}). ` +
          "Check the network panel for a blocked cdn.mapgenie.io/js/map request " +
          "and allow mapgenie.io in content blockers.",
        error
      );
      showMapLoadError();
    }
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
    logger.log("Map boot: page data ready.");

    await this.setupUser();
    logger.log("Map boot: user state ready.");

    // Load map data and heatmaps for pro maps and maps with heatmaps
    await this.loadRemoteMapData();
    logger.log("Map boot: remote map data handled.");

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
    logger.log("Map boot: map links handled.");

    if (!window.user) {
      logger.log("Map boot: replaying the map script (signed out).");
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

    logger.log("Map boot: replaying the map script.");
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
