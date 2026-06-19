# Free Map Genie - NR2BJ Fork

This is a maintained fork of Free Map Genie for the current MapGenie v3 site.

The fork is based on the FMG 3.0.0 beta codebase and includes compatibility fixes for the newer MapGenie page boot flow, Firefox add-on signing requirements, and Chrome/Firefox package builds.

## Status

- MapGenie v3 map pages boot correctly again.
- Pro UI restrictions are unlocked by the extension.
- Saved FMG checklist data is loaded from the local FMG IndexedDB database.
- Chrome and Firefox packages are built from the same source tree.
- Firefox uses a fork-specific add-on ID: `free-map-genie-nr2bj@nr2bj.github.io`.

Tested manually on:

- `https://mapgenie.io/cloudheim/maps/world`

## Downloads

Use the latest GitHub release assets:

- `fmg-3.0.0-chrome.zip` for Chrome / Chromium browsers.
- `fmg-3.0.0-firefox.xpi` for Firefox.

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

## Build

This project uses WXT.

```powershell
node .\node_modules\wxt\bin\wxt.mjs zip -b chrome
node .\node_modules\wxt\bin\wxt.mjs zip -b firefox
```

The build reads MapGenie domains during packaging.

## Credits

Original project: [V1P3R-FMG/free-map-genie](https://github.com/V1P3R-FMG/free-map-genie)

Chrome compatibility patch reference: [HicH987/free-map-genie](https://github.com/HicH987/free-map-genie)
