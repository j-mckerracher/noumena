/**
 * CLI command: noumena vault doctor <vault> --json
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.2, AC-004:
 *   Detects recoverable local consistency issues.
 */

import { runDoctor } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

/**
 * Execute the vault doctor command.
 */
export function runVaultDoctor(vaultPath: string): never {
  const result = runDoctor(vaultPath);

  if (!result.ok) {
    writeJsonError("vault.doctor", result.code, result.message, 4);
  }

  writeJsonResult(
    {
      schema: "noumena.cli.result.v1",
      command: "vault.doctor",
      status: "ok",
      vault: result.vault,
      issues: result.issues,
    },
    0,
  );
}
