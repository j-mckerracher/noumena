import type { RecentVault } from "../shared/ipcChannels.js";

const MAX_RECENTS = 10;

type Schema = {
  recents: RecentVault[];
};

let storePromise: Promise<{
  get: (k: "recents", d?: RecentVault[]) => RecentVault[];
  set: (k: "recents", v: RecentVault[]) => void;
}> | null = null;

async function getStore() {
  if (storePromise) return storePromise;
  storePromise = (async () => {
    const { default: Store } = await import("electron-store");
    return new Store<Schema>({
      name: "noumena-desktop",
      defaults: { recents: [] },
    }) as never;
  })();
  return storePromise;
}

export async function getRecents(): Promise<RecentVault[]> {
  const s = await getStore();
  return s.get("recents", []);
}

export async function recordRecent(path: string): Promise<void> {
  const s = await getStore();
  const existing = s.get("recents", []).filter((r) => r.path !== path);
  existing.unshift({ path, lastOpenedAt: new Date().toISOString() });
  s.set("recents", existing.slice(0, MAX_RECENTS));
}

export async function forgetRecent(path: string): Promise<void> {
  const s = await getStore();
  s.set("recents", s.get("recents", []).filter((r) => r.path !== path));
}
