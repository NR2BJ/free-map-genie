import { useAppSelector, useAppDispatch } from "./hooks";
import {
  fetchGamesAsync,
  injectIconFontAsync,
  selectAppLoading,
} from "./store/features/app/appSlice";
import {
  importSelectedSave,
  selectCurrentSave,
  selectNeedsReload,
  selectIsBusy,
  selectSelectedGames,
  setNeedsReload,
} from "./store/features/saves/savesSlice";
import { SidePanel } from "./store/features/saves/sidepanel/SidePanel";
import { SaveView } from "./store/features/saves/view/SaveView";

import style from "./App.module.scss";
import { RecoveryView } from "./RecoveryView";
import pageService from "@/services/page.service";
import { bounded } from "@/common/diagnostics";
import { toastr } from "react-redux-toastr";

function App() {
  const dispatch = useAppDispatch();
  const loading = useAppSelector(selectAppLoading);
  const save = useAppSelector(selectCurrentSave);
  const needsReload = useAppSelector(selectNeedsReload);
  const busy = useAppSelector(selectIsBusy);
  const [recovering, setRecovering] = React.useState(false);
  const selectedGames = useAppSelector(selectSelectedGames);
  const [view, setView] = React.useState<"json" | "recovery">("json");
  const [reloading, setReloading] = React.useState(false);
  const viewRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => { if (viewRef.current) viewRef.current.scrollTop = 0; }, [view]);
  const [sidePanelOpen, setSidePanelOpen] = React.useState(false);

  React.useEffect(() => {
    dispatch(injectIconFontAsync());
    dispatch(fetchGamesAsync());
  }, []);

  const { state: confirmState, open: openConfirm } = useConfirm(
    (accepted) => accepted && dispatch(importSelectedSave())
  );

  async function reloadMap() {
    setReloading(true);
    try {
      await bounded(pageService.use().reloadMap());
      dispatch(setNeedsReload(false));
    } catch { toastr.warning("Map unavailable", "Reload your MapGenie map manually to show the restored data."); }
    finally { setReloading(false); }
  }

  return (
    <ThemeProvider theme="dark">
      <Confirm
        message="Import selected games? This will overwrite all data for all selected games."
        {...confirmState}
      />
      <Loading loading={loading} spinnerSize="2rem" overlay>
        <div className={style.app}>
          <div className={style.panels}>
            <div
              className={clsx(
                style.panel,
                style.sidePanelContainer,
                !sidePanelOpen && style.sidePanelCollapsed
              )}
            >
              <SidePanel />
            </div>
            <Button
              className={clsx(
                style.sidePanelToggle,
                sidePanelOpen
                  ? style.sidePanelToggleOpen
                  : style.sidePanelToggleClosed
              )}
              type="normal"
              onClick={() => setSidePanelOpen((open) => !open)}
            >
              <FontIcon icon={sidePanelOpen ? "caret-left" : "caret-right"} />
            </Button>
            <div className={clsx(style.panel, style.content)}>
              <nav className={style.tabs} aria-label="Data views">
                <button type="button" aria-pressed={view === "json"} disabled={busy || recovering} onClick={() => setView("json")}>JSON files</button>
                <button type="button" aria-pressed={view === "recovery"} disabled={busy || recovering} onClick={() => setView("recovery")}>Recovery points</button>
              </nav>
              <div className={style.view} ref={viewRef}>
                {view === "json" ? <SaveView /> : <RecoveryView onBusy={setRecovering} />}
              </div>
              <div className={style.bottomBar}>
                {needsReload && <Button ariaLabel="Reload map" disabled={busy || recovering || reloading} onClick={reloadMap}><FontIcon icon="reload" /> Reload map</Button>}
                {view === "json" &&
                <Button
                  className={style.iconBtn}
                  type="confirm"
                  ariaLabel="Import"
                  disabled={!save || busy || !Object.keys(selectedGames).length}
                  onClick={openConfirm}
                >
                  <FontIcon icon="upload" />
                  <span>Import</span>
                </Button>
                }
              </div>
            </div>
          </div>
        </div>
      </Loading>
    </ThemeProvider>
  );
}

export default App;
