export const selectMapFromGame = (
  game: MG.Api.GameFull,
  gameId: number,
  mapId: number
): MG.Api.MapFull => {
  if (game?.id !== gameId || !Array.isArray(game.maps)) {
    throw new Error(`Invalid game data for map ${mapId}.`);
  }

  const map = game.maps.find((candidate) => candidate.id === mapId);
  if (!map || map.game_id !== gameId) {
    throw new Error(`Map ${mapId} is not part of game ${gameId}.`);
  }
  if (
    !Array.isArray(map.groups) ||
    !Array.isArray(map.regions) ||
    !Array.isArray(map.config?.tile_sets) ||
    !Number.isFinite(map.config.initial_zoom) ||
    !Number.isFinite(map.config.start_lat) ||
    !Number.isFinite(map.config.start_lng)
  ) {
    throw new Error(`Map ${mapId} has incomplete map data.`);
  }

  let locationCount = 0;
  for (const group of map.groups) {
    if (!Array.isArray(group?.categories)) {
      throw new Error(`Map ${mapId} has incomplete category data.`);
    }
    for (const category of group.categories) {
      if (!Array.isArray(category?.locations)) {
        throw new Error(`Map ${mapId} has incomplete location data.`);
      }
      for (const location of category.locations) {
        if (!location || location.map_id !== mapId) {
          throw new Error(`Map ${mapId} contains locations from another map.`);
        }
        locationCount++;
      }
    }
  }
  if (map.locations_count > 0 && locationCount === 0) {
    throw new Error(`MapGenie returned no markers for map ${mapId} (${map.locations_count} expected).`);
  }

  // Keep the full map list for callers, without duplicating every map's markers
  // in the message sent from the backend to the page.
  const { maps, default_presets: _presets, ...gameInfo } = game;
  return {
    ...map,
    game: {
      ...gameInfo,
      maps: maps.map(({ groups: _groups, regions: _regions, config: _config, game: _game, ...info }) => info),
    },
  };
};
