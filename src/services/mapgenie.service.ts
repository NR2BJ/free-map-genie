import axios from "axios";
import { setupCache } from "axios-cache-interceptor";
import { browser } from "wxt/browser";
import { fetchGameCatalog } from "@/common/mapgenie/gameCatalog";
import { selectMapFromGame } from "@/common/mapgenie/mapResponse";
import { fetchProLocations } from "@/common/mapgenie/proMarkers";

import { createService, Memoize, type ProxiedObject } from "@/common/messaging";

import backendService from "./backend.service";

declare global {
  var $headers: Record<string, string>;
}

class MapgenieService {
  private readonly backend = backendService.use();

  private readonly axios = setupCache(
    axios.create({
      baseURL: import.meta.env.MAPGENIE_API_URL,
      headers: $headers,
    }),
    {
      interpretHeader: false,
    }
  );

  private isUnavailable(error: unknown) {
    if (!axios.isAxiosError(error)) return false;
    return error.response?.status === 403 || error.response?.status === 404;
  }

  public async fetchUser(gameId: number | string) {
    const auth = await this.backend.getAuthToken();
    const { data } = await this.axios.get<MG.Api.UserFull>("/user/full", {
      cache: false,
      baseURL: "https://mapgenie.io/api/v1", // Force mapgenie API base URL
      headers: {
        ["Authorization"]: `Bearer ${auth}`,
        ["X-Game-ID"]: String(gameId),
      },
    });

    return data;
  }

  public async fetchGames() {
    const baseURL = import.meta.env.DEV
      ? import.meta.env.MAPGENIE_API_URL
      : "https://mapgenie.io/api/v1";
    return fetchGameCatalog(`${baseURL}/games`, browser.storage.local);
  }

  @Memoize()
  public async fetchGameInfo(gameId: number | string) {
    const games = await this.fetchGames();
    const game = games.find((g) => String(g.id) === String(gameId));
    if (!game) {
      throw new Error(`Game with ID "${gameId}" not found`);
    }
    return game;
  }

  @Memoize()
  public async fetchGame(gameId: number | string): Promise<MG.Api.GameFull> {
    try {
      const { data } = await this.axios.get<MG.Api.GameFull>(
        `/games/${gameId}/full`,
        { timeout: 20000 }
      );
      return data;
    } catch (error) {
      if (!this.isUnavailable(error)) throw error;

      logger.warn(
        `Falling back to games list because full game API is unavailable for ${gameId}.`,
        error
      );

      const game = await this.fetchGameInfo(gameId);
      return {
        ...game,
        maps: game.maps as unknown as MG.Api.MapFullForGame[],
        default_presets: [],
      };
    }
  }

  @Memoize()
  public async fetchMap(mapId: number | string) {
    const id = Number(mapId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("Invalid map ID.");
    }
    const { data: info } = await this.axios.get<MG.Api.Map>(
      `/maps/${id}`,
      { timeout: 15000 }
    );
    if (info?.id !== id || !Number.isSafeInteger(info.game_id) || info.game_id <= 0) {
      throw new Error(`Invalid metadata for map ${id}.`);
    }
    const game = await this.fetchGame(info.game_id);
    await this.fillPremiumLocations(game, info);
    return selectMapFromGame(game, info.game_id, id);
  }

  /**
   * MapGenie strips premium-map markers from every public endpoint for sessions
   * without a PRO entitlement: `/games/{id}/full` still returns the map record,
   * its tile sets and its categories, but each category's `locations` is empty.
   * The same rows are available through the IGN wikimaps GraphQL API, so fill
   * them in before `selectMapFromGame` validates the map.
   */
  private async fillPremiumLocations(game: MG.Api.GameFull, info: MG.Api.Map) {
    const map = game.maps?.find((candidate) => candidate.id === info.id);
    if (!map) return;

    const groups = map.groups ?? [];
    const present = groups.reduce(
      (total, group) =>
        total +
        (group.categories ?? []).reduce(
          (count, category) => count + (category.locations?.length ?? 0),
          0
        ),
      0
    );
    if (present > 0 || !(info.locations_count > 0)) return;

    const objectSlug = game.ign_slug;
    const mapSlug = map.slug ?? info.slug;
    if (!objectSlug || !mapSlug) {
      logger.warn(`Map ${info.id} has no markers and no IGN slug to recover them from.`);
      return;
    }

    try {
      const locations = await fetchProLocations({
        objectSlug,
        mapSlug,
        mapId: info.id,
      });
      if (locations.length === 0) {
        logger.warn(`IGN returned no markers for map ${info.id} (${objectSlug}/${mapSlug}).`);
        return;
      }

      const byCategory = new Map<number, MG.Location[]>();
      for (const location of locations) {
        const bucket = byCategory.get(location.category_id) ?? [];
        bucket.push(location);
        byCategory.set(location.category_id, bucket);
      }
      for (const group of groups) {
        for (const category of group.categories ?? []) {
          category.locations = byCategory.get(category.id) ?? [];
        }
      }

      const missing = info.locations_count - locations.length;
      if (missing > 0) {
        logger.warn(
          `Recovered ${locations.length}/${info.locations_count} premium markers for map ${info.id}.`
        );
      } else {
        logger.log(`Recovered ${locations.length} premium markers for map ${info.id}.`);
      }
    } catch (error) {
      logger.warn(`Could not recover premium markers for map ${info.id}.`, error);
    }
  }

  @Memoize()
  public async fetchHeatmaps(mapId: number | string) {
    try {
      const { data } = await this.axios.get<MG.Api.HeatmapGroup[]>(
        `/maps/${mapId}/heatmaps`
      );
      return data;
    } catch (error) {
      if (!this.isUnavailable(error)) throw error;
      logger.warn(`Heatmaps API is unavailable for map ${mapId}.`, error);
      return [];
    }
  }

  @Memoize()
  public async getDomainForGame(gameId: number | string): Promise<string> {
    const game = await this.fetchGameInfo(gameId);
    return game.domain;
  }

  @Memoize()
  public async fetchGameBySlug(slug: string): Promise<MG.Api.Game> {
    const games = await this.fetchGames();
    const game = games.find((g) => g.slug === slug);
    if (!game) {
      throw new Error(`Game with slug "${slug}" not found`);
    }
    return game;
  }

  @Memoize()
  public async getMapImage(mapId: number | string): Promise<string | null> {
    const map = await this.fetchMap(mapId);
    return map.image;
  }
}

const mapgenieService = createService({
  context: MapgenieService,
  namespace: "MapgenieService",
  heartbeatTimeout: import.meta.env.SERVICE_TIMEOUT,
});

namespace mapgenieService {
  export type Instance = ProxiedObject<MapgenieService>;
}

export default mapgenieService;
