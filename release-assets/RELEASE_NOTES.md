# Free Map Genie 3.0.17 (NR2BJ)

Fixes premium-map marker recovery on Firefox, where the extension's own request to the IGN API was blocked.

## Fixes

- Fetch premium markers in the page context instead of the content-script backend. Firefox MV3 host permissions are opt-in, so a content script has no cross-origin access to `mollusk.apis.ign.com` even when the user granted site access for `mapgenie.io`. Page-origin requests are CORS-allowed by the IGN API, so the map page now fetches the markers itself and hands them to `MapgenieService.fetchMap`.
- Fall back to the backend request when the page-context fetch fails, and report the transport error instead of the generic "no markers" message.
- Stop the map boot from waiting forever on a silent backend RPC: the map-link unlock and remote map-data steps are bounded (8s / 20s) so the map script is always replayed.
- Do not abort the background boot when request rules cannot be installed; log the cause instead. Firefox MV3 now also declares `declarativeNetRequestWithHostAccess`.
- Warn at boot when site access is not granted, instead of looking like a dead extension.
- Log map boot stages and surface map-script failures as an error toast with the script-tag count.

## Validation

- Windows Firefox (temporary 3.0.17 build, free account): `?fmgMapId=986` logs `Fetched 201 premium markers in the page context.`, replays the map script and renders Icebreaker with its full marker set.
- macOS Firefox and Chromium keep working; no permission prompt is required for the IGN host any more.
- `yarn compile`, unit tests (25) and both browser builds pass.

## Installation

- Chrome / Edge / Chromium: extract `fmg-3.0.17-chrome.zip` and update/reload the unpacked extension.
- Firefox: install the Mozilla-signed `fmg-3.0.17-firefox.xpi` over the existing installation.
- Premium maps open through the existing map switch, for example `https://mapgenie.io/tarkov/maps/factory?fmgMapId=986` (Icebreaker).
- Refresh map and guide tabs after updating. Local-only storage and the Firefox add-on ID are unchanged.

## SHA-256

```text
90aaa36886c06a3660dec40e12fff689e6df23f8c123db64562a9ccdae8bdde4  fmg-3.0.17-chrome.zip
018bf277a6461a651d434e77bf261e6f2673c50d3efd1c0b9d715e5ad2106438  fmg-3.0.17-sources.zip
```

