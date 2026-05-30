<script lang="ts">
  import type { ReviewListItem } from "../../shared/ipcChannels";
  let { reviews, activeId, onSelect, onApprove, onReject }: {
    reviews: ReviewListItem[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onApprove: (id: string) => void;
    onReject: (id: string) => void;
  } = $props();
</script>

{#if !reviews.length}
  <div class="empty">No pending reviews.</div>
{:else}
  <div class="section">
    {#each reviews as r}
      <div class="row" class:selected={activeId === r.reviewId}>
        <button class="btn" style="flex: 1; text-align: left;" onclick={() => onSelect(r.reviewId)}>
          <div style="font-family: ui-monospace, monospace; font-size: 12px;">{r.reviewId}</div>
          <div style="font-size: 11px; color: var(--text-muted);">queued {r.createdAt}</div>
        </button>
        <button class="btn primary" onclick={() => onApprove(r.reviewId)}>Approve</button>
        <button class="btn danger" onclick={() => onReject(r.reviewId)}>Reject</button>
      </div>
    {/each}
  </div>
{/if}
