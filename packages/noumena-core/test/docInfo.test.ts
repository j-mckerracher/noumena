/**
 * Tests for getDocInfo.
 *
 * WI-5034224 — AC-006: doc info returns all fields including blockHash and allowedPhase1Ops.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createDocument,
  getDocInfo,
  initVault,
} from "@noumena/core";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-info-test-"));
  initVault(tmpDir).vault.db.close();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getDocInfo", () => {
  it("returns all fields for a valid patchable document", () => {
    createDocument(tmpDir, "note.html", "research-note", "Test Note");
    const result = getDocInfo(tmpDir, "note.html");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.patchable).toBe(true);
    expect(result.fileClass).toBe("noumena_native");
    expect(result.documentId).toMatch(/^doc_/);
    expect(result.title).toBe("Test Note");
    expect(result.revision).toMatch(/^sha256:/);
    expect(result.logicalVersion).toBe(1);
    expect(result.schemaVersion).toBe("noumena.html.v1");
    expect(result.documentType).toBe("research-note");
  });

  it("returns blockHash per role", () => {
    createDocument(tmpDir, "note.html", "research-note", "Hash Test");
    const result = getDocInfo(tmpDir, "note.html");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.roles.length).toBe(5);
    const roleNames = result.roles.map((r) => r.role);
    expect(roleNames).toContain("metadata");
    expect(roleNames).toContain("summary");
    expect(roleNames).toContain("notes");
    expect(roleNames).toContain("evidence");
    expect(roleNames).toContain("agent_events");

    for (const role of result.roles) {
      expect(role.blockId).toMatch(/^blk_/);
      expect(role.blockHash).toMatch(/^sha256:/);
      expect(role.present).toBe(true);
      expect(role.known).toBe(true);
      expect(role.required).toBe(true);
    }
  });

  it("returns correct allowedPhase1Ops for non-locked document", () => {
    createDocument(tmpDir, "note.html", "research-note", "Ops Test");
    const result = getDocInfo(tmpDir, "note.html");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.allowedPhase1Ops).toContain("append_evidence");
    expect(result.allowedPhase1Ops).toContain("append_note");
    expect(result.allowedPhase1Ops).toContain("set_status");
    expect(result.allowedPhase1Ops).toContain("set_metadata");
    expect(result.allowedPhase1Ops).toContain("append_agent_event");
    expect(result.allowedPhase1Ops).toContain("propose_summary");
  });

  it("locked blocks are absent from allowedPhase1Ops", () => {
    // Create a document, then manually change evidence block's policy to locked
    createDocument(tmpDir, "note.html", "research-note", "Lock Test");

    const absPath = path.join(tmpDir, "note.html");
    let content = fs.readFileSync(absPath, "utf-8");
    // The canonical serializer puts each attribute on its own line in multi-attr tags.
    // Find the evidence block and change its policy.
    // Pattern: role="evidence" is on one line, policy="append_only" nearby.
    const lines = content.split("\n");
    let inEvidenceBlock = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.includes('data-noumena-role="evidence"')) {
        inEvidenceBlock = true;
      }
      if (inEvidenceBlock && lines[i]!.includes('data-conflict-policy="append_only"')) {
        lines[i] = lines[i]!.replace('data-conflict-policy="append_only"', 'data-conflict-policy="locked"');
        break;
      }
    }
    content = lines.join("\n");
    fs.writeFileSync(absPath, content, "utf-8");

    const result = getDocInfo(tmpDir, "note.html");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Evidence is locked, so append_evidence should NOT be in allowedPhase1Ops
    expect(result.allowedPhase1Ops).not.toContain("append_evidence");
    // Other ops should still be present
    expect(result.allowedPhase1Ops).toContain("append_note");
    expect(result.allowedPhase1Ops).toContain("set_status");
  });

  it("returns index freshness info", () => {
    createDocument(tmpDir, "note.html", "research-note", "Fresh Test");
    const result = getDocInfo(tmpDir, "note.html");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.index.fresh).toBe(true);
    expect(result.index.indexedRevision).toBe(result.revision);
  });

  it("returns error for missing document", () => {
    const result = getDocInfo(tmpDir, "nonexistent.html");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("document_not_found");
  });

  it("returns error for uninitialized vault", () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-empty-"));
    const result = getDocInfo(emptyDir, "note.html");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("vault_not_initialized");
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it("summary role reports requiresBlockHashForOps", () => {
    createDocument(tmpDir, "note.html", "research-note", "Hash Ops");
    const result = getDocInfo(tmpDir, "note.html");

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const summaryRole = result.roles.find((r) => r.role === "summary");
    expect(summaryRole).toBeDefined();
    expect(summaryRole!.requiresBlockHashForOps).toContain("propose_summary");
  });
});
