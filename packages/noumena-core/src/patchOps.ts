import * as fs from "node:fs";
import * as path from "node:path";
import { applyPatch } from "./applyPatch.js";
import { canonicalSerialize } from "./canonicalSerialize.js";
import { computeAllBlockHashes, computeRevision, computeRevisionFromDocument } from "./computeRevision.js";
import {
  getPatch,
  getReview,
  getLatestAppliedPatch,
  insertPatch,
  updatePatchStatus,
  updateReviewStatus,
  writePatchJson,
  type PatchRecord,
} from "./db.js";
import { indexDocument } from "./indexDocument.js";
import { parseNoumenaHtml } from "./parseNoumenaHtml.js";
import { openInitializedVault } from "./vault.js";
import { runWriteTransaction } from "./writeTransaction.js";
import { recordHistoryEvent } from "./history.js";
import { buildBlockDiffs } from "./blockDiff.js";
import type { ParsedPatch } from "./evaluatePatch.js";

export type PatchOpError = { ok: false; code: string; message: string };
export type PatchOpSuccess = Record<string, unknown> & { ok: true };
export type PatchOpResult = PatchOpError | PatchOpSuccess;

function readPatchPayload(vaultRoot: string, patch: PatchRecord): ParsedPatch | null {
  if (!patch.patch_json_path) return null;
  const abs = path.join(vaultRoot, patch.patch_json_path);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf-8")) as ParsedPatch;
}

function openVaultOrError(vaultPath: string): PatchOpError | { ok: true; root: string; db: import("./db.js").DatabaseType } {
  const vault = openInitializedVault(vaultPath);
  if (!vault.ok) return { ok: false, code: vault.code, message: vault.message };
  return { ok: true, root: vault.vault.root, db: vault.vault.db };
}

export function rejectPatch(vaultPath: string, reviewId: string): PatchOpResult {
  const opened = openVaultOrError(vaultPath);
  if (!opened.ok) return opened;
  try {
    const review = getReview(opened.db, reviewId);
    if (!review) return { ok: false, code: "review_not_found", message: `Review not found: ${reviewId}` };
    if (review.status !== "queued") return { ok: false, code: "review_not_pending", message: `Review is not queued: ${reviewId}` };
    const now = new Date().toISOString();
    updateReviewStatus(opened.db, reviewId, "rejected", now);
    updatePatchStatus(opened.db, review.patch_id, "rejected", now);
    recordHistoryEvent(opened.db, {
      path: review.path,
      kind: "review_rejected",
      patch_id: review.patch_id,
      review_id: reviewId,
      revision_before: review.base_revision,
      revision_after: null,
      created_at: now,
      data_json: null,
    });
    return {
      ok: true,
      schema: "noumena.cli.result.v1",
      command: "patch.reject",
      status: "rejected",
      reviewId,
      patchId: review.patch_id,
      document: review.path,
      documentChanged: false,
    };
  } finally {
    opened.db.close();
  }
}

