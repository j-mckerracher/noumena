/**
 * Document info: live revision, block hashes, patchability, and allowed ops.
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.2, AC-006:
 *   Computes live revision/block hashes from disk.
 *   Returns patchability, roles with blockHash, and allowedPhase1Ops
 *   (dynamic — locked blocks remove their ops).
 */

import * as fs from "node:fs";
import type { NoumenaDocument } from "./types.js";
import { openInitializedVault } from "./vault.js";
import { validateVaultRelativePath } from "./pathSafety.js";
import { validateDocument } from "./validateDocument.js";
import { computeRevision, computeAllBlockHashes, sha256 } from "./computeRevision.js";
import { getDocument } from "./db.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface RoleInfo {
  role: string;
  blockId: string;
  policy: string;
  blockHash: string;
  present: boolean;
  known: boolean;
  required: boolean;
  requiresBlockHashForOps: string[];
}

export interface DocInfoSuccess {
  ok: true;
  document: string;
  path: string;
  documentId: string;
  title: string;
  fileClass: string;
  patchable: boolean;
  schemaVersion?: string;
  documentType?: string;
  revision: string;
  logicalVersion: number;
  index: {
    fresh: boolean;
    indexedRevision: string | null;
  };
  roles: RoleInfo[];
  allowedPhase1Ops: string[];
  validationErrors?: Array<{ code: string; message: string }>;
}

export interface DocInfoError {
  ok: false;
  code: string;
  message: string;
}

export type DocInfoResult = DocInfoSuccess | DocInfoError;

// ---------------------------------------------------------------------------
// Phase 1 operations mapping
// ---------------------------------------------------------------------------

/** Maps target roles to their Phase 1 operations. */
const ROLE_OPS: Record<string, string[]> = {
  evidence: ["append_evidence"],
  notes: ["append_note"],
  metadata: ["set_status", "set_metadata"],
  agent_events: ["append_agent_event"],
  summary: ["propose_summary"],
};

/** Ops that require the target block's hash for conflict detection. */
const OPS_REQUIRING_BLOCK_HASH: Record<string, string[]> = {
  summary: ["propose_summary"],
};

const KNOWN_ROLES = new Set(["metadata", "summary", "notes", "evidence", "agent_events"]);
const REQUIRED_ROLES = new Set(["metadata", "summary", "notes", "evidence", "agent_events"]);

// ---------------------------------------------------------------------------
// Main info function
// ---------------------------------------------------------------------------

/**
 * Get document info from a vault.
 *
 * @param vaultPath - Path to the vault root.
 * @param docRelPath - Vault-relative document path.
 */
export function getDocInfo(
  vaultPath: string,
  docRelPath: string,
): DocInfoResult {
  // Open vault
  const vaultResult = openInitializedVault(vaultPath);
  if (!vaultResult.ok) {
    return {
      ok: false,
      code: vaultResult.code,
      message: vaultResult.message,
    };
  }

  const { vault } = vaultResult;

  try {
    // Validate path safety
    const pathResult = validateVaultRelativePath(vault.root, docRelPath);
    if (!pathResult.valid) {
      return {
        ok: false,
        code: pathResult.code,
        message: pathResult.message,
      };
    }

    const absDocPath = pathResult.resolvedPath;

    // Check file exists
    if (!fs.existsSync(absDocPath)) {
      return {
        ok: false,
        code: "document_not_found",
        message: `File not found: ${docRelPath}`,
      };
    }

    // Read file
    const fileBytes = fs.readFileSync(absDocPath, "utf-8");

    // Validate
    const validation = validateDocument(fileBytes);

    // Compute live revision
    let revision: string;
    if (validation.patchable && validation.document) {
      revision = `sha256:${computeRevision(fileBytes)}`;
    } else {
      revision = `sha256:${sha256(fileBytes)}`;
    }

    // Get index record for freshness check
    const indexRecord = getDocument(vault.db, docRelPath);
    const indexedRevision = indexRecord?.revision ?? null;
    const indexFresh = indexedRevision === revision;

    // Build roles info and allowed ops
    const roles: RoleInfo[] = [];
    const allowedOps: string[] = [];

    if (validation.patchable && validation.document) {
      const doc = validation.document;
      computeAllBlockHashes(doc);

      for (const block of doc.blocks) {
        const isKnown = KNOWN_ROLES.has(block.role);
        const isRequired = REQUIRED_ROLES.has(block.role);
        const isLocked = block.policy === "locked";

        roles.push({
          role: block.role,
          blockId: block.blockId,
          policy: block.policy,
          blockHash: `sha256:${block.blockHash}`,
          present: true,
          known: isKnown,
          required: isRequired,
          requiresBlockHashForOps: OPS_REQUIRING_BLOCK_HASH[block.role] ?? [],
        });

        // Add ops for non-locked blocks
        if (!isLocked && ROLE_OPS[block.role]) {
          allowedOps.push(...ROLE_OPS[block.role]!);
        }
      }
    }

    // Build result
    const result: DocInfoSuccess = {
      ok: true,
      document: docRelPath,
      path: docRelPath,
      documentId: validation.documentId ?? "",
      title: validation.title ?? "",
      fileClass: validation.fileClass,
      patchable: validation.patchable,
      schemaVersion: validation.schemaVersion,
      documentType: validation.documentType,
      revision,
      logicalVersion: indexRecord?.logical_version ?? 0,
      index: {
        fresh: indexFresh,
        indexedRevision,
      },
      roles,
      allowedPhase1Ops: allowedOps,
    };

    // Include validation errors for non-patchable documents
    if (!validation.patchable && validation.errors.length > 0) {
      result.validationErrors = validation.errors.map((e) => ({
        code: e.code,
        message: e.message,
      }));
    }

    return result;
  } finally {
    vault.db.close();
  }
}
