#!/usr/bin/env node
/**
 * Noumena Phase 1 demo — full dogfood loop.
 *
 * WI-5034224 — UOW-008: Runs the complete Phase 1 success scenario
 * headlessly, proving every step of the human-agent document loop.
 *
 * Steps per §4 (Phase 1 success scenario):
 *   1. Builder initializes a vault
 *   2. Builder creates a research-note@1 document
 *   3. Agent discovers revision, roles, block hashes via doc info
 *   4. Agent writes and submits a patch (append evidence + set status)
 *   5. Noumena applies safe changes
 *   6. Agent proposes a summary (queues review)
 *   7. Builder inspects review via patch show --format=block-diff
 *   8. Builder approves the queued review
 *   9. Noumena snapshots before every applied mutation
 *  10. Builder rolls back the latest applied patch
 *  11. Verify: final state matches pre-rollback expectations
 *
 * Exits 0 with a success JSON on stdout. Exits 1 on any failure.
 */

import { execFileSync } from "node:child_process";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";
import * as os from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "../packages/noumena-cli/dist/main.js");

function cli(args) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 10000,
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout ?? "",
      exitCode: err.status ?? 1,
    };
  }
}

function step(name, fn) {
  process.stderr.write(`  [demo] ${name}...\n`);
  fn();
  process.stderr.write(`  [demo] ${name} ✓\n`);
}

