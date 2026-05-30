/**
 * Tests for patch evaluation engine.
 *
 * AC-007: Conflict tests pass without actual file mutation.
 *
 * Tests cover:
 *   - append_only: ignores stale full revision (emits warning, does not reject)
 *   - replace_requires_clean_base: rejects on block hash mismatch
 *   - manual_review: rejects on block hash mismatch (same as replace_requires_clean_base)
 *   - merge_text: field-level allowlist (set_status, set_metadata only)
 *   - propose_summary: always requires_review
 *   - locked: always rejects with target_block_locked
 *   - Compound patch: atomic rule (any reject → all rejected, any review → all queued)
 *   - clientPatchId idempotency: returns noop already_applied
 *   - Target resolution: by role and by blockId
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  evaluatePatch,
  checkIdempotency,
  resolveTarget,
  buildDocumentState,
} from "../src/evaluatePatch.js";
import type {
  ParsedPatch,
  DocumentState,
  PatchOp,
} from "../src/evaluatePatch.js";
import type { NoumenaBlock, ConflictPolicy } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(overrides: Partial<NoumenaBlock> & { role: string; blockId: string; policy: ConflictPolicy }): NoumenaBlock {
  return {
    element: { tagName: "section", attributes: {}, children: [] },
    blockHash: "sha256:default_hash",
    ...overrides,
  };
}

function makeState(blocks: NoumenaBlock[], revision = "sha256:current_rev"): DocumentState {
  const roleMap = new Map<string, NoumenaBlock>();
  for (const b of blocks) {
    if (!roleMap.has(b.role)) {
      roleMap.set(b.role, b);
    }
  }
  return { revision, blocks, roleMap };
}

function makePatch(overrides: Partial<ParsedPatch> = {}): ParsedPatch {
  return {
    schema: "noumena.patch.v1",
    base: {
      revision: "sha256:current_rev",
      logicalVersion: 1,
      blockHashes: {},
    },
    author: { type: "agent", name: "Test Agent" },
    intent: "Test patch",
    ops: [],
    ...overrides,
  };
}

function appendEvidenceOp(target: PatchOp["target"] = { role: "evidence" }): PatchOp {
  return {
    op: "append_evidence",
    target,
    item: { claim: "Test claim" },
  };
}

function appendNoteOp(target: PatchOp["target"] = { role: "notes" }): PatchOp {
  return {
    op: "append_note",
    target,
    text: "Test note",
  };
}

function setStatusOp(target: PatchOp["target"] = { role: "metadata" }): PatchOp {
  return {
    op: "set_status",
    target,
    status: "active",
  };
}

function setMetadataOp(target: PatchOp["target"] = { role: "metadata" }): PatchOp {
  return {
    op: "set_metadata",
    target,
    tags: ["test"],
  };
}

function proposeSummaryOp(target: PatchOp["target"] = { role: "summary" }): PatchOp {
  return {
    op: "propose_summary",
    target,
    content: { html: "<p>Test summary</p>" },
  };
}

function appendAgentEventOp(target: PatchOp["target"] = { role: "agent_events" }): PatchOp {
  return {
    op: "append_agent_event",
    target,
    event: { eventType: "test", summary: "Test event" },
  };
}

// Standard blocks for a research-note@1 document
function standardBlocks(): NoumenaBlock[] {
  return [
    makeBlock({ blockId: "blk_META000000000000000000000000", role: "metadata", policy: "merge_text", blockHash: "sha256:meta_hash" }),
    makeBlock({ blockId: "blk_SUMM000000000000000000000000", role: "summary", policy: "replace_requires_clean_base", blockHash: "sha256:summ_hash" }),
    makeBlock({ blockId: "blk_NOTE000000000000000000000000", role: "notes", policy: "append_only", blockHash: "sha256:note_hash" }),
    makeBlock({ blockId: "blk_EVID000000000000000000000000", role: "evidence", policy: "append_only", blockHash: "sha256:evid_hash" }),
    makeBlock({ blockId: "blk_AGEN000000000000000000000000", role: "agent_events", policy: "append_only", blockHash: "sha256:agen_hash" }),
  ];
}

// ---------------------------------------------------------------------------
// resolveTarget
// ---------------------------------------------------------------------------

describe("resolveTarget", () => {
  const state = makeState(standardBlocks());

  it("resolves by role", () => {
    const block = resolveTarget(state, { role: "evidence" });
    expect(block).toBeDefined();
    expect(block!.role).toBe("evidence");
    expect(block!.blockId).toBe("blk_EVID000000000000000000000000");
  });

  it("resolves by blockId", () => {
    const block = resolveTarget(state, { blockId: "blk_SUMM000000000000000000000000" });
    expect(block).toBeDefined();
    expect(block!.role).toBe("summary");
  });

  it("returns undefined for unknown role", () => {
    const block = resolveTarget(state, { role: "unknown_role" });
    expect(block).toBeUndefined();
  });

  it("returns undefined for unknown blockId", () => {
    const block = resolveTarget(state, { blockId: "blk_XXXX000000000000000000000000" });
    expect(block).toBeUndefined();
  });

  it("prefers blockId when both are set", () => {
    const block = resolveTarget(state, {
      role: "evidence",
      blockId: "blk_SUMM000000000000000000000000",
    });
    expect(block).toBeDefined();
    expect(block!.role).toBe("summary");
  });
});

// ---------------------------------------------------------------------------
// append_only policy — §17.1
// ---------------------------------------------------------------------------

describe("append_only policy", () => {
  it("auto-applies with matching revision", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({ ops: [appendEvidenceOp()] });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.opResults).toHaveLength(1);
    expect(result.opResults[0]!.outcome).toBe("auto_apply");
    expect(result.warnings).toHaveLength(0);
  });

  it("auto-applies with stale revision and emits warning (does NOT reject)", () => {
    const state = makeState(standardBlocks(), "sha256:current_rev");
    const patch = makePatch({
      base: { revision: "sha256:stale_rev", logicalVersion: 1 },
      ops: [appendEvidenceOp()],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.opResults[0]!.outcome).toBe("auto_apply");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.code).toBe("base_revision_changed_append_merged");
  });

  it("auto-applies append_note with stale revision", () => {
    const state = makeState(standardBlocks(), "sha256:current");
    const patch = makePatch({
      base: { revision: "sha256:old" },
      ops: [appendNoteOp()],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.warnings[0]!.code).toBe("base_revision_changed_append_merged");
  });

  it("auto-applies append_agent_event with stale revision", () => {
    const state = makeState(standardBlocks(), "sha256:current");
    const patch = makePatch({
      base: { revision: "sha256:old" },
      ops: [appendAgentEventOp()],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.warnings[0]!.code).toBe("base_revision_changed_append_merged");
  });
});

// ---------------------------------------------------------------------------
// replace_requires_clean_base — §17.2
// ---------------------------------------------------------------------------

describe("replace_requires_clean_base policy", () => {
  it("rejects when block hash mismatches", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      base: {
        revision: "sha256:current_rev",
        blockHashes: {
          blk_SUMM000000000000000000000000: "sha256:wrong_hash",
        },
      },
      ops: [proposeSummaryOp({ blockId: "blk_SUMM000000000000000000000000" })],
    });

    // propose_summary always requires_review, so use a different op
    // Actually, replace_requires_clean_base blocks are typically summary.
    // Let's test with a block that has this policy but a non-propose op.
    // We need a custom block with replace_requires_clean_base and an append op targeting it.
    const blocks = [
      makeBlock({
        blockId: "blk_TEST000000000000000000000000",
        role: "test_role",
        policy: "replace_requires_clean_base",
        blockHash: "sha256:actual_hash",
      }),
    ];
    const testState = makeState(blocks);
    const testPatch = makePatch({
      base: {
        revision: "sha256:current_rev",
        blockHashes: {
          blk_TEST000000000000000000000000: "sha256:wrong_hash",
        },
      },
      ops: [{
        op: "append_note",
        target: { blockId: "blk_TEST000000000000000000000000" },
        text: "test",
      }],
    });

    const result = evaluatePatch(testPatch, testState);
    expect(result.verdict).toBe("rejected");
    expect(result.opResults[0]!.reason!.code).toBe("target_block_changed_since_base_revision");
    expect(result.opResults[0]!.reason!.expectedBlockHash).toBe("sha256:wrong_hash");
    expect(result.opResults[0]!.reason!.currentBlockHash).toBe("sha256:actual_hash");
  });

  it("auto-applies when block hash matches", () => {
    const blocks = [
      makeBlock({
        blockId: "blk_TEST000000000000000000000000",
        role: "test_role",
        policy: "replace_requires_clean_base",
        blockHash: "sha256:matching_hash",
      }),
    ];
    const state = makeState(blocks);
    const patch = makePatch({
      base: {
        revision: "sha256:current_rev",
        blockHashes: {
          blk_TEST000000000000000000000000: "sha256:matching_hash",
        },
      },
      ops: [{
        op: "append_note",
        target: { blockId: "blk_TEST000000000000000000000000" },
        text: "test",
      }],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.opResults[0]!.outcome).toBe("auto_apply");
  });

  it("rejects when blockHash is missing from base", () => {
    const blocks = [
      makeBlock({
        blockId: "blk_TEST000000000000000000000000",
        role: "test_role",
        policy: "replace_requires_clean_base",
        blockHash: "sha256:some_hash",
      }),
    ];
    const state = makeState(blocks);
    const patch = makePatch({
      base: { revision: "sha256:current_rev" },
      ops: [{
        op: "append_note",
        target: { blockId: "blk_TEST000000000000000000000000" },
        text: "test",
      }],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
    expect(result.opResults[0]!.reason!.code).toBe("missing_block_hash");
  });
});

// ---------------------------------------------------------------------------
// manual_review policy — §17.2 (same as replace_requires_clean_base)
// ---------------------------------------------------------------------------

describe("manual_review policy", () => {
  it("rejects on block hash mismatch", () => {
    const blocks = [
      makeBlock({
        blockId: "blk_MR00000000000000000000000000",
        role: "summary",
        policy: "manual_review",
        blockHash: "sha256:current",
      }),
    ];
    const state = makeState(blocks);
    const patch = makePatch({
      base: {
        revision: "sha256:current_rev",
        blockHashes: { blk_MR00000000000000000000000000: "sha256:stale" },
      },
      ops: [{
        op: "append_note",
        target: { blockId: "blk_MR00000000000000000000000000" },
        text: "test",
      }],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
    expect(result.opResults[0]!.reason!.code).toBe("target_block_changed_since_base_revision");
  });

  it("auto-applies when hash matches", () => {
    const blocks = [
      makeBlock({
        blockId: "blk_MR00000000000000000000000000",
        role: "summary",
        policy: "manual_review",
        blockHash: "sha256:matching",
      }),
    ];
    const state = makeState(blocks);
    const patch = makePatch({
      base: {
        revision: "sha256:current_rev",
        blockHashes: { blk_MR00000000000000000000000000: "sha256:matching" },
      },
      ops: [{
        op: "append_note",
        target: { blockId: "blk_MR00000000000000000000000000" },
        text: "test",
      }],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
  });
});

// ---------------------------------------------------------------------------
// merge_text policy — §17.3
// ---------------------------------------------------------------------------

describe("merge_text policy", () => {
  it("auto-applies set_status (allowlist)", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({ ops: [setStatusOp()] });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.opResults[0]!.outcome).toBe("auto_apply");
    expect(result.opResults[0]!.policy).toBe("merge_text");
  });

  it("auto-applies set_metadata (allowlist)", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({ ops: [setMetadataOp()] });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.opResults[0]!.outcome).toBe("auto_apply");
  });

  it("rejects non-allowlist op on merge_text block", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      ops: [appendNoteOp({ role: "metadata" })],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
    expect(result.opResults[0]!.reason!.code).toBe("op_not_allowed_for_merge_text");
  });
});

// ---------------------------------------------------------------------------
// locked policy
// ---------------------------------------------------------------------------

describe("locked policy", () => {
  it("rejects any op targeting a locked block", () => {
    const blocks = [
      makeBlock({
        blockId: "blk_LOCK000000000000000000000000",
        role: "evidence",
        policy: "locked",
        blockHash: "sha256:locked_hash",
      }),
    ];
    const state = makeState(blocks);
    const patch = makePatch({
      ops: [appendEvidenceOp({ blockId: "blk_LOCK000000000000000000000000" })],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
    expect(result.opResults[0]!.reason!.code).toBe("target_block_locked");
  });
});

// ---------------------------------------------------------------------------
// propose_summary — always requires_review (§15.1)
// ---------------------------------------------------------------------------

describe("propose_summary", () => {
  it("always queues for review", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      base: {
        revision: "sha256:current_rev",
        blockHashes: {
          blk_SUMM000000000000000000000000: "sha256:summ_hash",
        },
      },
      ops: [proposeSummaryOp()],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("queued_review");
    expect(result.opResults[0]!.outcome).toBe("requires_review");
  });

  it("queues for review even when block hash matches", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      base: {
        revision: "sha256:current_rev",
        blockHashes: {
          blk_SUMM000000000000000000000000: "sha256:summ_hash",
        },
      },
      ops: [proposeSummaryOp({ blockId: "blk_SUMM000000000000000000000000" })],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("queued_review");
  });
});

// ---------------------------------------------------------------------------
// Atomic compound patch rule — §17.4
// ---------------------------------------------------------------------------

describe("atomic compound patch rule", () => {
  it("all auto-apply → verdict applied", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      ops: [
        appendEvidenceOp(),
        appendNoteOp(),
        setStatusOp(),
      ],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.opResults).toHaveLength(3);
    expect(result.opResults.every((r) => r.outcome === "auto_apply")).toBe(true);
  });

  it("any requires_review → whole patch queued_review", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      ops: [
        appendEvidenceOp(),
        proposeSummaryOp(),
      ],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("queued_review");
    // First op is auto_apply, second is requires_review
    expect(result.opResults[0]!.outcome).toBe("auto_apply");
    expect(result.opResults[1]!.outcome).toBe("requires_review");
  });

  it("any reject → whole patch rejected (no partial apply)", () => {
    const blocks = [
      ...standardBlocks(),
      makeBlock({
        blockId: "blk_LOCK000000000000000000000000",
        role: "locked_role",
        policy: "locked",
        blockHash: "sha256:x",
      }),
    ];
    const state = makeState(blocks);
    const patch = makePatch({
      ops: [
        appendEvidenceOp(),
        appendNoteOp({ role: "locked_role" }),
      ],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
  });

  it("reject takes priority over requires_review", () => {
    const blocks = [
      ...standardBlocks(),
      makeBlock({
        blockId: "blk_LOCK000000000000000000000000",
        role: "locked_role",
        policy: "locked",
        blockHash: "sha256:x",
      }),
    ];
    const state = makeState(blocks);
    const patch = makePatch({
      ops: [
        proposeSummaryOp(),
        appendNoteOp({ role: "locked_role" }),
      ],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// Target not found
// ---------------------------------------------------------------------------

describe("target not found", () => {
  it("rejects when target role does not exist", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      ops: [appendNoteOp({ role: "nonexistent" })],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
    expect(result.opResults[0]!.reason!.code).toBe("target_not_found");
  });

  it("rejects when target blockId does not exist", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({
      ops: [appendNoteOp({ blockId: "blk_XXXX000000000000000000000000" })],
    });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("rejected");
    expect(result.opResults[0]!.reason!.code).toBe("target_not_found");
  });
});

// ---------------------------------------------------------------------------
// clientPatchId idempotency
// ---------------------------------------------------------------------------

describe("checkIdempotency", () => {
  it("returns noop with already_applied when clientPatchId exists in DB", () => {
    const patch = makePatch({ clientPatchId: "test-idem-001" });

    // Mock the db module
    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          patch_id: "patch_EXISTING001",
          client_patch_id: "test-idem-001",
          status: "applied",
        }),
      }),
    } as unknown as import("better-sqlite3").Database;

    const result = checkIdempotency(patch, mockDb);
    expect(result).toBeDefined();
    expect(result!.verdict).toBe("noop");
    expect(result!.reason!.code).toBe("already_applied");
    expect(result!.reason!.priorPatchId).toBe("patch_EXISTING001");
  });

  it("returns undefined when existing patch has status rejected (allows retry)", () => {
    const patch = makePatch({ clientPatchId: "test-idem-rejected" });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          patch_id: "patch_REJECTED001",
          client_patch_id: "test-idem-rejected",
          status: "rejected",
        }),
      }),
    } as unknown as import("better-sqlite3").Database;

    const result = checkIdempotency(patch, mockDb);
    expect(result).toBeUndefined();
  });

  it("returns undefined when existing patch has status queued_review (allows retry)", () => {
    const patch = makePatch({ clientPatchId: "test-idem-queued" });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          patch_id: "patch_QUEUED001",
          client_patch_id: "test-idem-queued",
          status: "queued_review",
        }),
      }),
    } as unknown as import("better-sqlite3").Database;

    const result = checkIdempotency(patch, mockDb);
    expect(result).toBeUndefined();
  });

  it("returns undefined when clientPatchId not found in DB", () => {
    const patch = makePatch({ clientPatchId: "test-new-001" });

    const mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
      }),
    } as unknown as import("better-sqlite3").Database;

    const result = checkIdempotency(patch, mockDb);
    expect(result).toBeUndefined();
  });

  it("returns undefined when no clientPatchId in patch", () => {
    const patch = makePatch({});
    delete (patch as Record<string, unknown>).clientPatchId;

    const mockDb = {} as unknown as import("better-sqlite3").Database;
    const result = checkIdempotency(patch, mockDb);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Empty ops
// ---------------------------------------------------------------------------

describe("empty ops array", () => {
  it("returns applied verdict for patch with no ops", () => {
    const state = makeState(standardBlocks());
    const patch = makePatch({ ops: [] });

    const result = evaluatePatch(patch, state);
    expect(result.verdict).toBe("applied");
    expect(result.opResults).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildDocumentState
// ---------------------------------------------------------------------------

describe("buildDocumentState", () => {
  it("builds a state from a document with role map", () => {
    const doc = {
      schemaVersion: "noumena.html.v1" as const,
      documentType: "research-note" as const,
      documentId: "doc_TEST",
      title: "Test",
      metadata: { title: "Test", status: "draft" as const, createdAt: "2026-01-01T00:00:00Z" },
      article: { attributes: {} },
      roles: new Map<string, NoumenaBlock>(),
      blocks: standardBlocks(),
    };

    const state = buildDocumentState(doc);
    expect(state.blocks).toHaveLength(5);
    expect(state.roleMap.size).toBe(5);
    expect(state.roleMap.get("evidence")!.blockId).toBe("blk_EVID000000000000000000000000");
  });
});
