# FMG 3.0.0 Release Assets

## Files

- `fmg-3.0.0-chrome.zip`
  - Upload this ZIP to the Chrome Web Store Developer Dashboard.
  - For manual testing, unzip it and load the folder from `chrome://extensions` with Developer mode enabled.

- `fmg-3.0.0-firefox-unsigned.xpi`
  - Upload this XPI to AMO Developer Hub for signing.
  - Choose listed distribution if you want it on addons.mozilla.org.
  - Choose unlisted/self-distribution if you want to host the signed XPI yourself, for example on GitHub Releases.
  - It is not signed by Mozilla. Normal Firefox release builds may reject it.
  - After AMO signing, replace this with the signed XPI from Mozilla before publishing it as a direct-install GitHub release asset.

## Notes

- Firefox direct installation outside temporary debugging normally requires Mozilla signing.
- Chrome direct installation from GitHub is not the normal user path. Use Chrome Web Store for ordinary users, or provide the ZIP for developer-mode loading.
- The Firefox manifest includes the stable add-on ID `free-map-genie-nr2bj@nr2bj.github.io`, which is unique to the NR2BJ fork for AMO signing.
