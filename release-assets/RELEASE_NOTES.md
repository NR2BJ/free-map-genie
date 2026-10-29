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
