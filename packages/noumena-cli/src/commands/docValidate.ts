/**
 * CLI command: noumena doc validate <vault> <path> --json
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.2, AC-006:
 *   Validates a document and outputs structured JSON result.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { openInitializedVault, validateVaultRelativePath, validateDocument } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

/**
 * Execute the doc validate command.
 */
export function runDocValidate(vaultPath: string, docPath: string): never {
  const vaultResult = openInitializedVault(vaultPath);
  if (!vaultResult.ok) {
    writeJsonError("doc.validate", vaultResult.code, vaultResult.message, 4);
  }

  const { vault } = vaultResult;

  try {
    const pathResult = validateVaultRelativePath(vault.root, docPath);
    if (!pathResult.valid) {
      writeJsonError("doc.validate", pathResult.code, pathResult.message, 4);
    }

    if (!fs.existsSync(pathResult.resolvedPath)) {
      writeJsonError("doc.validate", "document_not_found", `File not found: ${docPath}`, 4);
    }

    const fileBytes = fs.readFileSync(pathResult.resolvedPath, "utf-8");
    const result = validateDocument(fileBytes);

    let status: string;
    if (result.errors.length > 0) {
      status = "error";
    } else if (result.warnings.length > 0) {
      status = "warning";
    } else {
      status = "ok";
    }

    writeJsonResult(
      {
        schema: "noumena.cli.result.v1",
        command: "doc.validate",
        status,
        valid: result.valid,
        patchable: result.patchable,
        fileClass: result.fileClass,
        schemaVersion: result.schemaVersion ?? null,
        documentType: result.documentType ?? null,
        documentId: result.documentId ?? null,
        title: result.title ?? null,
        errors: result.errors,
        warnings: result.warnings,
      },
      0,
    );
  } finally {
    vault.db.close();
  }

  // Should never reach here due to writeJsonResult calling process.exit
  process.exit(5);
}
