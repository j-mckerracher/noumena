<script lang="ts">
  import type { DocHtmlPayload } from "../../shared/ipcChannels";
  let { payload }: { payload: DocHtmlPayload | null } = $props();
</script>

{#if !payload}
  <div class="empty">Select a document to preview.</div>
{:else if payload.validationErrors.length}
  <div class="section">
    <h3 style="color: var(--danger);">Document is not patchable</h3>
    <ul>
      {#each payload.validationErrors as err}
        <li><strong>{err.code}</strong> — {err.message}</li>
      {/each}
    </ul>
  </div>
{:else if payload.html}
  <div class="doc-view-wrap">{@html payload.html}</div>
{:else}
  <div class="empty">No renderable content.</div>
{/if}
