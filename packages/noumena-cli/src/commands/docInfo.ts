/**
 * CLI command: noumena doc info <vault> <doc-path> --json
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.2, AC-006:
 *   Inspects a document, computes live revision/block hashes,
 *   and returns patchability and allowed operations.
 */

import { getDocInfo } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

/**
 * Execute the doc info command.
 */
export function runDocInfo(vaultPath: string, docPath: string): never {
  const result = getDocInfo(vaultPath, docPath);

  if (!result.ok) {
    const exitCode = result.code === "vault_not_initialized" ? 4
      : result.code === "path_escapes_vault" ? 4
      : result.code === "document_not_found" ? 4
      : 5;

    writeJsonError("doc.info", result.code, result.message, exitCode);
  }

  writeJsonResult(
    {
      schema: "noumena.cli.result.v1",
      command: "doc.info",
      status: "ok",
      document: result.document,
      path: result.path,
      documentId: result.documentId,
      title: result.title,
      fileClass: result.fileClass,
      patchable: result.patchable,
      schemaVersion: result.schemaVersion ?? null,
      documentType: result.documentType ?? null,
      revision: result.revision,
      logicalVersion: result.logicalVersion,
      index: result.index,
      roles: result.roles,
      allowedPhase1Ops: result.allowedPhase1Ops,
      ...(result.validationErrors ? { validationErrors: result.validationErrors } : {}),
    },
    0,
  );
}
