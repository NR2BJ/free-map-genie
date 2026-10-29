import type { Axios } from "axios";

export const prepareMapDataResponseOverride = (mapId: number, locations: MG.Location[]) => {
  if (window.axios) {
    installMapDataResponseOverride(window.axios, mapId, locations);
    return;
  }
  // Current map.js creates Axios and immediately starts its boot request.
  // Register synchronously on assignment, before that first request is made.
  let value: Axios | undefined;
  Object.defineProperty(window, "axios", {
    configurable: true,
    enumerable: true,
    get: () => value,
    set: (axios: Axios | undefined) => {
      value = axios;
      if (!axios) return;
      Object.defineProperty(window, "axios", {
        value: axios, configurable: true, enumerable: true, writable: true,
      });
      installMapDataResponseOverride(axios, mapId, locations);
    },
  });
};

export const installMapDataResponseOverride = (
  axios: Axios,
  mapId: number,
  locations: MG.Location[]
) => {
  const pageOrigin = window.location.origin;
  return axios.interceptors.response.use((response) => {
    const url = new URL(response.config.url ?? "", pageOrigin);
    if (
      response.config.method?.toLowerCase() !== "get" ||
      url.origin !== pageOrigin ||
      url.pathname !== `/api/v1/maps/${mapId}/data`
    ) return response;

    const data = response.data;
    if (
      data?.map?.id !== mapId ||
      !Array.isArray(data.locations) ||
      data.locations.some((location: MG.Location) => !location || location.map_id !== mapId)
    ) {
      throw new Error(`Invalid map data response for map ${mapId}.`);
    }

    // The new boot request can omit Pro markers even when game/full supplies
    // them. Preserve its styles, roads and other metadata, and prefer its richer
    // location fields when the same marker exists in both responses.
    const merged = new Map(locations.map((location) => [location.id, location]));
    for (const location of data.locations as MG.Location[]) {
      merged.set(location.id, { ...merged.get(location.id), ...location });
    }
    response.data = { ...data, locations: [...merged.values()] };
    return response;
  });
};
