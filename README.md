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

## Credits

Original project: [V1P3R-FMG/free-map-genie](https://github.com/V1P3R-FMG/free-map-genie)

Chrome compatibility patch reference: [HicH987/free-map-genie](https://github.com/HicH987/free-map-genie)
