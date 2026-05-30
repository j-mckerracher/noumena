<script lang="ts">
  import type { FileTreeNode } from "../../shared/ipcChannels";
  import Self from "./FileTree.svelte";
  let { node, selected, onSelect, depth = 0 }: {
    node: FileTreeNode;
    selected: string | null;
    onSelect: (path: string) => void;
    depth?: number;
  } = $props();
</script>

<div class="tree">
  {#if node.kind === "file"}
    <div
      class="tree-node"
      class:selected={selected === node.relPath}
      onclick={() => onSelect(node.relPath)}
      role="treeitem"
      aria-selected={selected === node.relPath}
      tabindex="0"
      onkeydown={(e) => e.key === "Enter" && onSelect(node.relPath)}
    >
      {#each Array(depth) as _}<span class="indent"></span>{/each}
      <span class="icon">📄</span>{node.name}
    </div>
  {:else}
    {#if depth > 0}
      <div class="tree-node" style="font-weight: 600;">
        {#each Array(depth - 1) as _}<span class="indent"></span>{/each}
        <span class="icon">📁</span>{node.name}
      </div>
    {/if}
    {#each node.children ?? [] as child}
      <Self node={child} {selected} {onSelect} depth={depth + 1} />
    {/each}
  {/if}
</div>
