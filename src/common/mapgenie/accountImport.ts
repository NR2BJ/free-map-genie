import { createEmptyUserData, UserDataSchema } from "@/common/storage/format";
import type { Axios } from "axios";

export async function fetchAccountData(axios: Axios, mapIds: number[]) {
  if (!mapIds.length) throw new Error("No maps available for account import");
  const result = createEmptyUserData();
  const tracked = new Set<number>();
  const notes = new Map<string, (typeof result.notes)[number]>();

  // Fetch everything before writing, so one failed map cannot erase local data.
  for (const id of new Set(mapIds)) {
    if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid map ID");
    const { data } = await axios.get(`/api/v1/user/map-data/${id}`, {
      headers: { "X-Map-ID": String(id) },
      timeout: 15000,
    });
    if (!data || typeof data !== "object" || !data.locations ||
        typeof data.locations !== "object") {
      throw new Error(`Invalid account data for map ${id}`);
    }
    const ids = Array.isArray(data.locations)
      ? data.locations
      : Object.keys(data.locations).filter((key) => data.locations[key]);
    for (const value of ids) {
      const locationId = Number(value);
      if (!Number.isSafeInteger(locationId) || locationId < 0) {
        throw new Error(`Invalid location ID for map ${id}`);
      }
      result.locations[locationId] = true;
    }
    const parsed = UserDataSchema.parse({
      ...createEmptyUserData(),
      trackedCategoryIds: data.trackedCategoryIds ?? [],
      notes: (data.notes ?? []).map((note: MG.Note) => ({
        ...note,
        description: note.description ?? "",
      })),
    });
    parsed.trackedCategoryIds.forEach((category) => tracked.add(category));
    parsed.notes.forEach((note) => notes.set(note.id, note));
  }
  result.trackedCategoryIds = [...tracked];
  result.notes = [...notes.values()];
  return result;
}
