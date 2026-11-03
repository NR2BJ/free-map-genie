#!/usr/bin/env node
/**
 * MapGenie PRO marker exporter.
 *
 * Why this works
 * --------------
 * MapGenie stopped shipping premium-map markers in `/api/v1/maps/{id}/data`
 * (the response now carries `locations: []` plus `proCategoryLocationCounts`).
 *
 * The same marker rows are still served to the public IGN wikimaps GraphQL API
 * (`mapGenieMarkersMultiple` is paywalled, but `mapGenieSearch` is not) and its
 * `MapMarker` type exposes `lat` / `lng` through ordinary GraphQL over-fetching.
 * A `%` term matches every marker name, so one query per map returns the
 * complete marker set in MapGenie's own normalized coordinate space.
 *
 * Usage
 * -----
 *   node tools/pro-markers.mjs --map 75
 *   node tools/pro-markers.mjs --game 20 --all
 *   node tools/pro-markers.mjs --map 64 --out research/pro-markers/out --quiet
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAPGENIE_API = "https://mapgenie.io/api/v1";
const IGN_GRAPHQL = "https://mollusk.apis.ign.com/graphql";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const MARKER_QUERY = `query ProMapMarkers($objectSlug: String!, $mapSlug: String!, $terms: String!) {
  mapGenieSearch(objectSlug: $objectSlug, mapSlug: $mapSlug, terms: $terms) {
    markers { typeSlug markerSlug markerName lat lng }
  }
}`;

/** Terms used when the `%` wildcard stops matching everything. */
const FALLBACK_TERMS = [" ", "a", "e", "i", "o", "u", "s", "t", "r", "n", "l", "c", "1", "2", "x", "k"];

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function requestJson(url, { body, retries = 3, label = url } = {}) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: body ? "POST" : "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${label}`);
      }
      return await response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      await sleep(500 * (attempt + 1));
    }
  }
  throw new Error(`unreachable: ${label}`);
}

const mapgenie = (path) => requestJson(`${MAPGENIE_API}${path}`);

async function ignSearch({ objectSlug, mapSlug, terms }) {
  const payload = await requestJson(IGN_GRAPHQL, {
    label: `ign ${objectSlug}/${mapSlug} "${terms}"`,
    body: { query: MARKER_QUERY, variables: { objectSlug, mapSlug, terms } },
  });
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((e) => e.message).join("; "));
  }
  return payload.data?.mapGenieSearch?.markers ?? [];
}

// ---------------------------------------------------------------------------
// markers
// ---------------------------------------------------------------------------

const markerKey = (marker) => `${marker.typeSlug}:${marker.markerSlug}`;

/**
 * Collect every marker of a map. `%` is a `LIKE` wildcard on the search
 * resolver, so a single request normally returns the full set; the letter
 * sweep is only a safety net for the day that gets escaped.
 */
export async function collectMarkers({ objectSlug, mapSlug, delay = 150 }) {
  const byKey = new Map();
  const add = (markers) => {
    for (const marker of markers) {
      if (!marker?.markerSlug || !Number.isFinite(marker.lat)) continue;
      byKey.set(markerKey(marker), marker);
    }
  };

  add(await ignSearch({ objectSlug, mapSlug, terms: "%" }));

  if (byKey.size === 0) {
    for (const terms of FALLBACK_TERMS) {
      add(await ignSearch({ objectSlug, mapSlug, terms }));
      await sleep(delay);
    }
  }

  return [...byKey.values()];
}

export function toLocations(markers, mapId) {
  return markers
    .map((marker) => ({
      id: Number(marker.markerSlug),
      map_id: mapId,
      region_id: null,
      category_id: Number(marker.typeSlug),
      title: marker.markerName,
      description: "",
      latitude: marker.lat.toFixed(8),
      longitude: marker.lng.toFixed(8),
      features: null,
      ign_page_id: null,
      tags: [],
      media: [],
    }))
    .sort((a, b) => a.id - b.id);
}

function countByCategory(locations) {
  const counts = {};
  for (const location of locations) {
    counts[location.category_id] = (counts[location.category_id] ?? 0) + 1;
  }
  return counts;
}

/**
 * Compare a marker set against MapGenie's own counters. `proCategoryLocationCounts`
 * is the authoritative per-category count for premium maps, `locations_count` the
 * authoritative total for every map.
 */
