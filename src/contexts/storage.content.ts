import "@/common/messaging/contexts/port";

import storageService from "@/services/storage.service";

/**
 * This script provides the storage service.
 * To access localstorage for a given domain.
 */

export default defineContentScript({
  matches: ["<mapgenie_domains>"],
  runAt: "document_start",
  allFrames: true,
  main() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("fmgStorage")) return;

    storageService.provide(window.location.host);

    // Stop further loading of this frame
    // This frame is only used to provide storage access
    window.stop();
  },
});
