<script lang="ts">
  import { toasts } from "../lib/stores";
</script>

<div class="toast-wrap">
  {#each $toasts as t (t.id)}
    <div class="toast {t.level}">{t.message}</div>
  {/each}
</div>
