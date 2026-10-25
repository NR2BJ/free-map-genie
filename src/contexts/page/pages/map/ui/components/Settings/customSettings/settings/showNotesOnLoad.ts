import { CustomSetting, type StorageEntry } from "../customSetting";

export class ShowNotesOnLoadSetting extends CustomSetting {
  public readonly label = "Show Notes on Load";

  private setting!: StorageEntry<boolean>;

  public get enabled() {
    return this.setting?.value === true;
  }

  public async init() {
    const gameId = await this.waitForGameId();
    this.setting = this.StorageEntry.get<boolean>(
      ["game", gameId],
      "show_notes_on_load"
    );
    await this.waitForStore();
  }

  public async load() {
    if (!this.enabled) return;

    await this.waitForMapLoaded();
    this.showNotes();
  }

  private showNotes() {
    if (!this.enabled || !window.user || this.getState().user.notesShown) return;

    // The native action updates both map layers and the Notes button.
    this.store.dispatch({
      type: "MG:USER:SHOW_NOTES",
      meta: { visible: true },
    });
  }

  protected enable(): void {
    this.setting.value = true;
    this.showNotes();
  }

  protected disable(): void {
    // Disable automatic showing, without changing the user's current view.
    this.setting.value = null;
  }
}
