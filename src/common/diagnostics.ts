export function bounded<T>(promise: Promise<T>, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

export function diagnosticMapUrl(raw: string) {
  try {
    const url = new URL(raw);
    if (!/^https?:$/.test(url.protocol) || !/^\/[a-z0-9-]+\/maps\/[a-z0-9-]+\/?$/i.test(url.pathname)) return null;
    const mapId = url.searchParams.get("fmgMapId");
    return url.origin + url.pathname + (mapId && /^\d+$/.test(mapId) ? `?fmgMapId=${mapId}` : "");
  } catch { return null; }
}
