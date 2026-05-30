/**
 * CLI command: noumena patch rollback <vault> <patch-id> --json
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.1:
 *   Exit 0: valid domain outcome (rolled back successfully).
 *   Exit 4: vault/path/document/state error (patch_not_found, etc.).
 *   Exit 5: internal failure.
 */

import { rollbackPatch } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

export function runPatchRollback(
  vaultPath: string,
  patchId: string,
): never {
  const result = rollbackPatch(vaultPath, patchId);

  if (!result.ok) {
    const r = result as { ok: false; code: string; message: string };
    const exitCode = r.code === "patch_not_found" ? 4
      : r.code === "patch_not_applied" ? 4
      : r.code === "rollback_not_latest" ? 4
      : r.code === "snapshot_not_found" ? 4
      : 5;
    writeJsonError("patch.rollback", r.code, r.message, exitCode);
  }

  const res = result as Record<string, unknown>;
  writeJsonResult(res, 0);
}
