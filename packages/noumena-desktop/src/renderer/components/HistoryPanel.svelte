<script lang="ts">
  import type { HistoryItem } from "../../shared/ipcChannels";
  let { items }: { items: HistoryItem[] } = $props();
</script>

<div class="section">
  {#if !items.length}
    <div class="empty">No history yet.</div>
  {:else}
    {#each items as h}
      <div class="history-item">
        <div class="kind">{h.eventType}</div>
        <div class="ts">{h.timestamp}</div>
        {#if h.patchId}<div style="font-family: ui-monospace, monospace; font-size: 11px;">{h.patchId}</div>{/if}
      </div>
    {/each}
  {/if}
</div>
