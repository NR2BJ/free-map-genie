import "@/common/messaging/contexts/background";

import { createOffscreenDocument } from "./offscreen";
import { Rules } from "./rules";

import testService from "@/services/test.service";
import mapgenieService from "@/services/mapgenie.service";
import backgroundService from "@/services/background.service";
import { backgroundLoggerService } from "@/services/logger.service";
import { ExtensionSettings } from "@/common/extension/settings";

export default defineBackground(async () => {
  testService.provide();
  mapgenieService.provide();
  backgroundService.provide();
  backgroundLoggerService.provide();

  // Firefox MV3 treats host permissions as opt-in: without them content scripts
  // stay silent and declarativeNetRequest rules do not apply, which looks like
  // a dead extension rather than a permissions problem.
  try {
    const granted = await browser.permissions?.contains({
      origins: [
        "*://mapgenie.io/*",
        "*://cdn.mapgenie.io/*",
        "*://mollusk.apis.ign.com/*",
      ],
    });
    if (granted === false) {
      logger.warn(
        [
          "Site access is not granted for mapgenie.io.",
          "Enable it in about:addons → Free Map Genie → Permissions,",
          "otherwise map pages and premium marker recovery cannot work.",
        ].join(" ")
      );
    }
  } catch (error) {
    logger.debug("Permission check is unavailable in this browser.", error);
  }

  const rulesManager = new Rules();

  if (await ExtensionSettings.enabled.getValue()) {
    await rulesManager.enable();
  }
  await createOffscreenDocument();

  logger.log("Hello background!", { id: browser.runtime.id });
});
