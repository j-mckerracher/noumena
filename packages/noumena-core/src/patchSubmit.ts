import * as fs from "node:fs";
import { canonicalSerialize } from "./canonicalSerialize.js";
import { parseNoumenaHtml } from "./parseNoumenaHtml.js";
import { validateVaultRelativePath } from "./pathSafety.js";
import { openInitializedVault } from "./vault.js";
import { computeAllBlockHashes, computeRevision, computeRevisionFromDocument } from "./computeRevision.js";
import { buildDocumentState, checkIdempotency, evaluatePatch, type ParsedPatch } from "./evaluatePatch.js";
import { readAndValidatePatchJson } from "./patchSchema.js";
import { generateId } from "./ids.js";
import { applyPatch } from "./applyPatch.js";
import { buildBlockDiffs } from "./blockDiff.js";
import { indexDocument } from "./indexDocument.js";
import { recordHistoryEvent } from "./history.js";
import { storeReview } from "./reviewStore.js";
import { insertPatch, writePatchJson, type PatchRecord } from "./db.js";
import { runWriteTransaction } from "./writeTransaction.js";

export type PatchSubmitError = { ok: false; code: string; message: string };
export type PatchSubmitSuccess = Record<string, unknown> & { ok: true; status: string; patchId?: string; reviewId?: string };
export type PatchSubmitResult = PatchSubmitError | PatchSubmitSuccess;
export type PatchDryRunResult = PatchSubmitResult;

function loadPatch(patchFile: string): ParsedPatch {
  return readAndValidatePatchJson(patchFile) as ParsedPatch;
}

function makePatchRecord(
  patchId: string,
  docPath: string,
  patch: ParsedPatch,
  status: string,
  now: string,
): PatchRecord {
  return {
    patch_id: patchId,
    client_patch_id: patch.clientPatchId ?? null,
    path: docPath,
    status,
    author_name: patch.author.name,
    author_type: patch.author.type,
    intent: patch.intent,
    base_revision: patch.base.revision,
    previous_revision: null,
    revision: null,
    patch_json_path: null,
    diff_path: null,
    snapshot_path: null,
    created_at: now,
    applied_at: status === "applied" ? now : null,
  };
}

export function dryRunPatch(vaultPath: string, docPath: string, patchFile: string): PatchDryRunResult {
  const patch = loadPatch(patchFile);
  const vaultResult = openInitializedVault(vaultPath);
  if (!vaultResult.ok) return { ok: false, code: vaultResult.code, message: vaultResult.message };
  const { vault } = vaultResult;
  try {
    const pathCheck = validateVaultRelativePath(vault.root, docPath);
    if (!pathCheck.valid) return { ok: false, code: pathCheck.code, message: pathCheck.message };
    if (!fs.existsSync(pathCheck.resolvedPath)) return { ok: false, code: "document_not_found", message: `File not found: ${docPath}` };
    const html = fs.readFileSync(pathCheck.resolvedPath, "utf-8");
    const parsed = parseNoumenaHtml(html);
    if (parsed.fileClass !== "noumena_native" || !parsed.document) {
      return { ok: false, code: "document_not_patchable", message: "Document is not a valid Noumena native document." };
    }
    computeAllBlockHashes(parsed.document);
    const state = buildDocumentState(parsed.document);
    state.revision = `sha256:${computeRevisionFromDocument(parsed.document)}`;
    const idempotent = checkIdempotency(patch, vault.db);
    const evalResult = idempotent ?? evaluatePatch(patch, state);
    return {
      ok: true,
      schema: "noumena.cli.result.v1",
      command: "patch.dry-run",
      status: evalResult.verdict,
      document: docPath,
      documentChanged: false,
      reason: evalResult.reason,
      warnings: evalResult.warnings,
      opResults: evalResult.opResults,
    };
  } finally {
    vault.db.close();
  }
}

