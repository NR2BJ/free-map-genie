import { IntegratedComponent } from "@/common/ui/integrated";
import { MapInfo } from "@/common/mapgenie/mapInfo";
import { OnStateUpdate } from "../../hooks/onStateUpdateHook";

export class TotalProgress extends IntegratedComponent<TotalProgress.Props> {
  constructor(props?: TotalProgress.Props) {
    super(props ?? { total: 0, found: 0 });
  }

  public render() {
    const { total, found } = this.props;

    const percent = total > 0 ? Math.min((found / total) * 100, 100) : 100;

    return (
      <>
        <OnStateUpdate onUpdate={(state) => this.updateFromState(state)} />
        <div
          className="progress-item-wrapper"
          style={{
            marginRight: "10px",
            background: "transparent",
          }}
        >
          <div className="progress-item" style={{ cursor: "default" }}>
            <span className="title">{percent.toFixed(2) + "%"}</span>
            <span className="counter">
              {found} / {total}
            </span>
            <div className="progress-bar-container">
              <div
                className="progress-bar"
                role="progressbar"
                style={{ width: percent + "%" }}
              ></div>
            </div>
          </div>
        </div>
        <hr />
      </>
    );
  }

  public shouldUpdate(nextProps: TotalProgress.Props) {
    return (
      this.props.total !== nextProps.total ||
      this.props.found !== nextProps.found
    );
  }

  public async mount() {
    await super.mount(".category-progress", "before");
  }

  public updateFromState(state: MG.State) {
    const currentMapMarkers = (window.mapData?.locations ?? []).filter(
      (location) => MapInfo.isMarker(location)
    );
    const foundLocations = state.user.foundLocations ?? {};

    const total = currentMapMarkers.length;
    const found = currentMapMarkers.filter(
      (location) => foundLocations[location.id]
    ).length;

    this.update({ total, found });
  }
}

namespace TotalProgress {
  export interface Props {
    total: number;
    found: number;
  }
}
