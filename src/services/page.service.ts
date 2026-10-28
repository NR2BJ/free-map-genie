import { createService, type ProxyInstance } from "@/common/messaging";
import { getPageType } from "@/common/mapgenie";
import { diagnosticMapUrl } from "@/common/diagnostics";

import type { Bookmark, ImageUrl } from "@/common/bookmark";
import type { Page } from "@/contexts/page/pages/page";

type PartialBookmark = {
  title: string | null;
  url: string | null;
  preview: ImageUrl | null;
  icon?: ImageUrl | null;
};

const validateBookmark: (
  bookmark: PartialBookmark
) => asserts bookmark is Omit<Bookmark, "pageType" | "createdAt"> = (
  bookmark
) => {
  const missing = Object.entries(bookmark)
    .filter(([name, element]) => name !== "icon" && !element)
    .map(([name]) => name)
    .join(", ");

  if (missing) {
    logger.error(
      "Missing required meta tags for bookmark creation, missing: " + missing,
      window.location.href
    );

    throw new Error(
      "Missing required meta tags for bookmark creation, missing: " + missing
    );
  }
};

const getPageInfoFromHead = (): PartialBookmark => {
  const urlMeta = document.head.querySelector<HTMLMetaElement>(
    "meta[property='og:url']"
  );

  const iconLink = document.head.querySelector<HTMLLinkElement>(
    "link[rel='apple-touch-icon']"
  );

  const titleMeta = document.head.querySelector<HTMLMetaElement>(
    "meta[property='og:title']"
  );

  const imageMeta = document.head.querySelector<HTMLMetaElement>(
    "meta[property='og:image']"
  );

  return {
    url: urlMeta?.content || window.location.href,
    title: titleMeta?.content || document.title || null,
    preview: imageMeta?.content || null,
    icon: iconLink?.href || undefined,
  };
};

const getPreviewForMap = (preview: ImageUrl | null): ImageUrl | null => {
  // Current map pages no longer include the full game's map list.
  if ((window.mapData?.maps?.length ?? 0) <= 1) {
    return preview;
  }

  const map = window.mapData!.map;
  const game = window.game;
  if (!game || !map) return preview;
  const url = `https://cdn.mapgenie.io/images/games/${game.slug}/maps/${map.slug}.jpg`;

  const fallback = typeof preview === "string" ? preview : preview?.fallback;

  return fallback ? { url, fallback } : null;
};

export interface PageState {
  failed: boolean;
  page: Page;
}

export class PageService {
  private readonly failed: boolean;
  private readonly page: Page;

  constructor({ failed, page }: PageState) {
    this.failed = failed;
    this.page = page;
  }

  public async createBookmark(): Promise<Bookmark> {
    if (this.failed) {
      throw new Error("Page script failed to initialize");
    }

    let { url, title, preview, icon } = getPageInfoFromHead();

    const params = new URLSearchParams(window.location.search);
    const fmgMapId = params.get("fmgMapId");

    const mapId = fmgMapId ?? window.mapData?.map.id;

    // Fetch map data if mapId is available
    if (mapId) {
      // Validate map ID matches
      const map = window.mapData?.map;
      if (!map) throw new Error("Map data is not ready for bookmarking");
      if (mapId != map.id) {
        throw new Error("Map ID mismatch");
      }

      const game = window.game;

      preview = getPreviewForMap(preview);

      if (game && game.title !== map.title) {
        title = game.title + " | " + map.title;
      } else {
        title = game?.title || map.title;
      }
    }

    // Append fmgMapId to URL if present
    if (fmgMapId) {
      const bookmarkUrl = new URL(url!, window.location.href);
      bookmarkUrl.searchParams.set("fmgMapId", fmgMapId);
      url = bookmarkUrl.href;
    }

    const bookmark = { url, preview, title, icon };
    validateBookmark(bookmark);

    const pageType = await getPageType();

    return {
      ...bookmark,
      pageType: pageType,
      createdAt: new Date().toISOString(),
    };
  }

  public async getInfo(): Promise<Record<string, any>> {
    if (this.failed) {
      return {
        state: "crashed",
      };
    }

    const info = await this.page.info();
    return {
      pageType: await getPageType(),
      state: "running",
      ...info,
    };
  }

  public async ping() {
    return "pong";
  }

  public getDiagnostics() {
    return {
      mapUrl: diagnosticMapUrl(window.location.href),
      mapId: window.mapData?.map.id ?? null,
      gameId: window.game?.id ?? null,
      state: this.failed ? "failed" : "running",
    };
  }

  public reloadMap() {
    if (!window.mapData?.map) throw new Error("No map is connected");
    // Respond to the caller before the page's messaging context disappears.
    setTimeout(() => window.location.reload(), 150);
  }

  public async getPageType() {
    return getPageType();
  }
}

const pageService = createService({
  context: PageService,
  namespace: "PageService",
  heartbeatTimeout: import.meta.env.SERVICE_TIMEOUT,
});

namespace pageService {
  export type Instance = ProxyInstance<typeof PageService>;
}

export default pageService;
