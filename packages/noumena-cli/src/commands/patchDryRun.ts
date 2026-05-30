import { PatchSchemaValidationError, dryRunPatch } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

export function runPatchDryRun(vaultPath: string, docPath: string, patchFile: string): never {
  try {
    const result = dryRunPatch(vaultPath, docPath, patchFile);
    if (!result.ok) {
      const exitCode = result.code === "patch_schema_invalid" ? 3
        : result.code === "vault_not_initialized" || result.code === "document_not_found" || result.code === "path_escapes_vault" ? 4
          : 5;
      writeJsonError("patch.dry-run", result.code, result.message, exitCode, { document: docPath });
    }
    writeJsonResult(result);
  } catch (err) {
    if (err instanceof PatchSchemaValidationError) {
      writeJsonError("patch.dry-run", "patch_schema_invalid", err.message, 3, { errors: err.errors });
    }
    writeJsonError("patch.dry-run", "internal_error", (err as Error).message, 5);
  }
}
