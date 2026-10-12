export type MapgenieScriptName = "map" | "TarkovQuestToolWidget";

export const getMapgenieScriptPattern = (name: MapgenieScriptName) =>
  `^https://cdn\\.mapgenie\\.io/js/${name}(\\.[A-Za-z0-9_-]+)?\\.js`;

// RE2-compatible: injected URLs start with ?ready&, never a key=value pair.
export const getBlockedScriptPattern = (name: MapgenieScriptName) =>
  `${getMapgenieScriptPattern(name)}($|\\?[^=&#]+=)`;

export const isMapgenieScript = (src: string, name: MapgenieScriptName) =>
  new RegExp(`${getMapgenieScriptPattern(name)}($|[?#])`).test(src);

export const getReadyScriptUrl = (src: string) => {
  const url = new URL(src);
  url.searchParams.delete("ready");
  url.search = url.search ? `?ready&${url.search.slice(1)}` : "?ready";
  return url.toString();
};
