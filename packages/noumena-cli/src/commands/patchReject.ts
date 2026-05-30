import { rejectPatch } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

export function runPatchReject(vaultPath: string, reviewId: string): never {
  const result = rejectPatch(vaultPath, reviewId);
  if (!result.ok) {
    const exitCode = result.code === "review_not_found" || result.code === "review_not_pending" ? 4 : 5;
    writeJsonError("patch.reject", result.code, result.message, exitCode);
  }
  writeJsonResult(result);
}
