/**
 * CLI integration tests for patch approve, rollback, and show commands.
 *
 * WI-5034224 — UOW-007: Exit-code contract and block-diff output.
 * Tests exercise the built CLI binary via execFileSync to verify:
 *   - stale_review approve exits 0 as a domain outcome
 *   - rollback_not_latest exits 0 as a domain outcome
 *   - patch show --format=block-diff outputs human-readable text (not JSON)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  initVault,
  createDocument,
  submitPatch,
  approvePatch,
  openDatabase,
  getBlocks,
  computeBlockHash,
  getDocument,
  parseNoumenaHtml,
  computeAllBlockHashes,
  computeRevisionFromDocument,
} from "@noumena/core";

const CLI_PATH = resolve(import.meta.dirname, "../dist/main.js");

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.status ?? 1,
    };
  }
}

let tmpDir: string;
let docPath: string;

/**
 * A simple patch that appends a note — always succeeds for any base revision
 * because append ops auto-merge.
 */
function makeAppendNotePatch(clientId: string): string {
  return JSON.stringify({
    schema: "noumena.patch.v1",
    clientPatchId: clientId,
    base: { revision: "sha256:placeholder", logicalVersion: 1, blockHashes: {} },
    author: { type: "agent", name: "test-agent" },
    intent: "Append test note",
    ops: [{
      op: "append_note",
      target: { role: "notes" },
      text: `Note from ${clientId}`,
    }],
  });
}

/**
 * A patch that proposes a summary — queues a review for approval.
 * Requires real blockHashes so stale_review check works.
 */