export function diffCounts({ counts, expectedCategoryCounts, expectedTotal }) {
  const problems = [];
  if (Number.isFinite(expectedTotal)) {
    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    if (total !== expectedTotal) problems.push(`total ${total} != expected ${expectedTotal}`);
  }
  for (const [categoryId, expected] of Object.entries(expectedCategoryCounts ?? {})) {
    const actual = counts[categoryId] ?? 0;
    if (actual !== expected) problems.push(`category ${categoryId}: ${actual} != expected ${expected}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// map resolution
// ---------------------------------------------------------------------------

async function listMaps(gameId) {
  const game = await mapgenie(`/games/${gameId}/full`);
  return {
    game: { id: game.id, slug: game.slug, ignSlug: game.ign_slug, title: game.title },
    maps: (game.maps ?? []).map((map) => ({
      id: map.id,
      slug: map.slug,
      title: map.title,
      premium: Boolean(map.premium),
      locationsCount: map.locations_count,
    })),
  };
}

async function mapInfo(mapId) {
  const info = await mapgenie(`/maps/${mapId}`);
  if (!info?.id) throw new Error(`Unknown map ${mapId}`);
  const data = await mapgenie(`/maps/${mapId}/data`);
  return {
    id: info.id,
    slug: info.slug,
    title: info.title,
    premium: Boolean(info.premium),
    locationsCount: info.locations_count,
    gameId: info.game_id,
    ignSlug: info.game?.ign_slug ?? null,
    publicLocations: data.locations?.length ?? 0,
    proCategoryCounts: data.proCategoryLocationCounts ?? {},
  };
}

// ---------------------------------------------------------------------------
// cli
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { out: join(repoRoot, "research/pro-markers/out"), delay: 200, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--map": args.map = Number(next()); break;
      case "--game": args.game = Number(next()); break;
      case "--all": args.all = true; break;
      case "--out": args.out = resolve(next()); break;
      case "--quiet": args.quiet = true; break;
      case "--help": args.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

const USAGE = `Usage:
  node tools/pro-markers.mjs --map <mapId> [--out DIR] [--quiet]
  node tools/pro-markers.mjs --game <gameId> --all [--out DIR] [--quiet]

Fetches the full marker set of MapGenie premium maps from the public IGN
wikimaps GraphQL API and validates it against MapGenie's own counters.`;

async function exportMap(target, { out, delay, quiet }) {
  const info = await mapInfo(target);
  if (!info.ignSlug) throw new Error(`Map ${target} is not exposed through IGN`);

  const markers = await collectMarkers({
    objectSlug: info.ignSlug,
    mapSlug: info.slug,
    delay,
  });
  const locations = toLocations(markers, info.id);
  const counts = countByCategory(locations);
  const problems = diffCounts({
    counts,
    expectedCategoryCounts: info.proCategoryCounts,
    expectedTotal: info.locationsCount,
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    source: {
      markers: `${IGN_GRAPHQL}#mapGenieSearch`,
      metadata: `${MAPGENIE_API}/maps/${info.id}`,
      objectSlug: info.ignSlug,
    },
    map: {
      id: info.id,
      slug: info.slug,
      title: info.title,
      game_id: info.gameId,
      premium: info.premium,
      locations_count: info.locationsCount,
      publicly_served_locations: info.publicLocations,
    },
    categoryCounts: counts,
    proCategoryLocationCounts: info.proCategoryCounts,
    verified: problems.length === 0,
    problems,
    locations,
  };

  await mkdir(out, { recursive: true });
  const file = join(out, `${info.gameId}-${info.id}-${info.slug}.json`);
  await writeFile(file, JSON.stringify(payload, null, 1));

  if (!quiet) {
    const status = problems.length === 0 ? "OK" : `MISMATCH (${problems.length})`;
    console.log(
      `[${status}] ${info.title.padEnd(16)} map=${info.id} markers=${locations.length} ` +
      `expected=${info.locationsCount} public=${info.publicLocations} -> ${file}`
    );
    for (const problem of problems.slice(0, 5)) console.log(`    ${problem}`);
  }
  return payload;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.map && !(args.game && args.all))) {
    console.log(USAGE);
    return;
  }

  const targets = [];
  if (args.map) targets.push(args.map);
  if (args.game && args.all) {
    const { maps } = await listMaps(args.game);
    targets.push(...maps.map((map) => map.id));
  }

  const results = [];
  for (const target of targets) {
    try {
      results.push(await exportMap(target, args));
    } catch (error) {
      console.error(`[FAILED] map ${target}: ${error.message}`);
      results.push(null);
    }
    await sleep(args.delay);
  }

  const ok = results.filter(Boolean);
  const failed = results.length - ok.length;
  const mismatched = ok.filter((r) => !r.verified).length;
  console.log(
    `\n${ok.length}/${results.length} maps exported, ` +
    `${ok.filter((r) => r.verified).length} verified, ${mismatched} mismatched, ${failed} failed`
  );
  if (failed || mismatched) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
