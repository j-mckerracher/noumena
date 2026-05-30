/**
 * Patch evaluation engine.
 *
 * WI-5034224 — Phase 1 Implementation Plan §15–§17:
 *   Evaluates a parsed patch against the current document state,
 *   applying conflict detection per block policy.
 *
 * AC-007: Conflict tests pass without actual file mutation.
 *
 * Conflict policies (§17):
 *   - append_only:  auto-apply; stale full revision emits warning, does not reject
 *   - replace_requires_clean_base: requires base.blockHashes[targetBlockId], rejects on mismatch
 *   - manual_review: same as replace_requires_clean_base
 *   - merge_text: field-level allowlist only (set_status, set_metadata); no block hash required
 *   - locked: always rejects with target_block_locked
 *
 * propose_summary always requires_review regardless of block hash match (§15.1).
 *
 * Atomic compound patch rule (§17.4):
 *   - all ops auto-apply → applied
 *   - any op requires_review → whole patch queued_review
 *   - any op rejects → whole patch rejected (no partial apply)
 */

import type { NoumenaBlock, NoumenaDocument, ConflictPolicy } from "./types.js";
import { getPatchByClientId } from "./db.js";
import type { Database as DatabaseType } from "better-sqlite3";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A parsed operation from the patch JSON. */
export interface PatchOp {
  op: string;
  target: { role?: string; blockId?: string };
  [key: string]: unknown;
}

/** A parsed patch document (post-schema-validation). */
export interface ParsedPatch {
  schema: "noumena.patch.v1";
  clientPatchId?: string;
  base: {
    revision: string;
    logicalVersion?: number;
    blockHashes?: Record<string, string>;
  };
  author: { type: "agent" | "human"; name: string };
  intent: string;
  ops: PatchOp[];
}

/** Warning emitted during evaluation (non-blocking). */
export interface EvalWarning {
  code: string;
  message: string;
  blockId?: string;
  role?: string;
}

/** Result of evaluating a single op. */
export interface OpEvalResult {
  op: PatchOp;
  resolvedBlockId: string;
  resolvedRole: string;
  policy: ConflictPolicy;
  outcome: "auto_apply" | "requires_review" | "rejected";
  /** Rejection reason if outcome is "rejected". */
  reason?: {
    code: string;
    message: string;
    blockId?: string;
    role?: string;
    policy?: string;
    expectedBlockHash?: string;
    currentBlockHash?: string;
  };
  warnings: EvalWarning[];
}

/** Overall patch evaluation verdict. */
export type PatchVerdict = "applied" | "queued_review" | "rejected" | "noop";

/** Full result of evaluating a patch against a document. */
export interface PatchEvalResult {
  verdict: PatchVerdict;
  /** Reason for noop or rejected. */
  reason?: {
    code: string;
    message: string;
    [key: string]: unknown;
  };
  /** Per-op results (empty for noop). */
  opResults: OpEvalResult[];
  /** Aggregated warnings from all ops. */
  warnings: EvalWarning[];
}

