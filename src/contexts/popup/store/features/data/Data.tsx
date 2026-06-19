import { useAppSelector, useAppDispatch } from "@/contexts/popup/hooks";
import {
  fetchDataStatusAsync,
  fetchPageTypeAsync,
  openDataManagerAsync,
  importFromMapgenieAccountAsync,
  clearMapDataAsync,
  clearGameDataAsync,
  exportUserDataAsync,
  exportGameDataAsync,
  isBusy,
  isMapgenieLoggedIn,
  hasActiveProfile,
  getPageType,
} from "./dataSlice";
import { DataAction } from "./DataAction";

import style from "./Data.module.scss";

export const Data = ({}: Data.Props) => {
  const dispatch = useAppDispatch();
  const busy = useAppSelector(isBusy);
  const mapgenieLoggedIn = useAppSelector(isMapgenieLoggedIn);
  const fmgProfileAvailable = useAppSelector(hasActiveProfile);
  const pageType = useAppSelector(getPageType);

  const isMap = pageType === "map";
  const isGuide = pageType === "guide";
  const hasPageClient = fmgProfileAvailable && (isGuide || isMap);

  const importFromAccountEnabled = mapgenieLoggedIn && hasPageClient;
  const exportUserEnabled = fmgProfileAvailable;
  const exportGameEnabled = hasPageClient;
  const clearMapEnabled = fmgProfileAvailable && isMap;
  const clearGameEnabled = hasPageClient;

  React.useEffect(() => {
    dispatch(fetchDataStatusAsync());
    dispatch(fetchPageTypeAsync());
  }, []);

  const onOpenDataManager = () => {
    dispatch(openDataManagerAsync());
  };

  return (
    <Loading loading={busy} overlay spinnerSize="2rem">
      <div className={style.data}>
        <Button
          className={style.btn}
          onClick={onOpenDataManager}
          disabled={!fmgProfileAvailable}
        >
          <FontIcon icon="open-new-tab" className={style.icon} />
          <span>Open data manager</span>
        </Button>
        <DataAction
          message="Import data from your Mapgenie account? This will overwrite your current game data."
          text="Import from Mapgenie account"
          icon="person-import"
          action={importFromMapgenieAccountAsync}
          disabled={!importFromAccountEnabled}
        />
        <DataAction
          message="Export all games for the current user?"
          text="Export all games"
          icon="download"
          action={exportUserDataAsync}
          disabled={!exportUserEnabled}
        />
        <DataAction
          message="Export data for the current game?"
          text="Export current game"
          icon="download"
          action={exportGameDataAsync}
          disabled={!exportGameEnabled}
        />
        <DataAction
          message="Clear all locations for the current map? This action cannot be undone."
          text="Clear current map"
          type="cancel"
          icon="trash"
          action={clearMapDataAsync}
          disabled={!clearMapEnabled}
        />
        <DataAction
          message="Clear all data for the current game? This action cannot be undone."
          text="Clear current game"
          type="cancel"
          icon="trash"
          action={clearGameDataAsync}
          disabled={!clearGameEnabled}
        />
      </div>
    </Loading>
  );
};

namespace Data {
  export interface Props {}
}