export function approvePatch(vaultPath: string, reviewId: string): PatchOpResult {
  const opened = openVaultOrError(vaultPath);
  if (!opened.ok) return opened;
  const review = getReview(opened.db, reviewId);
  if (!review) {
    opened.db.close();
    return { ok: false, code: "review_not_found", message: `Review not found: ${reviewId}` };
  }
  if (review.status !== "queued") {
    opened.db.close();
    return { ok: false, code: "review_not_pending", message: `Review is not queued: ${reviewId}` };
  }
  const patchRecord = getPatch(opened.db, review.patch_id);
  const patch = patchRecord ? readPatchPayload(opened.root, patchRecord) : null;
  opened.db.close();
  if (!patchRecord || !patch) {
    return { ok: false, code: "patch_not_found", message: `Patch not found for review: ${reviewId}` };
  }

  const tx = runWriteTransaction({
    vaultRoot: vaultPath,
    docPath: review.path,
    command: "patch.approve",
    execute: (ctx) => {
      const now = new Date().toISOString();
      const currentHtml = ctx.fileBytes?.toString("utf-8") ?? "";
      const parsed = parseNoumenaHtml(currentHtml);
      const currentRevision = parsed.document
        ? `sha256:${computeRevisionFromDocument(parsed.document)}`
        : `sha256:${computeRevision(currentHtml)}`;

      if (currentRevision !== review.base_revision) {
        return {
          type: "rejected",
          recordAttempt: (db) => updateReviewStatus(db, reviewId, "stale", now),
          result: {
            ok: true,
            schema: "noumena.cli.result.v1",
            command: "patch.approve",
            status: "stale_review",
            reviewId,
            patchId: review.patch_id,
            document: review.path,
            documentChanged: false,
            reason: { code: "stale_review", message: "Document changed since this review was queued." },
          },
        };
      }

      if (!parsed.document) {
        return {
          type: "rejected",
          result: {
            ok: true,
            schema: "noumena.cli.result.v1",
            command: "patch.approve",
            status: "rejected",
            reviewId,
            patchId: review.patch_id,
            document: review.path,
            documentChanged: false,
            reason: { code: "document_not_patchable", message: "Document is not patchable." },
          },
        };
      }

      const beforeDoc = parsed.document;
      computeAllBlockHashes(beforeDoc);
      const afterDoc = parseNoumenaHtml(currentHtml).document!;
      applyPatch(afterDoc, patch);
      computeAllBlockHashes(afterDoc);
      const newContent = canonicalSerialize(afterDoc);

      return {
        type: "applied",
        newContent,
        snapshotHtml: currentHtml,
        patchId: review.patch_id,
        updateIndex: (db) => {
          const revision = indexDocument(db, review.path, afterDoc, 2, now);
          updatePatchStatus(db, review.patch_id, "applied", now, revision);
          db.prepare(
            "UPDATE patches SET previous_revision = ?, snapshot_path = ? WHERE patch_id = ?",
          ).run(
            review.base_revision,
            `.noumena/history/snapshots/${review.path.replace(/\//g, "__")}/${review.patch_id}.before.html`,
            review.patch_id,
          );
          updateReviewStatus(db, reviewId, "approved", now);
          recordHistoryEvent(db, {
            path: review.path,
            kind: "review_approved",
            patch_id: review.patch_id,
            review_id: reviewId,
            revision_before: review.base_revision,
            revision_after: revision,
            created_at: now,
            data_json: null,
          });
        },
        result: {
          ok: true,
          schema: "noumena.cli.result.v1",
          command: "patch.approve",
          status: "applied",
          reviewId,
          patchId: review.patch_id,
          document: review.path,
          revision: `sha256:${computeRevision(newContent)}`,
          documentChanged: true,
        },
      };
    },
  });

  return tx.result as PatchOpSuccess;
}

