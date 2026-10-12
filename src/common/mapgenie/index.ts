import { waitForBody } from "@/common/dom";
import {
  getReadyScriptUrl,
  isMapgenieScript,
  type MapgenieScriptName,
} from "./scriptUrl";

export { default as MapgenieAdBlocker } from "./ads";

export * from "./page";
export * from "./links";
export * as mapDataUtils from "./data";

/**
 * This function reloads a blocked mapgenie script.
 * The background script blocks certain mapgenie scripts from loading.
 * We simply append ready to the script URL and re-insert it into the DOM.
 * The background script will allow it to load this time.
 */
export const activateBlockedMapgenieScript = async (name: MapgenieScriptName) => {
  await waitForBody();

  const ogScript = Array.from(
    document.querySelectorAll<HTMLScriptElement>("script[src]")
  ).find((script) => isMapgenieScript(script.src, name));

  if (!ogScript) {
    return false;
  }

  const src = getReadyScriptUrl(ogScript.src);

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Failed to load MapGenie script: ${src}`)),
      { once: true }
    );

    document.body.appendChild(script);
  });

  return true;
};

export const getAuthToken = () => {
  return (
    document.querySelector<HTMLMetaElement>('meta[name="auth-token"]')
      ?.content || null
  );
};

export const setAuthToken = (token: string | null) => {
  let authToken = document.querySelector<HTMLMetaElement>(
    'meta[name="auth-token"]'
  );
  if (!authToken) {
    authToken = document.createElement("meta");
    authToken.name = "auth-token";
    document.head.appendChild(authToken);
  }
  authToken.content = token || "";
};