function makeProposeSummaryPatch(
  clientId: string,
  revision: string,
  logicalVersion: number,
  blockHashes: Record<string, string>,
): string {
  return JSON.stringify({
    schema: "noumena.patch.v1",
    clientPatchId: clientId,
    base: { revision, logicalVersion, blockHashes },
    author: { type: "agent", name: "test-agent" },
    intent: "Propose summary",
    ops: [{
      op: "propose_summary",
      target: { role: "summary" },
      content: { html: "<p>Test summary content.</p>" },
    }],
  });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-cli-patch-test-"));
  docPath = "test/note.html";

  // Initialize vault and create a document
  const vault = initVault(tmpDir);
  vault.vault.db.close();
  createDocument(tmpDir, docPath, "research-note", "Test Note");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("patch approve exit codes", () => {
  it("exits 0 with stale_review when block hash changed since review was queued", () => {
    // Compute real revision and block hashes from the current document
    const docAbsPath = path.join(tmpDir, docPath);
    const docHtml = fs.readFileSync(docAbsPath, "utf-8");
    const parsed = parseNoumenaHtml(docHtml);
    const doc = parsed.document!;
    const blockHashes: Record<string, string> = {};
    const hashMap = computeAllBlockHashes(doc);
    for (const [id, hash] of hashMap.entries()) {
      blockHashes[id] = hash;
    }
    const revision = computeRevisionFromDocument(doc);
    const db = openDatabase(tmpDir);
    const docRecord = getDocument(db, docPath);
    db.close();
    const logicalVersion = docRecord?.logical_version ?? 1;

    // 1. Submit a propose_summary patch (queues review) with real hashes
    const summaryPatch = makeProposeSummaryPatch("stale-test-001", revision, logicalVersion, blockHashes);
    const summaryPatchFile = path.join(tmpDir, "stale-patch.json");
    fs.writeFileSync(summaryPatchFile, summaryPatch);

    const submitResult = runCli([
      "patch", "submit", tmpDir, docPath, summaryPatchFile, "--json",
    ]);
    expect(submitResult.exitCode).toBe(0);
    const submitJson = JSON.parse(submitResult.stdout);
    expect(submitJson.status).toBe("queued_review");
    const reviewId = submitJson.reviewId as string;
    expect(reviewId).toBeTruthy();

    // 2. Modify the document by applying another patch (changes block hashes)
    const notePatch = makeAppendNotePatch("stale-modify-001");
    const notePatchFile = path.join(tmpDir, "modify-patch.json");
    fs.writeFileSync(notePatchFile, notePatch);

    const modifyResult = runCli([
      "patch", "submit", tmpDir, docPath, notePatchFile, "--json",
    ]);
    expect(modifyResult.exitCode).toBe(0);

    // 3. Approve the queued review — domain outcome, still exit 0
    const approveResult = runCli([
      "patch", "approve", tmpDir, reviewId, "--json",
    ]);
    expect(approveResult.exitCode).toBe(0);
    const approveJson = JSON.parse(approveResult.stdout);
    expect(approveJson.status).toBe("stale_review");
    expect(approveJson.reason.code).toBe("stale_review");
  });
});

describe("patch rollback exit codes", () => {
  it("exits 0 with rollback_not_latest when rolling back a non-latest patch", () => {
    // 1. Submit two patches to get two patch IDs
    const patch1 = makeAppendNotePatch("rollback-test-001");
    const patch1File = path.join(tmpDir, "rollback-patch1.json");
    fs.writeFileSync(patch1File, patch1);

    const submit1 = runCli([
      "patch", "submit", tmpDir, docPath, patch1File, "--json",
    ]);
    expect(submit1.exitCode).toBe(0);
    const patchId1 = JSON.parse(submit1.stdout).patchId as string;

    const patch2 = makeAppendNotePatch("rollback-test-002");
    const patch2File = path.join(tmpDir, "rollback-patch2.json");
    fs.writeFileSync(patch2File, patch2);

    const submit2 = runCli([
      "patch", "submit", tmpDir, docPath, patch2File, "--json",
    ]);
    expect(submit2.exitCode).toBe(0);

    // 2. Try to rollback the first (non-latest) patch — domain outcome, still exit 0
    const rollbackResult = runCli([
      "patch", "rollback", tmpDir, patchId1, "--json",
    ]);
    expect(rollbackResult.exitCode).toBe(0);
    const rollbackJson = JSON.parse(rollbackResult.stdout);
    expect(rollbackJson.status).toBe("rollback_not_latest");
    expect(rollbackJson.reason.code).toBe("rollback_not_latest");
  });
});

describe("patch show --format=block-diff", () => {
  it("outputs human-readable diff without --json", () => {
    // Submit a patch first
    const patch = makeAppendNotePatch("show-test-001");
    const patchFile = path.join(tmpDir, "show-patch.json");
    fs.writeFileSync(patchFile, patch);

    const submitResult = runCli([
      "patch", "submit", tmpDir, docPath, patchFile, "--json",
    ]);
    expect(submitResult.exitCode).toBe(0);
    const patchId = JSON.parse(submitResult.stdout).patchId as string;

    // Show with --format=block-diff (no --json) → human-readable
    const showResult = runCli([
      "patch", "show", tmpDir, patchId, "--format=block-diff",
    ]);
    expect(showResult.exitCode).toBe(0);
    // Should NOT be valid JSON (it's human-readable text)
    expect(() => JSON.parse(showResult.stdout)).toThrow();
    // Should contain block diff markers
    expect(showResult.stdout).toContain("Patch:");
    expect(showResult.stdout).toContain(patchId);
  });

  it("outputs JSON with --json flag", () => {
    // Reuse a patch ID — submit another one
    const patch = makeAppendNotePatch("show-json-test-001");
    const patchFile = path.join(tmpDir, "show-json-patch.json");
    fs.writeFileSync(patchFile, patch);

    const submitResult = runCli([
      "patch", "submit", tmpDir, docPath, patchFile, "--json",
    ]);
    expect(submitResult.exitCode).toBe(0);
    const patchId = JSON.parse(submitResult.stdout).patchId as string;

    // Show with --format=block-diff --json → JSON output
    const showResult = runCli([
      "patch", "show", tmpDir, patchId, "--format=block-diff", "--json",
    ]);
    expect(showResult.exitCode).toBe(0);
    const showJson = JSON.parse(showResult.stdout);
    expect(showJson.format).toBe("block-diff");
    expect(showJson.blockDiffs).toBeDefined();
  });
});