export function rollbackPatch(vaultPath: string, patchId: string): PatchOpResult {
  const opened = openVaultOrError(vaultPath);
  if (!opened.ok) return opened;
  const patch = getPatch(opened.db, patchId);
  if (!patch) {
    opened.db.close();
    return { ok: false, code: "patch_not_found", message: `Patch not found: ${patchId}` };
  }
  if (patch.status !== "applied") {
    opened.db.close();
    return { ok: false, code: "patch_not_applied", message: `Patch is not applied: ${patchId}` };
  }
  const latest = getLatestAppliedPatch(opened.db, patch.path);
  opened.db.close();

  if (latest?.patch_id !== patchId) {
    return {
      ok: true,
      schema: "noumena.cli.result.v1",
      command: "patch.rollback",
      status: "rollback_not_latest",
      patchId,
      document: patch.path,
      documentChanged: false,
      reason: { code: "rollback_not_latest", message: "Only the latest applied patch can be rolled back." },
    };
  }
  if (!patch.snapshot_path) {
    return { ok: false, code: "snapshot_not_found", message: `Patch has no snapshot: ${patchId}` };
  }

  const snapshotAbs = path.join(path.resolve(vaultPath), patch.snapshot_path);
  if (!fs.existsSync(snapshotAbs)) {
    return { ok: false, code: "snapshot_not_found", message: `Snapshot not found: ${patch.snapshot_path}` };
  }
  const snapshotHtml = fs.readFileSync(snapshotAbs, "utf-8");
  const parsedSnapshot = parseNoumenaHtml(snapshotHtml);

  const tx = runWriteTransaction({
    vaultRoot: vaultPath,
    docPath: patch.path,
    command: "patch.rollback",
    execute: () => {
      const now = new Date().toISOString();
      return {
        type: "applied",
        newContent: snapshotHtml,
        updateIndex: (db) => {
          const revision = parsedSnapshot.document
            ? indexDocument(db, patch.path, parsedSnapshot.document, 2, now)
            : `sha256:${computeRevision(snapshotHtml)}`;
          updatePatchStatus(db, patchId, "rolled_back", now, revision);
          recordHistoryEvent(db, {
            path: patch.path,
            kind: "patch_rolled_back",
            patch_id: patchId,
            review_id: null,
            revision_before: patch.revision,
            revision_after: revision,
            created_at: now,
            data_json: JSON.stringify({ snapshotPath: patch.snapshot_path }),
          });
        },
        result: {
          ok: true,
          schema: "noumena.cli.result.v1",
          command: "patch.rollback",
          status: "rolled_back",
          patchId,
          document: patch.path,
          documentChanged: true,
          revision: `sha256:${computeRevision(snapshotHtml)}`,
        },
      };
    },
  });

  return tx.result as PatchOpSuccess;
}

export function patchStatus(vaultPath: string, id: string): PatchOpResult {
  const opened = openVaultOrError(vaultPath);
  if (!opened.ok) return opened;
  try {
    const patch = getPatch(opened.db, id);
    if (patch) {
      return {
        ok: true,
        schema: "noumena.cli.result.v1",
        command: "patch.status",
        type: "patch",
        patchId: patch.patch_id,
        status: patch.status,
        document: patch.path,
        reviewId: null,
        documentChanged: false,
      };
    }
    const review = getReview(opened.db, id);
    if (review) {
      return {
        ok: true,
        schema: "noumena.cli.result.v1",
        command: "patch.status",
        type: "review",
        reviewId: review.review_id,
        patchId: review.patch_id,
        status: review.status,
        document: review.path,
        documentChanged: false,
      };
    }
    return { ok: false, code: "patch_not_found", message: `Patch or review not found: ${id}` };
  } finally {
    opened.db.close();
  }
}

export function patchShow(vaultPath: string, id: string, format?: string): PatchOpResult {
  const opened = openVaultOrError(vaultPath);
  if (!opened.ok) return opened;
  try {
    const patch = getPatch(opened.db, id);
    const review = patch ? undefined : getReview(opened.db, id);
    const patchRecord = patch ?? (review ? getPatch(opened.db, review.patch_id) : undefined);
    if (!patchRecord) return { ok: false, code: "patch_not_found", message: `Patch or review not found: ${id}` };
    const payload = readPatchPayload(opened.root, patchRecord);
    if (!payload) return { ok: false, code: "patch_json_missing", message: `Patch JSON missing for ${patchRecord.patch_id}` };

    let blockDiffs: unknown[] = [];
    if (format === "block-diff") {
      const docAbs = path.join(opened.root, patchRecord.path);
      if (fs.existsSync(docAbs)) {
        const currentHtml = fs.readFileSync(docAbs, "utf-8");
        const before = parseNoumenaHtml(currentHtml).document;
        const after = parseNoumenaHtml(currentHtml).document;
        if (before && after) {
          applyPatch(after, payload);
          blockDiffs = buildBlockDiffs(before.blocks, after.blocks);
        }
      }
    }

    return {
      ok: true,
      schema: "noumena.cli.result.v1",
      command: "patch.show",
      status: patchRecord.status,
      patchId: patchRecord.patch_id,
      reviewId: review?.review_id ?? null,
      document: patchRecord.path,
      author: patchRecord.author_name,
      intent: patchRecord.intent,
      format: format ?? "json",
      patch: payload,
      blockDiffs,
      documentChanged: false,
    };
  } finally {
    opened.db.close();
  }
}
