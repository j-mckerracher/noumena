<script lang="ts">
  let { detail }: { detail: unknown } = $props();
  type Diff = { blockId?: string; role?: string; kind?: string; beforeText?: string; afterText?: string };
  let diffs = $derived(((detail as { blockDiffs?: Diff[] })?.blockDiffs ?? []) as Diff[]);
</script>

<div class="section">
  <h3>Block diff</h3>
  {#if !diffs.length}
    <div class="empty">No block diffs available.</div>
  {:else}
    {#each diffs as d}
      <div style="margin-bottom: 16px;">
        <div style="font-size: 11px; color: var(--text-muted);">{d.role ?? ""} · {d.blockId ?? ""} · {d.kind ?? ""}</div>
        <div class="diff">
          {#if d.beforeText}<div class="del">{d.beforeText}</div>{/if}
          {#if d.afterText}<div class="add">{d.afterText}</div>{/if}
        </div>
      </div>
    {/each}
  {/if}
</div>
