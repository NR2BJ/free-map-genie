import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BrowserContext,
  chromium,
  firefox,
  StorageState,
} from "@playwright/test";
import { withExtension } from "playwright-webextext";

import {
  setFirefoxExtensionInfo,
  resolveFirefoxExtensionInfo,
} from "./firefox";

const EXTENSION_PROTOCOLS = ["chrome-extension://", "moz-extension://"];

export interface LaunchOptions {
  headless: boolean;
  extensionPath: string;
  firefoxDebugPort?: number | null;
}

export const wait = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

export const isExtensionUrl = (url: string) => {
  return EXTENSION_PROTOCOLS.some((protocol) => url.startsWith(protocol));
};

export const launchChromium = async ({
  headless,
  extensionPath,
}: LaunchOptions) => {
  const browserType = withExtension(chromium, extensionPath);

  const context = await browserType.launchPersistentContext("", {
    headless,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  return [context, ""] as const;
};

export const launchFirefox = async ({
  headless,
  firefoxDebugPort,
  extensionPath,
}: LaunchOptions) => {
  if (!firefoxDebugPort) {
    throw new Error("Firefox debugging port not initialized");
  }

  const browserType = withExtension(firefox, extensionPath);

  const userDataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "fmg-"));

  const context = await browserType.launchPersistentContext(userDataDir, {
    headless,
    args: ["--start-debugger-server", String(firefoxDebugPort)],
  });

  const info = await resolveFirefoxExtensionInfo(
    extensionPath,
    firefoxDebugPort
  );
  setFirefoxExtensionInfo(context, info);

  return [context, userDataDir] as const;
};

type StorageStateData = Exclude<StorageState, string | undefined>;
type StorageStateInput = string | Partial<StorageStateData> | undefined;

export const resolveStorageState = async (
  storageState: StorageStateInput
): Promise<Partial<StorageStateData>> => {
  if (storageState === undefined) return {};

  if (typeof storageState === "string") {
    const data = await fs.promises.readFile(storageState, "utf-8");
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid storage state in "${storageState}": expected an object`);
    }
    return parsed as Partial<StorageStateData>;
  } else {
    return storageState;
  }
};

export const loadStorageState = async (
  context: BrowserContext,
  storageState: StorageStateInput
) => {
  const resolvedState = await resolveStorageState(storageState);

  if (resolvedState.cookies) {
    await context.addCookies(resolvedState.cookies);
  }

  if (resolvedState.origins) {
    await context.addInitScript((origins) => {
      const { localStorage } =
        origins.find((origin) => origin.origin === window.location.origin) ||
        {};
      if (localStorage) {
        localStorage.forEach(({ name, value }) => {
          window.localStorage.setItem(name, value);
        });
      }
    }, resolvedState.origins);
  }
};

export const extendStorageState = async (
  storageState: StorageState,
  additionalState: StorageStateInput
): Promise<StorageState> => {
  const resolvedState = await resolveStorageState(storageState);
  const resolvedAdditionalState = await resolveStorageState(additionalState);

  const filteredCookies = resolvedAdditionalState.cookies
    ? resolvedAdditionalState.cookies.filter((additionalCookie) => {
        return !resolvedState.cookies?.some(
          (cookie) =>
            cookie.name === additionalCookie.name &&
            cookie.domain === additionalCookie.domain
        );
      })
    : [];

  const filteredOrigins = resolvedAdditionalState.origins
    ? resolvedAdditionalState.origins.filter((additionalOrigin) => {
        return !resolvedState.origins?.some(
          (origin) => origin.origin === additionalOrigin.origin
        );
      })
    : [];

  const additionalCookies = resolvedState.cookies ?? [];
  const additionalOrigins = resolvedState.origins ?? [];

  return {
    cookies: [...filteredCookies, ...additionalCookies],
    origins: [...filteredOrigins, ...additionalOrigins],
  };
};
