import { PatchSchemaValidationError, submitPatch } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

export function runPatchSubmit(vaultPath: string, docPath: string, patchFile: string): never {
  try {
    const result = submitPatch(vaultPath, docPath, patchFile);
    if (!result.ok) {
      const exitCode = result.code === "patch_schema_invalid" ? 3
        : result.code === "vault_not_initialized" || result.code === "document_not_found" || result.code === "path_escapes_vault" ? 4
          : 5;
      writeJsonError("patch.submit", result.code, result.message, exitCode, { document: docPath });
    }
    writeJsonResult(result);
  } catch (err) {
    if (err instanceof PatchSchemaValidationError) {
      writeJsonError("patch.submit", "patch_schema_invalid", err.message, 3, { errors: err.errors });
    }
    writeJsonError("patch.submit", "internal_error", (err as Error).message, 5);
  }
}