export function submitPatch(vaultPath: string, docPath: string, patchFile: string): PatchSubmitResult {
  const patch = loadPatch(patchFile);
  const vaultResult = openInitializedVault(vaultPath);
  if (!vaultResult.ok) return { ok: false, code: vaultResult.code, message: vaultResult.message };
  vaultResult.vault.db.close();

  const tx = runWriteTransaction({
    vaultRoot: vaultPath,
    docPath,
    command: "patch.submit",
    execute: (ctx) => {
      const now = new Date().toISOString();
      const patchId = generateId("pat");
      if (!ctx.fileBytes) {
        return {
          type: "rejected",
          result: {
            ok: true,
            schema: "noumena.cli.result.v1",
            command: "patch.submit",
            status: "rejected",
            document: docPath,
            patchId,
            documentChanged: false,
            reason: { code: "document_not_found", message: `File not found: ${docPath}` },
          },
        };
      }

      const beforeHtml = ctx.fileBytes.toString("utf-8");
      const parsed = parseNoumenaHtml(beforeHtml);
      if (parsed.fileClass !== "noumena_native" || !parsed.document) {
        return {
          type: "rejected",
          result: {
            ok: true,
            schema: "noumena.cli.result.v1",
            command: "patch.submit",
            status: "rejected",
            document: docPath,
            patchId,
            documentChanged: false,
            reason: { code: "document_not_patchable", message: "Document is not a valid Noumena native document." },
          },
        };
      }

      const beforeDoc = parsed.document;
      computeAllBlockHashes(beforeDoc);
      const state = buildDocumentState(beforeDoc);
      state.revision = `sha256:${computeRevisionFromDocument(beforeDoc)}`;
      const idempotent = checkIdempotency(patch, ctx.db);
      if (idempotent) {
        return {
          type: "noop",
          result: {
            ok: true,
            schema: "noumena.cli.result.v1",
            command: "patch.submit",
            status: "noop",
            document: docPath,
            documentChanged: false,
            reason: idempotent.reason,
          },
        };
      }

      const evalResult = evaluatePatch(patch, state);
      const patchJsonPath = writePatchJson(ctx.vaultRoot, patchId, JSON.stringify(patch, null, 2) + "\n");
      if (evalResult.verdict === "rejected") {
        return {
          type: "rejected",
          recordAttempt: (db) => insertPatch(db, { ...makePatchRecord(patchId, docPath, patch, "rejected", now), patch_json_path: patchJsonPath }),
          result: {
            ok: true,
            schema: "noumena.cli.result.v1",
            command: "patch.submit",
            status: "rejected",
            document: docPath,
            patchId,
            documentChanged: false,
            reason: evalResult.reason,
            warnings: evalResult.warnings,
          },
        };
      }

      const afterDocForDiff = parseNoumenaHtml(beforeHtml).document!;
      applyPatch(afterDocForDiff, patch);
      computeAllBlockHashes(afterDocForDiff);
      const blockDiffs = buildBlockDiffs(beforeDoc.blocks, afterDocForDiff.blocks);
      const diffText = blockDiffs.map((d) => `--- ${d.role} [${d.blockId}]\n${d.before}\n+++ ${d.role} [${d.blockId}]\n${d.after}`).join("\n\n");

      if (evalResult.verdict === "queued_review") {
        const reviewId = generateId("rev");
        const reviewPayload = {
          schema: "noumena.review.v1",
          reviewId,
          patchId,
          document: docPath,
          baseRevision: state.revision,
          patch,
          blockDiffs,
        };
        return {
          type: "queued_review",
          writeReview: (db) => {
            const paths = storeReview(db, ctx.vaultRoot, {
              review_id: reviewId,
              patch_id: patchId,
              path: docPath,
              status: "queued",
              base_revision: state.revision,
              review_json_path: "",
              diff_path: "",
              queued_at: now,
              resolved_at: null,
            }, reviewPayload, diffText);
            insertPatch(db, {
              ...makePatchRecord(patchId, docPath, patch, "queued_review", now),
              patch_json_path: patchJsonPath,
              diff_path: paths.diffPath,
            });
            recordHistoryEvent(db, {
              path: docPath,
              kind: "review_queued",
              patch_id: patchId,
              review_id: reviewId,
              revision_before: state.revision,
              revision_after: null,
              created_at: now,
              data_json: JSON.stringify({ reviewJsonPath: paths.reviewJsonPath }),
            });
          },
          result: {
            ok: true,
            schema: "noumena.cli.result.v1",
            command: "patch.submit",
            status: "queued_review",
            document: docPath,
            patchId,
            reviewId,
            documentChanged: false,
            warnings: evalResult.warnings,
          },
        };
      }

      const newContent = canonicalSerialize(afterDocForDiff);
      const newRevision = `sha256:${computeRevision(newContent)}`;
      return {
        type: "applied",
        newContent,
        snapshotHtml: beforeHtml,
        patchId,
        updateIndex: (db) => {
          const revision = indexDocument(db, docPath, afterDocForDiff, 2, now);
          insertPatch(db, {
            ...makePatchRecord(patchId, docPath, patch, "applied", now),
            previous_revision: state.revision,
            revision,
            patch_json_path: patchJsonPath,
            snapshot_path: `.noumena/history/snapshots/${docPath.replace(/\//g, "__")}/${patchId}.before.html`,
          });
          recordHistoryEvent(db, {
            path: docPath,
            kind: "patch_applied",
            patch_id: patchId,
            review_id: null,
            revision_before: state.revision,
            revision_after: revision,
            created_at: now,
            data_json: null,
          });
        },
        result: {
          ok: true,
          schema: "noumena.cli.result.v1",
          command: "patch.submit",
          status: "applied",
          document: docPath,
          patchId,
          revision: newRevision,
          documentChanged: true,
          warnings: evalResult.warnings,
        },
      };
    },
  });

  return tx.result as PatchSubmitSuccess;
}
