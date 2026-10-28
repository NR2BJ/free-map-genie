export interface PageAccount {
  id: number;
  name?: string;
}

export function getPageAccount(user: unknown): PageAccount | null | undefined {
  if (user === null) return null;
  if (!user || typeof user !== "object") return undefined;
  const value = user as { id?: unknown; realId?: unknown; username?: unknown };
  const id = value.realId ?? value.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 0) {
    return undefined;
  }
  return { id, name: typeof value.username === "string" ? value.username : undefined };
}

export async function waitForPageAccount(timeout = 10000) {
  const deadline = Date.now() + timeout;
  do {
    const account = getPageAccount(window.user);
    if (account !== undefined) return account;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  return undefined;
}

export async function fetchAccountName() {
  const link = document.querySelector<HTMLAnchorElement>('a[href$="/account"]');
  if (!link || new URL(link.href).origin !== location.origin) return undefined;
  const response = await fetch(link.href, {
    credentials: "same-origin",
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return undefined;
  const doc = new DOMParser().parseFromString(await response.text(), "text/html");
  return doc.querySelector(".account-profile-name")?.textContent?.trim() || undefined;
}
