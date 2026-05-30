<script lang="ts">
  import type { HistoryItem } from "../../shared/ipcChannels";
  let { history, onRollback }: {
    history: HistoryItem[];
    onRollback: (patchId: string) => void;
  } = $props();
  let latestApplied = $derived(
    history.find((h) => h.eventType === "patch_applied" || h.eventType === "review_approved"),
  );
</script>

<button
  class="btn"
  disabled={!latestApplied?.patchId}
  onclick={() => latestApplied?.patchId && onRollback(latestApplied.patchId)}
>
  Rollback latest patch
</button>
