/**
 * CLI command: noumena patch approve <vault> <review-id> --json
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.1:
 *   Exit 0: valid domain outcome (applied).
 *   Exit 4: vault/path/document/state error (review_not_found, etc.).
 *   Exit 5: internal failure.
 */

import { approvePatch } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

export function runPatchApprove(
  vaultPath: string,
  reviewId: string,
): never {
  const result = approvePatch(vaultPath, reviewId);

  if (!result.ok) {
    const r = result as { ok: false; code: string; message: string };
    const exitCode = r.code === "review_not_found" ? 4
      : r.code === "review_not_pending" ? 4
      : 5;
    writeJsonError("patch.approve", r.code, r.message, exitCode);
  }

  const res = result as Record<string, unknown>;
  writeJsonResult(res, 0);
}
