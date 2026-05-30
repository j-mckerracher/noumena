#!/usr/bin/env node

/**
 * Noumena CLI entrypoint.
 *
 * Phase 1 Implementation Plan §7 — CLI contract:
 *   Exit 0: valid domain outcome
 *   Exit 2: CLI usage error
 *
 * Prints usage and exits 2 on unknown commands.
 */

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

  // Unknown command — print usage and exit 2
  process.stderr.write(`Unknown command: ${args.join(" ")}\n\n`);
  process.stderr.write(USAGE);
  process.exit(2);
}

main();