/** Document state used for evaluation (avoids coupling to full NoumenaDocument). */
export interface DocumentState {
  revision: string;
  blocks: NoumenaBlock[];
  /** Map of role → block for quick lookup. */
  roleMap: Map<string, NoumenaBlock>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a DocumentState from a NoumenaDocument.
 */
export function buildDocumentState(doc: NoumenaDocument): DocumentState {
  const roleMap = new Map<string, NoumenaBlock>();
  for (const block of doc.blocks) {
    // Use the document's roles map if available, otherwise build from blocks
    if (!roleMap.has(block.role)) {
      roleMap.set(block.role, block);
    }
  }
  return {
    revision: "", // caller must set this after computing revision
    blocks: doc.blocks,
    roleMap,
  };
}

/**
 * Resolve a patch target to a block.
 *
 * Target resolution per §15:
 *   - target.blockId → find block by blockId
 *   - target.role → find block by role (first match)
 */
export function resolveTarget(
  state: DocumentState,
  target: { role?: string; blockId?: string },
): NoumenaBlock | undefined {
  if (target.blockId) {
    return state.blocks.find((b) => b.blockId === target.blockId);
  }
  if (target.role) {
    return state.roleMap.get(target.role);
  }
  return undefined;
}

/**
 * Determine the default target role for an operation.
 * Per §15.1 table.
 */
function defaultTargetRole(opName: string): string | undefined {
  switch (opName) {
    case "append_evidence":
      return "evidence";
    case "append_note":
      return "notes";
    case "set_status":
    case "set_metadata":
      return "metadata";
    case "append_agent_event":
      return "agent_events";
    case "propose_summary":
      return "summary";
    default:
      return undefined;
  }
}

/**
 * Determine which ops are considered merge_text field-level allowlist.
 * Per §17.3: set_status and set_metadata only.
 */
function isMergeTextAllowedOp(opName: string): boolean {
  return opName === "set_status" || opName === "set_metadata";
}

// ---------------------------------------------------------------------------
// Per-op evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate a single operation against the document state.
 */
function evaluateOp(
  op: PatchOp,
  state: DocumentState,
  baseBlockHashes: Record<string, string> | undefined,
  baseRevision: string,
): OpEvalResult {
  const warnings: EvalWarning[] = [];

  // Resolve target block
  const target = op.target;
  const block = resolveTarget(state, target);

  if (!block) {
    const targetDesc = target.blockId ?? target.role ?? "unknown";
    return {
      op,
      resolvedBlockId: target.blockId ?? "",
      resolvedRole: target.role ?? "",
      policy: "append_only",
      outcome: "rejected",
      reason: {
        code: "target_not_found",
        message: `Target block not found: ${targetDesc}`,
        blockId: target.blockId,
        role: target.role,
      },
      warnings,
    };
  }

  const policy = block.policy;
  const resolvedBlockId = block.blockId;
  const resolvedRole = block.role;

  // §17: locked targets always reject
  if (policy === "locked") {
    return {
      op,
      resolvedBlockId,
      resolvedRole,
      policy,
      outcome: "rejected",
      reason: {
        code: "target_block_locked",
        message: "Target block is locked and cannot be modified.",
        blockId: resolvedBlockId,
        role: resolvedRole,
        policy: "locked",
      },
      warnings,
    };
  }

  // §15.1: propose_summary always requires_review
  if (op.op === "propose_summary") {
    return {
      op,
      resolvedBlockId,
      resolvedRole,
      policy,
      outcome: "requires_review",
      warnings,
    };
  }

  // Policy-specific evaluation
  switch (policy) {
    case "append_only": {
      // §17.1: full document revision mismatch does NOT reject
      // emit warning base_revision_changed_append_merged when stale
      const isStale = baseRevision !== state.revision;
      if (isStale) {
        warnings.push({
          code: "base_revision_changed_append_merged",
          message: "Full document revision is stale, but append-only operation was auto-merged.",
          blockId: resolvedBlockId,
          role: resolvedRole,
        });
      }
      return {
        op,
        resolvedBlockId,
        resolvedRole,
        policy,
        outcome: "auto_apply",
        warnings,
      };
    }

    case "replace_requires_clean_base":
    case "manual_review": {
      // §17.2: requires base.blockHashes[targetBlockId]
      const expectedHash = baseBlockHashes?.[resolvedBlockId];
      if (!expectedHash) {
        return {
          op,
          resolvedBlockId,
          resolvedRole,
          policy,
          outcome: "rejected",
          reason: {
            code: "missing_block_hash",
            message: `base.blockHashes[${resolvedBlockId}] is required for ${policy} policy.`,
            blockId: resolvedBlockId,
            role: resolvedRole,
            policy,
          },
          warnings,
        };
      }

      // Compare current block hash with expected
      const currentHash = block.blockHash;
      if (expectedHash !== currentHash) {
        return {
          op,
          resolvedBlockId,
          resolvedRole,
          policy,
          outcome: "rejected",
          reason: {
            code: "target_block_changed_since_base_revision",
            message: "Target block changed since the patch base revision.",
            blockId: resolvedBlockId,
            role: resolvedRole,
            policy,
            expectedBlockHash: expectedHash,
            currentBlockHash: currentHash,
          },
          warnings,
        };
      }

      return {
        op,
        resolvedBlockId,
        resolvedRole,
        policy,
        outcome: "auto_apply",
        warnings,
      };
    }

    case "merge_text": {
      // §17.3: field-level allowlist only (set_status, set_metadata)
      // No block hash required
      if (!isMergeTextAllowedOp(op.op)) {
        return {
          op,
          resolvedBlockId,
          resolvedRole,
          policy,
          outcome: "rejected",
          reason: {
            code: "op_not_allowed_for_merge_text",
            message: `Operation ${op.op} is not in the merge_text field-level allowlist. Only set_status and set_metadata are allowed.`,
            blockId: resolvedBlockId,
            role: resolvedRole,
            policy: "merge_text",
          },
          warnings,
        };
      }
      return {
        op,
        resolvedBlockId,
        resolvedRole,
        policy,
        outcome: "auto_apply",
        warnings,
      };
    }

    default: {
      // Unknown policy: reject as safety measure
      return {
        op,
        resolvedBlockId,
        resolvedRole,
        policy,
        outcome: "rejected",
        reason: {
          code: "unknown_conflict_policy",
          message: `Unknown conflict policy: ${policy}`,
          blockId: resolvedBlockId,
          role: resolvedRole,
          policy,
        },
        warnings,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check clientPatchId idempotency.
 *
 * If the patch has a clientPatchId that was already applied,
 * returns a noop PatchEvalResult. Otherwise returns undefined.
 */
export function checkIdempotency(
  patch: ParsedPatch,
  db: DatabaseType,
): PatchEvalResult | undefined {
  if (!patch.clientPatchId) {
    return undefined;
  }

  const existing = getPatchByClientId(db, patch.clientPatchId);
  if (existing && existing.status === "applied") {
    return {
      verdict: "noop",
      reason: {
        code: "already_applied",
        message: "Patch with this clientPatchId was already applied.",
        priorPatchId: existing.patch_id,
      },
      opResults: [],
      warnings: [],
    };
  }

  return undefined;
}

/**
 * Evaluate a patch against the current document state.
 *
 * Does NOT mutate the document or write to disk.
 * Returns the verdict (applied/queued_review/rejected) and per-op results.
 *
 * Atomic compound patch rule (§17.4):
 *   - If every op auto-applies → verdict: "applied"
 *   - If any op requires_review → verdict: "queued_review" (whole patch)
 *   - If any op rejects → verdict: "rejected" (whole patch, no partial apply)
 */
export function evaluatePatch(
  patch: ParsedPatch,
  state: DocumentState,
): PatchEvalResult {
  const opResults: OpEvalResult[] = [];
  const allWarnings: EvalWarning[] = [];

  for (const op of patch.ops) {
    const result = evaluateOp(
      op,
      state,
      patch.base.blockHashes,
      patch.base.revision,
    );
    opResults.push(result);
    allWarnings.push(...result.warnings);
  }

  // §17.4: Atomic compound patch rule
  // Priority: rejected > requires_review > auto_apply
  const hasRejected = opResults.some((r) => r.outcome === "rejected");
  if (hasRejected) {
    // Find the first rejection reason
    const firstRejected = opResults.find((r) => r.outcome === "rejected")!;
    return {
      verdict: "rejected",
      reason: firstRejected.reason,
      opResults,
      warnings: allWarnings,
    };
  }

  const hasReview = opResults.some((r) => r.outcome === "requires_review");
  if (hasReview) {
    return {
      verdict: "queued_review",
      opResults,
      warnings: allWarnings,
    };
  }

  return {
    verdict: "applied",
    opResults,
    warnings: allWarnings,
  };
}
