<script lang="ts">
  import { onMount } from "svelte";
  import { api } from "./lib/api";
  import {
    currentVault,
    recents,
    fileTree,
    selectedDoc,
    docHtml,
    docInfo,
    reviews,
    history,
    activeReviewId,
    activeReviewDetail,
    pushToast,
  } from "./lib/stores";
  import VaultPicker from "./components/VaultPicker.svelte";
  import FileTree from "./components/FileTree.svelte";
  import DocView from "./components/DocView.svelte";
  import ReviewQueue from "./components/ReviewQueue.svelte";
  import BlockDiff from "./components/BlockDiff.svelte";
  import HistoryPanel from "./components/HistoryPanel.svelte";
  import RollbackButton from "./components/RollbackButton.svelte";
  import Toast from "./components/Toast.svelte";

  type Tab = "doc" | "review";
  let tab: Tab = $state("doc");

  async function refreshRecents() {
    const r = await api.vault.recents();
    if (r.ok) recents.set(r.data);
  }

  async function refreshTree() {
    const r = await api.tree.list();
    if (r.ok) fileTree.set(r.data);
  }

  async function refreshDoc(docPath: string) {
    const [h, i, rv, hist] = await Promise.all([
      api.doc.html(docPath),
      api.doc.info(docPath),
      api.review.list(docPath),
      api.history.list(docPath),
    ]);
    docHtml.set(h.ok ? h.data : null);
    docInfo.set(i.ok ? i.data : null);
    reviews.set(rv.ok ? rv.data : []);
    history.set(hist.ok ? hist.data : []);
    activeReviewId.set(null);
    activeReviewDetail.set(null);
  }

  async function selectVault(path: string) {
    const r = await api.vault.open(path);
    if (!r.ok) {
      pushToast("error", r.message);
      return;
    }
    currentVault.set(path);
    await refreshTree();
    await refreshRecents();
  }

  async function pickVault() {
    const r = await api.vault.pick();
    if (!r.ok) {
      pushToast("error", r.message);
      return;
    }
    if (!r.data) return;
    currentVault.set(r.data.path);
    await refreshTree();
    await refreshRecents();
  }

  $effect(() => {
    const path = $selectedDoc;
    if (path) refreshDoc(path);
    else {
      docHtml.set(null);
      docInfo.set(null);
      reviews.set([]);
      history.set([]);
    }
  });

  $effect(() => {
    const reviewId = $activeReviewId;
    if (!reviewId) {
      activeReviewDetail.set(null);
      return;
    }
    api.review.show(reviewId).then((r) => {
      if (r.ok) activeReviewDetail.set(r.data);
    });
  });

  onMount(() => {
    refreshRecents();
    const offChanged = api.on.vaultChanged(() => {
      refreshTree();
      const path = getStoreValue(selectedDoc);
      if (path) refreshDoc(path);
    });
    const offOpened = api.on.vaultOpened(({ path }) => {
      currentVault.set(path);
      refreshTree();
      refreshRecents();
    });
    return () => {
      offChanged();
      offOpened();
    };
  });

  function getStoreValue<T>(store: { subscribe: (cb: (v: T) => void) => () => void }): T {
    let val: T;
    const unsub = store.subscribe((v) => (val = v));
    unsub();
    return val!;
  }
</script>

{#if !$currentVault}
  <VaultPicker recents={$recents} onPick={pickVault} onSelect={selectVault} />
{:else}
  <div class="app-shell">
    <aside class="pane">
      <div class="pane-header">{$currentVault}</div>
      {#if $fileTree}
        <FileTree node={$fileTree} selected={$selectedDoc} onSelect={(p) => selectedDoc.set(p)} />
      {/if}
    </aside>

    <section class="pane">
      <div class="tabs">
        <div class="tab" class:active={tab === "doc"} onclick={() => (tab = "doc")} role="tab" tabindex="0" onkeydown={(e) => e.key === "Enter" && (tab = "doc")}>Document</div>
        <div class="tab" class:active={tab === "review"} onclick={() => (tab = "review")} role="tab" tabindex="0" onkeydown={(e) => e.key === "Enter" && (tab = "review")}>
          Reviews{#if $reviews.length}<span class="count">{$reviews.length}</span>{/if}
        </div>
      </div>
      {#if tab === "doc"}
        <DocView payload={$docHtml} />
      {:else}
        <ReviewQueue
          reviews={$reviews}
          activeId={$activeReviewId}
          onSelect={(id) => activeReviewId.set(id)}
          onApprove={async (id) => {
            const r = await api.review.approve(id);
            if (!r.ok) pushToast("error", r.message);
            else pushToast("success", "Review applied");
          }}
          onReject={async (id) => {
            const r = await api.review.reject(id);
            if (!r.ok) pushToast("error", r.message);
            else pushToast("success", "Review rejected");
          }}
        />
        {#if $activeReviewDetail}
          <BlockDiff detail={$activeReviewDetail} />
        {/if}
      {/if}
    </section>

    <aside class="pane">
      <div class="pane-header">History</div>
      <HistoryPanel items={$history} />
      <div class="section">
        <RollbackButton
          history={$history}
          onRollback={async (patchId) => {
            const r = await api.patch.rollback(patchId);
            if (!r.ok) pushToast("error", r.message);
            else {
              const data = r.data as { status?: string };
              if (data.status === "rolled_back") pushToast("success", "Rolled back");
              else pushToast("error", data.status ?? "rollback failed");
            }
          }}
        />
      </div>
    </aside>
  </div>
{/if}

<Toast />
