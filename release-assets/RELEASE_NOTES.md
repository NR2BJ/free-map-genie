# Free Map Genie 3.0.14 (NR2BJ)

Compatibility fixes for current MapGenie map data and guide checklists. This fork remains local-only; no cloud synchronization is added.

## Map Loading and Marker Data

- Update map loading to use map metadata and the game's full data response instead of relying on the older map-full endpoint. Share cached game data between maps and bound network requests with timeouts.
- Validate the requested map, its game, configuration, and marker data before replacing the page's map. Invalid or incomplete responses no longer silently display the original map under the requested map's identity.
- Preserve the loaded marker data when the newer map script makes its initial asynchronous data request, while keeping current response metadata. The override is restricted to that map's initial same-origin read; unrelated requests and writes are untouched.
- Show a recoverable map-load error with Retry and Open Original actions when target-map loading fails. Optional heatmap failures no longer discard an otherwise loaded map.
- Honor tile-coordinate patterns supplied by MapGenie and apply the manual X/Y swap to those patterns as well as fallback patterns.
- Keep an empty map's found count empty instead of inheriting saved locations from other maps. This does not delete the stored records.

## Guide Checklist Tracking

- Fix the guide's 100-location limit when local FMG tracking is available. Local saving is connected before the guide's tracking limit is lifted.
- Wait for the embedded map's account to finish initializing, use the real account ID when available, and await fallback game-ID lookup before installing save handlers. Explicitly signed-out maps do not enable local guide tracking.
- Restore the visible found state after refresh, not just the checkbox value. Current plain table rows, older checklist rows, guide cards, and sort markers are updated together, fixing saved entries that appeared as a red X.
- Keep duplicate entries and map-to-guide updates visually synchronized. Unmarking removes the found entry instead of leaving a false-valued record, and guides without a global tracking helper are supported.
- Add guide initialization and restored-location count logs to make save connection problems easier to identify.

## Development and Validation

- Fix the previously reported TypeScript errors in the e2e helpers, icon-generation options, and root TypeScript configuration. The full TypeScript check now passes.
- Add regression tests for map-response validation, initial data-request handling, guide initialization, tracking beyond 100 locations, visible state restoration, and development helpers.
- All 81 automated tests passed, including isolated browser and IndexedDB tests. Firefox and Edge fixture tests exercised 101 checked locations, refresh restoration, and unmarking.
- A manual Edge test confirmed 170 unique saved guide locations and persistence after refresh. This is not a guarantee for every game or browser configuration.
- Both browser packages built successfully. The signed Firefox package matches the prepared build, except for Mozilla signature files and manifest formatting.

## Updating

- **Chrome / Edge / Chromium:** download `fmg-3.0.14-chrome.zip`, extract it, and update/reload the unpacked extension from the browser's extensions page.
- **Firefox:** install `fmg-3.0.14-firefox.xpi`, signed by Mozilla. Temporary loading is not required.
- After updating the extension, refresh open MapGenie map and guide tabs so they use the new scripts.
- The local save format and Firefox add-on ID are unchanged. No data reset or migration is required. Keep exported JSON backups before updating; clearing site data can remove local saves and recovery points.

## SHA-256

```text
5b07b0756f93882c3f48fb18b5535dfac947aa498adf64f5c995e3b47efca70b  fmg-3.0.14-chrome.zip
4ff5e04745219521e1b2b74c4a78dc7c6f5b4593564cd09df98dec8cc8ef7879  fmg-3.0.14-firefox.xpi
```
