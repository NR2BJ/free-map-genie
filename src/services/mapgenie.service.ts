import axios from "axios";
import { setupCache } from "axios-cache-interceptor";

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

  @Memoize()
  public async fetchGames() {
    const { data } = await this.axios.get<MG.Api.Game[]>("/games");
    return data;
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
        `/games/${gameId}/full`
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
    const { data } = await this.axios.get<MG.Api.MapFull>(
      `/maps/${mapId}/full`
    );
    return data;
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
