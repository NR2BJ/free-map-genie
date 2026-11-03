# FMG 3.0.17 Release Assets

## Files

- `fmg-3.0.17-chrome.zip`
  - Upload this ZIP to the Chrome Web Store Developer Dashboard.
  - For manual testing, unzip it and load the folder from `chrome://extensions` with Developer mode enabled.

- `fmg-3.0.17-firefox.xpi`
  - Mozilla-signed Firefox package (`yarn sign:firefox`).
  - Uses the fork-specific add-on ID `free-map-genie-nr2bj@nr2bj.github.io`.

- `fmg-3.0.17-sources.zip`
  - Source archive for the AMO review form; the shipped bundle is minified.

- `SHA256SUMS.txt`
  - Checksums for the artifacts above.

## Notes

- Firefox direct installation outside temporary debugging requires Mozilla signing; the release XPI is signed.
- Chrome direct installation from GitHub is not the normal user path. Use Chrome Web Store for ordinary users, or provide the ZIP for developer-mode loading.
- The Firefox manifest includes the stable add-on ID `free-map-genie-nr2bj@nr2bj.github.io`, which is unique to the NR2BJ fork for AMO signing.
