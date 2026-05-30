/**
 * CLI command: noumena doc create <vault> <doc-path> --type=research-note --title=... --json
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.2, AC-006:
 *   Creates a document from template via canonical serializer.
 */

import { createDocument } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

/**
 * Execute the doc create command.
 */
export function runDocCreate(
  vaultPath: string,
  docPath: string,
  docType: string,
  title: string,
): never {
  const result = createDocument(vaultPath, docPath, docType, title);

  if (!result.ok) {
    const exitCode = result.code === "document_already_exists" ? 4
      : result.code === "vault_not_initialized" ? 4
      : result.code === "path_escapes_vault" ? 4
      : result.code === "unsupported_document_type" ? 4
      : 5;

    writeJsonError("doc.create", result.code, result.message, exitCode, {
      documentChanged: false,
      ...(result.path ? { path: result.path } : {}),
    });
  }

  writeJsonResult(
    {
      schema: "noumena.cli.result.v1",
      command: "doc.create",
      status: "created",
      vault: vaultPath,
      document: result.document,
      documentId: result.documentId,
      title: result.title,
      fileClass: result.fileClass,
      patchable: result.patchable,
      schemaVersion: result.schemaVersion,
      documentType: result.documentType,
      templateUsed: result.templateUsed,
      revision: result.revision,
      logicalVersion: result.logicalVersion,
      indexUpdated: result.indexUpdated,
      next: result.next,
    },
    0,
  );
}
