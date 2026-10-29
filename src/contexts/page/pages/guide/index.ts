import { Page } from "../page";

import { Client } from "@/common/client";
import async from "@/common/async";
import { activateBlockedMapgenieScript } from "@/common/mapgenie";
import { waitForProperty } from "@/common/object";
import { waitForElement } from "@/common/dom";

import { GuideState } from "./state";

export class GuidePage extends Page {
  private readonly isTarkovQuest17Page =
    window.location.pathname === "/tarkov/guides/quests-17";

  private readonly state = new GuideState();

  private readonly client = new Client();

  private async loadUserData() {
    if (!window.user) {
      throw new Error("User or mapData is not available");
    }

    await this.client.migrate();
    const data = await this.client.getData();

    window.foundLocations = data.locations;
    window.user.locations = data.locations;

    const state = await this.state.waitForState();
    this.state.resetState();

    // Update state found locations
    state.foundLocations = data.locations;
    logger.log(`Loaded ${Object.keys(data.locations).length} saved FMG guide locations.`);
  }

  private async getMapElement() {
    return waitForElement<HTMLIFrameElement>(document, "#sticky-map iframe");
  }

  private async getMapWindow() {
    const mapElement = await this.getMapElement();
    const mapWindow = await waitForProperty(mapElement, "contentWindow");
    await waitForProperty(mapWindow!, "mapData");
    return mapWindow;
  }

  private async setupUser(userId?: number) {
    if (userId === undefined) return;

    // Get the active user from the backend
    const activeUserId = await this.client.getActiveUserId();

    // Client requires a user to object to function properly
    // So we create a dummy user
    window.user = {
      id: activeUserId ?? userId,
      realId: userId,
      hasPro: false,
      locations: {},
      trackedCategoryIds: [],
      role: "user",
      suggestions: [],
    };

  }

  private async getUserId() {
    if (this.isTarkovQuest17Page) {
      await waitForProperty(window, "config");
      return window.user?.id;
    }

    const mapWindow = await this.getMapWindow();
    if (!mapWindow) throw new Error("Embedded map window is not available");

    // mapData can arrive before the account. Missing IDs mean still loading;
    // an explicit null is a signed-out map and must not enable local tracking.
    await async.waitUntil(() => mapWindow.user === null ||
      Number.isSafeInteger(mapWindow.user?.realId ?? mapWindow.user?.id), 10000);
    return mapWindow?.user?.realId ?? mapWindow?.user?.id;
  }

  private fixCheckbox(checkbox: HTMLInputElement) {
    const $this = $(checkbox);

    const locationId = $this.data("location-id");

    if (!locationId) {
      logger.warn("Checkbox has no data-location-id attribute");
      return;
    }

    const isFound = window.foundLocations![locationId] ?? false;
    this.state.updateCheckbox(checkbox, Boolean(isFound));
  }

  private fixState(checkbox: HTMLInputElement) {
    const $this = $(checkbox);
    const locationId = $this.data("location-id");

    if (!locationId) {
      logger.warn("Checkbox has no data-location-id attribute");
      return;
    }

    this.state.fixStateForLocationId(checkbox, locationId);
  }

  private fixCheckboxes() {
    // Make sure the guide script checkboxes are unchecked
    $<HTMLInputElement>(".check").each((_, checkbox) => {
      this.fixCheckbox(checkbox);
      this.fixState(checkbox);
    });

    this.state.updateCounts();
  }

  private async setupEventListeners() {
    if (this.isTarkovQuest17Page) {
      return;
    }

    const setupLocationMarkedListener = async () => {
      const mapWindow = await this.getMapWindow();
      mapWindow?.addEventListener("locationMarked", (e) => {
        const { locationId, found } = e.detail;

        this.state.markLocationFound(locationId, found);
      });
    };

    await setupLocationMarkedListener();

    const mapElement = await this.getMapElement();
    mapElement.addEventListener("load", async () => {
      await setupLocationMarkedListener();
    });
  }

  public async start() {
    const userId = await this.getUserId();

    await this.setupUser(userId);

    if (userId === undefined) {
      logger.log("Guide tracking inactive: no signed-in map account.");
      if (this.isTarkovQuest17Page) {
        await activateBlockedMapgenieScript("TarkovQuestToolWidget");
      }
      return;
    }

    // Request persistend storage
    await this.client.storageRequestPersist();

    // Login client from guide data
    await this.client.loginFromGuide();

    // Load user data
    await this.loadUserData();

    this.fixCheckboxes();

    // Enable unlimited tracking only after requests can be saved locally.
    await this.client.installInterceptor();
    window.isPro = true;
    window.user!.hasPro = true;
    window.maxFoundLocations = Infinity;

    // Activate blocked Mapgenie scripts
    if (this.isTarkovQuest17Page) {
      await activateBlockedMapgenieScript("TarkovQuestToolWidget");
    }

    await this.setupEventListeners();
    logger.log("Guide tracking connected to local FMG saves.");
  }

  public async info(): Promise<Record<string, any>> {
    const userId = await this.getUserId();

    if (this.isTarkovQuest17Page) {
      return {
        userId: userId ?? "not logged in",
        game: "Tarkov",
        gameId: 20,
      };
    }

    const mapWindow = await this.getMapWindow();
    const gameId = mapWindow?.game?.id ?? null;
    const game = mapWindow?.game?.title ?? null;

    return {
      userId: userId ?? "not logged in",
      game,
      gameId: gameId,
    };
  }
}
