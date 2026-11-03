# Free Map Genie - NR2BJ Fork

This is a maintained fork of Free Map Genie for the current MapGenie v3 site.

The fork is based on the FMG 3.0.0 beta codebase and includes compatibility fixes for the newer MapGenie page boot flow, Firefox add-on signing requirements, and Chrome/Firefox package builds.

## Status

- MapGenie v3 map pages boot correctly again.
- Pro UI restrictions are unlocked by the extension.
- Premium map markers (the ones MapGenie no longer sends to non-PRO sessions) are
  recovered from the public IGN wikimaps GraphQL API, see below.
- Saved FMG checklist data is loaded from the local FMG IndexedDB database.
- Chrome and Firefox packages are built from the same source tree.
- Firefox uses a fork-specific add-on ID: `free-map-genie-nr2bj@nr2bj.github.io`.

Tested manually on:

- `https://mapgenie.io/cloudheim/maps/world`
- `https://mapgenie.io/tarkov/maps/customs?fmgMapId=75` (Reserve, 1337 markers)
- `https://mapgenie.io/tarkov/maps/customs?fmgMapId=64` (Streets, 2103 markers)

## Premium Map Markers

MapGenie now strips premium-map markers server side. For a non-PRO session,
`GET /api/v1/maps/{id}/data` returns `locations: []` together with
`proCategoryLocationCounts`, and `/games/{id}/full` returns the map record, tile
sets and categories with empty `locations` arrays. That is why flipping
`window.isPro` no longer reveals the markers: the rows never reach the browser.

The same rows are still public through the IGN wikimaps GraphQL API
(`https://mollusk.apis.ign.com/graphql`). `mapGenieMarkersMultiple` is
paywalled, but `mapGenieSearch` is not, and the `MapMarker` type it returns
exposes `lat` / `lng` through ordinary GraphQL over-fetching:

```graphql
{
  mapGenieSearch(objectSlug: "escape-from-tarkov", mapSlug: "reserve", terms: "%") {
    markers { typeSlug markerSlug markerName lat lng }
  }
}
```

`%` reaches the search resolver as a `LIKE` wildcard, so a single request returns
the complete marker set in MapGenie's own normalized coordinate space
(`markerSlug` is the location ID, `typeSlug` the category ID).

`MapgenieService.fetchMap` fills the empty `locations` arrays from that endpoint
before `selectMapFromGame` validates the map, so the existing `?fmgMapId=<id>`
map switch renders premium maps with their full marker set.

Verified against MapGenie's own counters with `tools/pro-markers.mjs` — marker
totals match `locations_count` and per-category counts match
`proCategoryLocationCounts` exactly for every Escape From Tarkov map:

| Map | Markers | Public API |
| --- | ---: | ---: |
| Factory | 307 | 307 |
| Woods | 809 | 809 |
| Customs | 922 | 922 |
| Interchange | 1215 | 1215 |
| Reserve | 1337 | 0 |
| Shoreline | 1053 | 1053 |
| The Lab | 605 | 605 |
| Lighthouse | 1209 | 0 |
| Streets | 2103 | 0 |
| Ground Zero | 515 | 0 |
| The Labyrinth | 140 | 140 |
| Icebreaker | 201 | 0 |

Limitations: the IGN API exposes marker name, category and coordinates only.
Descriptions, media and tags of premium markers are not part of that response.

Offline export:

```shell
node tools/pro-markers.mjs --map 75
node tools/pro-markers.mjs --game 20 --all
```

Output is written to `research/pro-markers/out/<game>-<map>-<slug>.json` in
MapGenie `/maps/{id}/data` location format.


## Downloads

Use the latest GitHub release assets:

- `fmg-x.y.z-chrome.zip` for Chrome / Chromium browsers.
- `fmg-x.y.z-firefox.xpi` for Firefox.

The Firefox XPI in the release is signed by Mozilla for the fork-specific add-on ID.

## Firefox Notes

The Firefox manifest declares:

```json
{
  "browser_specific_settings": {
    "gecko": {
      "id": "free-map-genie-nr2bj@nr2bj.github.io",
      "data_collection_permissions": {
        "required": ["none"]
      }
    }
  }
}
```

AMO may show warnings such as `Unsafe assignment to innerHTML` or `The Function constructor is eval` for bundled/minified dependency code. The current package passes validation with zero errors; those warnings are not signing blockers.

