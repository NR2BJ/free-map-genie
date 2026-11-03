import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadModule(relativePath) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    define: { logger: "globalThis.__testLogger" },
  });
  globalThis.__testLogger ??= { log() {}, warn() {}, error() {} };
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
}

const { fetchIgnMarkers, searchIgnMarkers, toProLocations } = await loadModule(
  "../src/common/mapgenie/proMarkers.ts"
);

const marker = (overrides = {}) => ({
  typeSlug: "960",
  markerSlug: "46005",
  markerName: "Ammo Box",
  lat: 0.7843158,
  lng: -0.55952954,
  ...overrides,
});

const installFetch = (handler) => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    return handler({ url, body, calls });
  };
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
};

const jsonResponse = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
});

test("maps IGN markers onto MapGenie location rows", () => {
  const [location] = toProLocations([marker()], 75);

  assert.equal(location.id, 46005);
  assert.equal(location.map_id, 75);
  assert.equal(location.category_id, 960);
  assert.equal(location.title, "Ammo Box");
  assert.equal(location.latitude, "0.78431580");
  assert.equal(location.longitude, "-0.55952954");
  assert.equal(location.region_id, null);
  assert.deepEqual(location.tags, []);
  assert.deepEqual(location.media, []);
});

test("searchIgnMarkers posts a MapGenie marker over-fetch query", async () => {
  const fetchStub = installFetch(() =>
    jsonResponse({
      data: { mapGenieSearch: { markers: [marker()] } },
    })
  );

  try {
    const markers = await searchIgnMarkers("escape-from-tarkov", "reserve", "%");

    assert.equal(markers.length, 1);
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].url, "https://mollusk.apis.ign.com/graphql");
    assert.deepEqual(fetchStub.calls[0].body.variables, {
      objectSlug: "escape-from-tarkov",
      mapSlug: "reserve",
      terms: "%",
    });
    assert.match(fetchStub.calls[0].body.query, /markerSlug markerName lat lng/);
  } finally {
    fetchStub.restore();
  }
});

test("fetchIgnMarkers uses the single wildcard request when it matches", async () => {
  const fetchStub = installFetch(() =>
    jsonResponse({ data: { mapGenieSearch: { markers: [marker(), marker()] } } })
  );

  try {
    const markers = await fetchIgnMarkers("escape-from-tarkov", "reserve");

    assert.equal(markers.length, 1, "duplicate markers collapse");
    assert.equal(fetchStub.calls.length, 1, "no term sweep when the wildcard works");
  } finally {
    fetchStub.restore();
  }
});

test("fetchIgnMarkers sweeps terms when the wildcard stops matching", async () => {
  const fetchStub = installFetch(({ body }) => {
    if (body.variables.terms === "%") {
      return jsonResponse({ data: { mapGenieSearch: { markers: [] } } });
    }
    return jsonResponse({
      data: {
        mapGenieSearch: {
          markers: [
            marker({ markerSlug: "1", markerName: "Ammo Box" }),
            marker({ markerSlug: "2", typeSlug: "954", markerName: "Extraction" }),
          ],
        },
      },
    });
  });

  try {
    const markers = await fetchIgnMarkers("escape-from-tarkov", "reserve");
    const terms = fetchStub.calls.map((call) => call.body.variables.terms);

    assert.deepEqual(
      markers.map((entry) => entry.markerSlug).sort(),
      ["1", "2"]
    );
    assert.equal(terms[0], "%");
    assert.ok(terms.length > 1, "falls back to a term sweep");
  } finally {
    fetchStub.restore();
  }
});

test("searchIgnMarkers surfaces GraphQL errors", async () => {
  const fetchStub = installFetch(() =>
    jsonResponse({ errors: [{ message: "Cannot query field \"lat\"" }] })
  );

  try {
    await assert.rejects(
      () => searchIgnMarkers("escape-from-tarkov", "reserve", "%"),
      /Cannot query field/
    );
  } finally {
    fetchStub.restore();
  }
});
