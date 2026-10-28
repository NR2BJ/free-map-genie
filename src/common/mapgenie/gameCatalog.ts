const CACHE_KEY = "fmg:game-catalog:v1";
const UPDATED_KEY = "fmg:game-catalog:updated-at:v1";
const MAX_AGE = 60 * 60 * 1000;
const inFlight = new Map<string, Promise<MG.Api.Game[]>>();

interface CatalogStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function isCatalog(value: unknown): value is MG.Api.Game[] {
  return Array.isArray(value) && value.length > 0 && value.every((game) =>
    game && Number.isSafeInteger(game.id) && typeof game.title === "string" &&
    typeof game.slug === "string" && typeof game.domain === "string" &&
    typeof game.config?.url === "string" && Array.isArray(game.maps)
  );
}

export async function fetchGameCatalog(url: string, storage: CatalogStorage) {
  try {
    const cached = (await storage.get(CACHE_KEY))[CACHE_KEY];
    if (isCatalog(cached)) {
      const updated = (await storage.get(UPDATED_KEY))[UPDATED_KEY];
      if (typeof updated !== "number" || updated > Date.now() || Date.now() - updated >= MAX_AGE) {
        // Refresh for the next open without holding up the current view.
        void refreshGameCatalog(url, storage).catch(() => {});
      }
      return cached;
    }
  } catch {
    // Storage may be unavailable; the public request can still succeed.
  }
  return refreshGameCatalog(url, storage);
}

function refreshGameCatalog(url: string, storage: CatalogStorage) {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const request = requestGameCatalog(url, storage).finally(() => inFlight.delete(url));
  inFlight.set(url, request);
  return request;
}

async function requestGameCatalog(url: string, storage: CatalogStorage) {
  // This is public metadata: no account token, cookies or app-secret header.
  const response = await fetch(url, {
    credentials: "omit",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Game catalog HTTP ${response.status}`);
  const games: unknown = await response.json();
  if (!isCatalog(games)) throw new Error("Invalid MapGenie game catalog");
  try {
    await storage.set({ [CACHE_KEY]: games, [UPDATED_KEY]: Date.now() });
  } catch {
    // A cache write failure must not discard a successful network response.
  }
  return games;
}
