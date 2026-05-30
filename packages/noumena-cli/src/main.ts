#!/usr/bin/env node

/**
 * Noumena CLI entrypoint.
 *
 * Phase 1 Implementation Plan §7 — CLI contract:
 *   Exit 0: valid domain outcome
 *   Exit 2: CLI usage error
 *   Exit 3: patch JSON parse/schema error
 *   Exit 4: vault/path/document error
 *   Exit 5: internal failure
 *
 * Hard rule: noumena-cli must contain command plumbing only.
 * All logic lives in noumena-core.
 */

import { runVaultInit } from "./commands/vaultInit.js";
import { runVaultDoctor } from "./commands/vaultDoctor.js";
import { runDocCreate } from "./commands/docCreate.js";
import { runDocInfo } from "./commands/docInfo.js";
import { runDocValidate } from "./commands/docValidate.js";
import { runPatchSubmit } from "./commands/patchSubmit.js";
import { runPatchDryRun } from "./commands/patchDryRun.js";
import { runPatchApprove } from "./commands/patchApprove.js";
import { runPatchReject } from "./commands/patchReject.js";
import { runPatchRollback } from "./commands/patchRollback.js";
import { runPatchStatus } from "./commands/patchStatus.js";
import { runPatchShow } from "./commands/patchShow.js";

const USAGE = `Usage: noumena <command> [options]

Commands:
  vault init <vault> --json           Initialize a new vault
  vault doctor <vault> --json         Check vault health
  doc create <vault> <path> --json    Create a document
  doc info <vault> <path> --json      Inspect a document
  doc validate <vault> <path> --json  Validate a document
  patch submit <vault> <doc> <patch>  Submit a patch
  patch dry-run <vault> <doc> <patch> Dry-run a patch
  patch approve <vault> <review-id>   Approve a queued review
  patch reject <vault> <review-id>    Reject a queued review
  patch rollback <vault> <patch-id>   Roll back latest patch
  patch status <vault> <id>           Show patch/review status
  patch show <vault> <id>             Show patch diff

Options:
  --json    Output structured JSON to stdout
  --help    Show this help message
`;

function main(): void {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help")) {
    process.stderr.write(USAGE);
    process.exit(2);
  }

  // Extract command group and subcommand
  const [group, sub, ...rest] = args.filter((a) => !a.startsWith("--"));

  // Route commands
  // Extract named options
  const allArgs = process.argv.slice(2);
  const getOption = (name: string): string | undefined => {
    const prefix = `--${name}=`;
    const found = allArgs.find((a) => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : undefined;
  };

  if (group === "vault" && sub === "init") {
    const vaultPath = rest[0];
    if (!vaultPath) {
      process.stderr.write("Error: vault path required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runVaultInit(vaultPath);
    return;
  }

  if (group === "vault" && sub === "doctor") {
    const vaultPath = rest[0];
    if (!vaultPath) {
      process.stderr.write("Error: vault path required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runVaultDoctor(vaultPath);
    return;
  }

  if (group === "doc" && sub === "create") {
    const vaultPath = rest[0];
    const docPath = rest[1];
    if (!vaultPath || !docPath) {
      process.stderr.write("Error: vault path and document path required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    const docType = getOption("type") ?? "research-note";
    const title = getOption("title") ?? docPath;
    runDocCreate(vaultPath, docPath, docType, title);
    return;
  }

  if (group === "doc" && sub === "info") {
    const vaultPath = rest[0];
    const docPath = rest[1];
    if (!vaultPath || !docPath) {
      process.stderr.write("Error: vault path and document path required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runDocInfo(vaultPath, docPath);
    return;
  }

  if (group === "doc" && sub === "validate") {
    const vaultPath = rest[0];
    const docPath = rest[1];
    if (!vaultPath || !docPath) {
      process.stderr.write("Error: vault path and document path required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runDocValidate(vaultPath, docPath);
    return;
  }

  if (group === "patch" && sub === "submit") {
    const vaultPath = rest[0];
    const docPath = rest[1];
    const patchFile = rest[2];
    if (!vaultPath || !docPath || !patchFile) {
      process.stderr.write("Error: vault path, document path, and patch file required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runPatchSubmit(vaultPath, docPath, patchFile);
    return;
  }

  if (group === "patch" && sub === "dry-run") {
    const vaultPath = rest[0];
    const docPath = rest[1];
    const patchFile = rest[2];
    if (!vaultPath || !docPath || !patchFile) {
      process.stderr.write("Error: vault path, document path, and patch file required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runPatchDryRun(vaultPath, docPath, patchFile);
    return;
  }

  if (group === "patch" && sub === "approve") {
    const vaultPath = rest[0];
    const reviewId = rest[1];
    if (!vaultPath || !reviewId) {
      process.stderr.write("Error: vault path and review ID required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runPatchApprove(vaultPath, reviewId);
    return;
  }

  if (group === "patch" && sub === "reject") {
    const vaultPath = rest[0];
    const reviewId = rest[1];
    if (!vaultPath || !reviewId) {
      process.stderr.write("Error: vault path and review ID required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runPatchReject(vaultPath, reviewId);
    return;
  }

  if (group === "patch" && sub === "rollback") {
    const vaultPath = rest[0];
    const patchId = rest[1];
    if (!vaultPath || !patchId) {
      process.stderr.write("Error: vault path and patch ID required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runPatchRollback(vaultPath, patchId);
    return;
  }

  if (group === "patch" && sub === "status") {
    const vaultPath = rest[0];
    const id = rest[1];
    if (!vaultPath || !id) {
      process.stderr.write("Error: vault path and ID required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    runPatchStatus(vaultPath, id);
    return;
  }

  if (group === "patch" && sub === "show") {
    const vaultPath = rest[0];
    const id = rest[1];
    if (!vaultPath || !id) {
      process.stderr.write("Error: vault path and ID required\n\n");
      process.stderr.write(USAGE);
      process.exit(2);
    }
    const format = getOption("format");
    const jsonMode = allArgs.includes("--json");
    runPatchShow(vaultPath, id, format, jsonMode);
    return;
  }

  // Unknown command — print usage and exit 2
  process.stderr.write(`Unknown command: ${args.join(" ")}\n\n`);
  process.stderr.write(USAGE);
  process.exit(2);
}

main();
