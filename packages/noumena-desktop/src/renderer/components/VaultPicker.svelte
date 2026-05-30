<script lang="ts">
  import type { RecentVault } from "../../shared/ipcChannels";
  let { recents, onPick, onSelect }: {
    recents: RecentVault[];
    onPick: () => void;
    onSelect: (path: string) => void;
  } = $props();
</script>

<div class="empty">
  <h1>Noumena</h1>
  <p>Open a vault to begin. The vault must already be initialized with <code>noumena vault init</code>.</p>
  <button onclick={onPick}>Open Vault…</button>
  {#if recents.length}
    <div class="section" style="width: 100%; max-width: 480px;">
      <div class="pane-header" style="position: static; border: none; padding: 8px 0;">Recent</div>
      {#each recents as r}
        <div class="row">
          <button class="btn" style="flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis;" onclick={() => onSelect(r.path)}>{r.path}</button>
        </div>
      {/each}
    </div>
  {/if}
</div>
