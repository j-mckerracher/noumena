import chokidar, { FSWatcher } from "chokidar";
import { relative, sep } from "node:path";
import type { VaultChangedPayload } from "../shared/ipcChannels.js";

const DEBOUNCE_MS = 150;

export class Watcher {
  private watcher: FSWatcher | null = null;
  private pending = new Map<string, VaultChangedPayload>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly vaultRoot: string,
    private readonly onChange: (payload: VaultChangedPayload) => void,
  ) {}

  start(): void {
    this.watcher = chokidar.watch(this.vaultRoot, {
      ignored: (p) => {
        const rel = relative(this.vaultRoot, p);
        if (!rel) return false;
        const segs = rel.split(sep);
        if (segs[0] === ".noumena" && (segs[1] === "locks" || segs[1] === "logs")) return true;
        if (segs[0] === "node_modules") return true;
        if (segs[0]?.startsWith(".git")) return true;
        return false;
      },
      ignoreInitial: true,
      persistent: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
    });
    this.watcher.on("add", (p) => this.queue(p, "add"));
    this.watcher.on("change", (p) => this.queue(p, "change"));
    this.watcher.on("unlink", (p) => this.queue(p, "unlink"));
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private queue(absPath: string, kind: VaultChangedPayload["kind"]): void {
    const rel = relative(this.vaultRoot, absPath).split(sep).join("/");
    this.pending.set(rel, { path: rel, kind });
    if (this.timer) return;
    this.timer = setTimeout(() => {
      const batch = Array.from(this.pending.values());
      this.pending.clear();
      this.timer = null;
      for (const payload of batch) this.onChange(payload);
    }, DEBOUNCE_MS);
  }
}
