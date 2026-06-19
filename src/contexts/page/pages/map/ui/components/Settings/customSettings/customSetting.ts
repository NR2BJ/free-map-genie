import { waitForProperty } from "@/common/object";

import { StorageEntry } from "./storageEntry";

export { StorageEntry };

export abstract class CustomSetting {
  public abstract readonly label: string;

  public abstract get enabled(): boolean;

  private _loaded = false;
  private _failed = false;
  private loadedCallbacks = new Set<() => void>();

  protected StorageEntry = StorageEntry;

  protected abstract enable(): void;
  protected abstract disable(): void;

  public abstract init(): Promise<void> | void;
  public abstract load(): Promise<void> | void;

  public constructor() {
    Promise.resolve()
      .then(async () => {
        await this.withTimeout(
          Promise.resolve().then(() => this.init()),
          10000,
          `Initializing setting "${this.label}"`
        );

        if (this.applicable) {
          await this.withTimeout(
            Promise.resolve().then(() => this.load()),
            5000,
            `Loading setting "${this.label}"`
          );
        }
      })
      .catch((error) => {
        this._failed = true;
        console.error("Error initializing setting:", error);
      })
      .finally(() => {
        this.markLoaded();
      });
  }

  public get applicable(): boolean {
    return true;
  }

  public get loaded(): boolean {
    return this._loaded;
  }

  public get failed(): boolean {
    return this._failed;
  }

  public onLoaded(callback: () => void): void {
    if (this._loaded) {
      callback();
    } else {
      this.loadedCallbacks.add(callback);
    }
  }

  public onChange(enabled: boolean) {
    if (enabled) {
      this.enable();
    } else {
      this.disable();
    }
  }

  protected async waitForMapManager() {
    return waitForProperty(window, "mapManager");
  }

  protected async waitForMapLoaded() {
    await this.waitForMapManager();

    if (window.mapManager!.map.loaded()) {
      return;
    }

    return this.withTimeout(
      new Promise<void>((resolve) => {
        window.mapManager!.map.on("load", () => resolve());
        window.mapManager!.map.on("idle", () => resolve());
      }),
      5000,
      "Waiting for MapGenie map load"
    ).catch((error) => {
      logger.warn("Map load event did not arrive before timeout.", error);
    });
  }

  protected async waitForStore() {
    return waitForProperty(window, "store");
  }

  protected get store() {
    return window.store!;
  }

  protected getState() {
    return this.store.getState();
  }

  protected async waitForGameId() {
    await waitForProperty(window, "game");
    return window.game!.id;
  }

  private markLoaded() {
    this._loaded = true;
    this.loadedCallbacks.forEach((callback) => callback());
    this.loadedCallbacks.clear();
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeout: number,
    message: string
  ) {
    let handle: number | undefined;

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      handle = window.setTimeout(
        () => reject(new Error(`${message} timed out after ${timeout}ms.`)),
        timeout
      );
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (handle !== undefined) {
        window.clearTimeout(handle);
      }
    }
  }
}
