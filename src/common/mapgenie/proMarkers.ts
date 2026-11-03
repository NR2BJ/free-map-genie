/**
 * Premium ("PRO") marker provider.
 *
 * MapGenie no longer puts premium-map markers in `/api/v1/maps/{id}/data`;
 * non-entitled sessions get `locations: []` plus `proCategoryLocationCounts`.
 * The rows are still public through the IGN wikimaps GraphQL API:
 * `mapGenieMarkersMultiple` is paywalled, but `mapGenieSearch` is not, and the
 * `MapMarker` type it resolves to carries `lat` / `lng`. A `%` search term is a
 * `LIKE` wildcard, so one request per map returns every marker in MapGenie's
 * own normalized coordinate space.
 *
 * Verified against MapGenie's own counters (see `tools/pro-markers.mjs`):
 * every map's marker total and per-category count matches `locations_count`
 * and `proCategoryLocationCounts` exactly.
 */

const IGN_GRAPHQL_URL = "https://mollusk.apis.ign.com/graphql";

/** `%` is passed through to the search resolver, matching every marker name. */
const MATCH_ALL_TERM = "%";

/** Safety net if the wildcard is ever escaped: one sweep merges to the full set. */
const FALLBACK_TERMS = [" ", "a", "e", "i", "o", "u", "s", "t", "r", "n", "l", "c"];

const MARKER_QUERY = `query ProMapMarkers($objectSlug: String!, $mapSlug: String!, $terms: String!) {
  mapGenieSearch(objectSlug: $objectSlug, mapSlug: $mapSlug, terms: $terms) {
    markers { typeSlug markerSlug markerName lat lng }
  }
}`;

export interface IgnMapMarker {
  typeSlug: string;
  markerSlug: string;
  markerName: string;
  lat: number;
  lng: number;
}

export interface FetchProMarkersOptions {
  objectSlug: string;
  mapSlug: string;
  mapId: number;
  timeout?: number;
}

const markerKey = (marker: IgnMapMarker) => `${marker.typeSlug}:${marker.markerSlug}`;

const isUsableMarker = (marker: IgnMapMarker | undefined | null): marker is IgnMapMarker =>
  Boolean(marker?.markerSlug) &&
  Number.isFinite(marker?.lat) &&
  Number.isFinite(marker?.lng);

export const searchIgnMarkers = async (
  objectSlug: string,
  mapSlug: string,
  terms: string,
  timeout = 20000
): Promise<IgnMapMarker[]> => {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(IGN_GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        query: MARKER_QUERY,
        variables: { objectSlug, mapSlug, terms },
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`IGN marker search failed with HTTP ${response.status}.`);
    }
    const payload = (await response.json()) as {
      data?: { mapGenieSearch?: { markers?: IgnMapMarker[] } };
      errors?: { message: string }[];
    };
    if (payload.errors?.length) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }
    return (payload.data?.mapGenieSearch?.markers ?? []).filter(isUsableMarker);
  } finally {
    clearTimeout(handle);
  }
};

export const fetchIgnMarkers = async (
  objectSlug: string,
  mapSlug: string
): Promise<IgnMapMarker[]> => {
  const merged = new Map<string, IgnMapMarker>();
  const merge = (markers: IgnMapMarker[]) => {
    for (const marker of markers) merged.set(markerKey(marker), marker);
  };

  merge(await searchIgnMarkers(objectSlug, mapSlug, MATCH_ALL_TERM));
  if (merged.size > 0) return [...merged.values()];

  logger.warn(
    `IGN match-all marker search returned nothing for ${objectSlug}/${mapSlug}, sweeping terms.`
  );
  for (const terms of FALLBACK_TERMS) {
    merge(await searchIgnMarkers(objectSlug, mapSlug, terms));
  }
  return [...merged.values()];
};

export const toProLocations = (
  markers: IgnMapMarker[],
  mapId: number
): MG.Location[] =>
  markers.map(
    (marker) =>
      ({
        id: Number(marker.markerSlug),
        map_id: mapId,
        region_id: null,
        category_id: Number(marker.typeSlug),
        title: marker.markerName,
        description: "",
        latitude: marker.lat.toFixed(8),
        longitude: marker.lng.toFixed(8),
        features: null,
        ign_page_id: "",
        tags: [],
        media: [],
      }) as unknown as MG.Location
  );

export const fetchProLocations = async (
  options: FetchProMarkersOptions
): Promise<MG.Location[]> => {
  const markers = await fetchIgnMarkers(options.objectSlug, options.mapSlug);
  return toProLocations(markers, options.mapId);
};
