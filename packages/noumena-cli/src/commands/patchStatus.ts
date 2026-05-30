import { patchStatus } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

export function runPatchStatus(vaultPath: string, id: string): never {
  const result = patchStatus(vaultPath, id);
  if (!result.ok) {
    const exitCode = result.code === "patch_not_found" ? 4 : 5;
    writeJsonError("patch.status", result.code, result.message, exitCode);
  }
  writeJsonResult(result);
}