## Local Data

FMG save data is stored in the MapGenie page's IndexedDB database named `fmg:database`.

Temporary add-on reloads should not erase this data. Clearing site data, using a different Firefox profile/container, or deleting the browser profile can remove or hide it.

## Local Notes Setting

Enable **Show Notes on Load** in the map's SETTINGS section to show notes
automatically after loading a map. The option is off by default and saved
locally per game. Enabling it also shows notes immediately. You can still
hide notes manually during the session; disabling the option only stops
automatic showing on future loads and does not hide the current notes.

This setting does not change note contents or add cloud synchronization.

## Local Data Safety

- The popup footer reports pending, completed, or failed local writes. A failed
  write remains flagged for the current backend session even if later writes succeed.
- The page/info tab provides a diagnostic report with extension/browser versions,
  map identity, storage availability and recent write error codes. It excludes
  account names, tokens, note contents, and arbitrary URL parameters.
- Data Manager's **Recovery points** view keeps up to five recent pre-operation
  snapshots per profile. JSON/account import, clearing map/game data, and restore
  create a snapshot first. If that fails, the destructive operation is cancelled.
  A point being restored is protected from automatic cleanup during that operation.
- Restoring a point replaces the listed games, not other games or profiles.
  Recovery points are local site data, not external backups: clearing site data
  removes them. Keep exported JSON files separately for durable backups.
- After JSON import or recovery, **Reload map** refreshes the connected map.
- Game metadata is cached locally, refreshed after an hour, and concurrent
  requests share one network fetch. Missing JSON note descriptions default to an
  empty string; other invalid fields are still rejected.

## Build

This project uses WXT.

```powershell
node .\node_modules\wxt\bin\wxt.mjs zip -b chrome
node .\node_modules\wxt\bin\wxt.mjs zip -b firefox
```

The build reads MapGenie domains during packaging.

## Packaging and AMO signing

```shell
yarn release:pack     # .output/fmg-<version>-chrome.zip, -firefox.zip, -sources.zip
yarn sign:firefox     # AMO-signed release-assets/fmg-<version>-firefox.xpi
```

`yarn zip:firefox` also emits `fmg-<version>-sources.zip`; upload it as the
source archive when AMO asks how the minified bundle was produced.

Signing needs AMO API credentials from
<https://addons.mozilla.org/developers/addon/api/key/>:

```shell
export WEB_EXT_API_KEY="user:12345678:123"
export WEB_EXT_API_SECRET="..."
yarn sign:firefox
```

`AMO_CHANNEL=listed` submits a public listing; the default `unlisted` channel
self-distributes the signed XPI. The script copies the signed payload to
`release-assets/fmg-<version>-firefox.xpi` and refreshes `SHA256SUMS.txt`.

AMO rejects a version number that was already uploaded, so bump `version` in
`package.json` before signing a new build.

Without signing, `yarn zip`/`yarn zip:firefox` still produce installable test
packages: the Chrome ZIP loads unpacked in `chrome://extensions`, and the
Firefox ZIP can be renamed to `.xpi` but only installs permanently on Firefox
Developer Edition/Nightly with `xpinstall.signatures.required=false`, or as a
temporary add-on via `about:debugging`.

### Windows / fresh clone

The repository is self-contained: `yarn install` (Node 20, see `.nvmrc`) is all
that is needed, and `tools/sign-firefox.mjs` handles the `npx.cmd` invocation on
Windows.

```powershell
git clone https://github.com/NR2BJ/free-map-genie.git
cd free-map-genie
yarn install
yarn build            # .output/chrome-mv3
yarn build:firefox    # .output/firefox-mv3
yarn zip; yarn zip:firefox
$env:WEB_EXT_API_KEY="user:12345678:123"
$env:WEB_EXT_API_SECRET="..."
yarn sign:firefox     # release-assets/fmg-<version>-firefox.xpi + SHA256SUMS.txt
```

Built packages, `research/` dumps and `node_modules/` stay untracked; release
binaries live on the GitHub release for their tag.

## Credits

Original project: [V1P3R-FMG/free-map-genie](https://github.com/V1P3R-FMG/free-map-genie)

Chrome compatibility patch reference: [HicH987/free-map-genie](https://github.com/HicH987/free-map-genie)