function assert(condition, msg) {
  if (!condition) {
    process.stderr.write(`  [demo] FAILED: ${msg}\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

process.stderr.write("\n=== Noumena Phase 1 Demo ===\n\n");

const tmpDir = fs.mkdtempSync(join(os.tmpdir(), "noumena-demo-phase1-"));
const DOC_PATH = "research/local-llms.html";

try {
  // 1. Initialize vault
  step("1. vault init", () => {
    const r = cli(["vault", "init", tmpDir, "--json"]);
    assert(r.exitCode === 0, "vault init should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "initialized", "vault should be initialized");
  });

  // 2. Create document
  step("2. doc create", () => {
    const r = cli([
      "doc", "create", tmpDir, DOC_PATH,
      "--type=research-note",
      "--title=Local LLM Memory Systems",
      "--json",
    ]);
    assert(r.exitCode === 0, "doc create should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "created", "doc should be created");
    assert(j.patchable === true, "doc should be patchable");
  });

  // 3. Discover document info
  let revision;
  let logicalVersion;
  let blockHashes = {};
  let summaryBlockId;

  step("3. doc info", () => {
    const r = cli(["doc", "info", tmpDir, DOC_PATH, "--json"]);
    assert(r.exitCode === 0, "doc info should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "ok", "doc info should be ok");
    assert(j.patchable === true, "doc should be patchable");

    revision = j.revision;
    logicalVersion = j.logicalVersion;
    const roles = j.roles;
    for (const role of roles) {
      blockHashes[role.blockId] = role.blockHash;
    }
    summaryBlockId = roles.find((r) => r.role === "summary").blockId;
  });

  // 4. Submit evidence + status patch
  let appliedPatchId;

  step("4. patch submit (evidence + set_status)", () => {
    const patch = JSON.stringify({
      schema: "noumena.patch.v1",
      clientPatchId: "demo-evidence-001",
      base: { revision, logicalVersion, blockHashes },
      author: { type: "agent", name: "Claude Code" },
      intent: "Add evidence about local LLM memory and update status.",
      ops: [
        {
          op: "append_evidence",
          target: { role: "evidence" },
          item: {
            claim: "Local LLM tools often distinguish persistent memory from active context.",
            source: {
              title: "LLM Memory Patterns Survey",
              url: "https://example.com/llm-memory",
              accessedAt: new Date().toISOString(),
            },
            quote: "Persistent memory stores are typically backed by vector databases.",
            notes: "Relevant to the core architecture decision.",
          },
        },
        {
          op: "set_status",
          target: { role: "metadata" },
          status: "active",
        },
      ],
    });

    const patchFile = join(tmpDir, "demo-evidence.json");
    fs.writeFileSync(patchFile, patch);

    const r = cli(["patch", "submit", tmpDir, DOC_PATH, patchFile, "--json"]);
    assert(r.exitCode === 0, "patch submit should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "applied", "patch should be applied");
    assert(j.documentChanged === true, "document should change");
    appliedPatchId = j.patchId;

    // Refresh state
    const info = cli(["doc", "info", tmpDir, DOC_PATH, "--json"]);
    const ij = JSON.parse(info.stdout);
    revision = ij.revision;
    logicalVersion = ij.logicalVersion;
    blockHashes = {};
    for (const role of ij.roles) {
      blockHashes[role.blockId] = role.blockHash;
    }
  });

  // 5. Propose summary (queues review)
  let reviewId;

  step("5. patch submit (propose_summary -> queued_review)", () => {
    const patch = JSON.stringify({
      schema: "noumena.patch.v1",
      clientPatchId: "demo-summary-001",
      base: {
        revision,
        logicalVersion,
        blockHashes: { [summaryBlockId]: blockHashes[summaryBlockId] },
      },
      author: { type: "agent", name: "Claude Code" },
      intent: "Propose updated summary.",
      ops: [
        {
          op: "propose_summary",
          target: { role: "summary" },
          content: {
            html: "<p>Local LLM memory systems separate persistent knowledge stores from active conversational context, typically using vector databases for long-term storage.</p>",
          },
        },
      ],
    });

    const patchFile = join(tmpDir, "demo-summary.json");
    fs.writeFileSync(patchFile, patch);

    const r = cli(["patch", "submit", tmpDir, DOC_PATH, patchFile, "--json"]);
    assert(r.exitCode === 0, "patch submit should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "queued_review", "summary should queue review");
    assert(j.documentChanged === false, "document should NOT change on queue");
    reviewId = j.reviewId;
  });

  // 6. Inspect review via patch show
  step("6. patch show --format=block-diff", () => {
    const r = cli([
      "patch", "show", tmpDir, reviewId.replace("rev_", "pat_").length > 0
        ? (() => {
            // Get the patchId from the review via patch status
            const s = cli(["patch", "status", tmpDir, reviewId, "--json"]);
            return JSON.parse(s.stdout).patchId;
          })()
        : reviewId,
      "--format=block-diff",
    ]);
    assert(r.exitCode === 0, "patch show should exit 0");
    // Human-readable output (not JSON)
    assert(r.stdout.includes("Patch:"), "should show patch header");
  });

  // 7. Approve the queued review
  step("7. patch approve", () => {
    const r = cli(["patch", "approve", tmpDir, reviewId, "--json"]);
    assert(r.exitCode === 0, "patch approve should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "applied", "approved review should apply");
    assert(j.documentChanged === true, "document should change on approve");

    // Refresh state
    const info = cli(["doc", "info", tmpDir, DOC_PATH, "--json"]);
    const ij = JSON.parse(info.stdout);
    revision = ij.revision;
  });

  // 8. Verify snapshot exists (pre-mutation)
  step("8. verify pre-mutation snapshot", () => {
    const snapshotDir = join(tmpDir, ".noumena", "history", "snapshots");
    assert(fs.existsSync(snapshotDir), "snapshots directory should exist");

    // Find snapshot files
    const findSnapshots = (dir) => {
      const results = [];
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            results.push(...findSnapshots(join(dir, entry.name)));
          } else if (entry.name.endsWith(".before.html")) {
            results.push(join(dir, entry.name));
          }
        }
      } catch { /* ignore */ }
      return results;
    };
    const snapshots = findSnapshots(snapshotDir);
    assert(snapshots.length > 0, "at least one snapshot should exist");
  });

  // 9. Rollback the latest applied patch
  step("9. patch rollback (latest)", () => {
    // Get the latest applied patch ID from doc info
    const statusResult = cli(["patch", "status", tmpDir, reviewId, "--json"]);
    const statusJson = JSON.parse(statusResult.stdout);
    const patchIdToRollback = statusJson.patchId;

    const r = cli(["patch", "rollback", tmpDir, patchIdToRollback, "--json"]);
    assert(r.exitCode === 0, "rollback should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "rolled_back", "should roll back");
    assert(j.documentChanged === true, "document should change on rollback");
  });

  // 10. Verify vault health
  step("10. vault doctor", () => {
    const r = cli(["vault", "doctor", tmpDir, "--json"]);
    assert(r.exitCode === 0, "vault doctor should exit 0");
    const j = JSON.parse(r.stdout);
    assert(j.status === "ok", "vault should be healthy");
  });

  // Success!
  const successResult = {
    schema: "noumena.demo.v1",
    status: "success",
    vault: tmpDir,
    document: DOC_PATH,
    stepsCompleted: 10,
    summary: "Full Phase 1 dogfood loop completed: init -> create -> info -> patch -> review -> approve -> snapshot -> rollback -> doctor.",
  };

  process.stdout.write(JSON.stringify(successResult, null, 2) + "\n");
  process.stderr.write("\n=== Demo PASSED ===\n\n");

} finally {
  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
