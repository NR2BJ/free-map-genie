# Free Map Genie 3.0.16 (NR2BJ)

Restores premium map markers, which MapGenie stopped sending to sessions without a PRO entitlement.

## Fixes

- Recover premium-map markers (Reserve, Lighthouse, Streets, Ground Zero, Icebreaker) from the public IGN wikimaps GraphQL API after `/games/{id}/full` started returning empty `locations` arrays.
- Query `mapGenieSearch` with a `%` term and over-fetch `lat`/`lng`, which returns the complete marker set in MapGenie's own coordinate space.
- Fill the map's categories before `selectMapFromGame` validates them, so the existing `?fmgMapId=<id>` map switch renders premium maps again.

## Validation

- Marker totals and per-category counts match MapGenie's own `locations_count` and `proCategoryLocationCounts` exactly on all 12 Escape From Tarkov maps (Reserve 1337, Streets 2103, Lighthouse 1209, Ground Zero 515, Icebreaker 201; free maps unchanged).
- Verified in Chromium with the packaged extension and a free account: Reserve and Streets render with full marker sets and correct tracking denominators (1324 / 1981).
- `yarn compile`, `yarn build`, `yarn build:firefox` pass; new marker unit tests pass.
- The signed Firefox payload matches the prepared build except for signature files and directory entries.

## Known limitations

- Premium markers carry name, category and coordinates only; descriptions, media and tags are not part of the IGN response.
- The IGN endpoint rejects non-browser user agents, so recovery runs from the extension context.

## Installation

- Chrome / Edge / Chromium: extract `fmg-3.0.16-chrome.zip` and update/reload the unpacked extension.
- Firefox: install the Mozilla-signed `fmg-3.0.16-firefox.xpi` over the existing installation.
- Premium maps open through the existing map switch, for example `https://mapgenie.io/tarkov/maps/customs?fmgMapId=75` (Reserve) or `?fmgMapId=64` (Streets). The sidebar `[PRO]` map links already point there.
- Refresh map and guide tabs after updating. Local-only storage and the Firefox add-on ID are unchanged.

## SHA-256

```text
04983e7007ff7ecb63902b550357c2f17f9fb0561e30edc7f836e1e49ec709a4  fmg-3.0.16-chrome.zip
6f91a6458835fd07b5de1fb6b817665eb2056850d1f7be61790be91daa01dc34  fmg-3.0.16-firefox.xpi
883bf507a42146a707d2d87b3f8222b6dd55aeb414d5d3d1f6dc2f53c758d7f0  fmg-3.0.16-sources.zip
```

# Free Map Genie 3.0.15 (NR2BJ)

Fixes a save-restoration regression introduced in 3.0.14, investigated following [issue #3](https://github.com/NR2BJ/free-map-genie/issues/3).

## Fixes

- Preserve saved found-location records while marker data is still loading. Previously, an initially empty marker list could filter out every record, making progress appear to reset to zero after refresh.
- Restore only locations belonging to the loaded map once runtime data is ready. An explicitly empty runtime map does not inherit stale page markers.
- Update found counts before synchronizing the shared location object, avoiding missed counter updates. Repeated restoration does not double-count locations.
- Persisted records, including records loaded after JSON import, use the corrected restoration path. No save-format change, deletion, or data reset is required.

## Validation

- Reproduced the delayed-marker failure in local regression tests before fixing it.
- All 83 automated tests and the TypeScript check pass, including delayed loading, repeated initialization, legacy map-state fields, shared objects, and empty maps.
- Both browser builds completed. The signed Firefox payload matches the prepared build except for signature files and manifest formatting.
- Confirmation from the original reporter is still pending. Tests do not establish whether that user's records were actually deleted.

## Installation

- Chrome / Edge / Chromium: extract `fmg-3.0.15-chrome.zip` and update/reload the unpacked extension.
- Firefox: install the Mozilla-signed `fmg-3.0.15-firefox.xpi` over the existing installation.
- Refresh map and guide tabs after updating. Export a JSON backup where possible; do not clear site data to apply this fix.
- Local-only storage and the Firefox add-on ID are unchanged. No cloud synchronization is added.

## SHA-256

```text
24696f04f3f90e10596647fc35b045fe75c005587c9f9a235f949877ead13ba4  fmg-3.0.15-chrome.zip
aa1f03d6d89b14b645e109dd5c3ca26cfdf73e8e8fd051fd095c4d1ef71600de  fmg-3.0.15-firefox.xpi
```
