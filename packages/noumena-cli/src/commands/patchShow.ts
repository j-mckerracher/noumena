/**
 * CLI command: noumena patch show <vault> <id> [--format=block-diff] [--json]
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.1:
 *   --json → structured JSON to stdout.
 *   --format=block-diff without --json → human-readable terminal diff:
 *     ANSI color when stdout is a TTY, plain text when piped.
 */

import { patchShow } from "@noumena/core";
import { writeJsonResult, writeJsonError } from "../output.js";

// ---------------------------------------------------------------------------
// ANSI helpers — only emitted when stdout is a TTY
// ---------------------------------------------------------------------------
const isTTY = process.stdout.isTTY ?? false;
const RESET = isTTY ? "\x1b[0m" : "";
const BOLD = isTTY ? "\x1b[1m" : "";
const DIM = isTTY ? "\x1b[2m" : "";
const RED = isTTY ? "\x1b[31m" : "";
const GREEN = isTTY ? "\x1b[32m" : "";
const CYAN = isTTY ? "\x1b[36m" : "";
const YELLOW = isTTY ? "\x1b[33m" : "";

/**
 * Render a human-readable block diff to stdout.
 */
function renderBlockDiff(result: Record<string, unknown>): void {
  const lines: string[] = [];

  lines.push(`${BOLD}Patch:${RESET} ${result.patchId}`);
  lines.push(`${BOLD}Document:${RESET} ${result.document}`);
  lines.push(`${BOLD}Status:${RESET} ${result.status}`);
  if (result.author) lines.push(`${BOLD}Author:${RESET} ${result.author}`);
  if (result.intent) lines.push(`${BOLD}Intent:${RESET} ${result.intent}`);
  lines.push("");

  const blockDiffs = result.blockDiffs as Array<{
    blockId: string;
    role: string;
    before: string;
    after: string;
  }> | undefined;

  if (blockDiffs && blockDiffs.length > 0) {
    for (const diff of blockDiffs) {
      lines.push(`${CYAN}${BOLD}--- ${diff.role} [${diff.blockId}]${RESET}`);

      // Before
      if (diff.before) {
        const beforeLines = diff.before.split("\n");
        for (const line of beforeLines) {
          lines.push(`${RED}- ${line}${RESET}`);
        }
      } else {
        lines.push(`${DIM}(new block)${RESET}`);
      }

      // After
      if (diff.after) {
        const afterLines = diff.after.split("\n");
        for (const line of afterLines) {
          lines.push(`${GREEN}+ ${line}${RESET}`);
        }
      } else {
        lines.push(`${DIM}(block removed)${RESET}`);
      }
      lines.push("");
    }
  } else {
    lines.push(`${DIM}No block changes.${RESET}`);
    lines.push("");
  }

  if (result.proposedSummaryHtml !== undefined) {
    lines.push(`${YELLOW}${BOLD}Proposed Summary (raw HTML):${RESET}`);
    lines.push(String(result.proposedSummaryHtml));
    lines.push("");
  }

  process.stdout.write(lines.join("\n") + "\n");
}

export function runPatchShow(
  vaultPath: string,
  id: string,
  format?: string,
  jsonMode?: boolean,
): never {
  const result = patchShow(vaultPath, id, format);

  if (!result.ok) {
    const r = result as { ok: false; code: string; message: string };
    const exitCode = r.code === "patch_not_found" ? 4
      : r.code === "patch_json_missing" ? 4
      : 5;
    writeJsonError("patch.show", r.code, r.message, exitCode);
  }

  const res = result as Record<string, unknown>;

  // Human-readable output for block-diff when --json is not requested
  if (format === "block-diff" && !jsonMode) {
    renderBlockDiff(res);
    process.exit(0);
  }

  writeJsonResult(res, 0);
}
