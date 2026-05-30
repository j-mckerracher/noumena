/**
 * Tests for db.ts — SQLite schema and CRUD operations.
 *
 * DoD: SQLite DB created with all required tables
 * DoD: Pre-mutation snapshot written for every applied patch
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  createVaultDatabase,
  upsertDocument,
  getDocument,
  replaceBlocks,
  getBlocks,
  insertPatch,
  getPatch,
  getPatchByClientId,
  getLatestAppliedPatch,
  insertReview,
  getReview,
  insertHistoryEvent,
  getHistoryEvents,
  writeSnapshot,
  writePatchJson,
  writeReviewDiff,
} from "../src/db.js";
import type { Database as DatabaseType } from "better-sqlite3";

describe("db", () => {
  let tmpDir: string;
  let vaultPath: string;
  let db: DatabaseType;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "noumena-db-test-"));
    vaultPath = path.join(tmpDir, "TestVault");
    fs.mkdirSync(path.join(vaultPath, ".noumena"), { recursive: true });
    db = createVaultDatabase(vaultPath);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("schema", () => {
    it("creates all five required tables", () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];

      const names = tables.map((t) => t.name);
      expect(names).toContain("documents");
      expect(names).toContain("blocks");
      expect(names).toContain("patches");
      expect(names).toContain("reviews");
      expect(names).toContain("history_events");
    });
  });

  describe("documents", () => {
    it("inserts and retrieves a document", () => {
      upsertDocument(db, {
        path: "research/test.html",
        document_id: "doc_TEST",
        title: "Test Doc",
        file_class: "noumena_native",
        schema_version: "noumena.html.v1",
        document_type: "research-note",
        revision: "sha256:abc",
        logical_version: 1,
        indexed_at: new Date().toISOString(),
        modified_at: null,
      });

      const doc = getDocument(db, "research/test.html");
      expect(doc).toBeDefined();
      expect(doc!.document_id).toBe("doc_TEST");
      expect(doc!.title).toBe("Test Doc");
      expect(doc!.logical_version).toBe(1);
    });

    it("upserts (updates existing)", () => {
      upsertDocument(db, {
        path: "test.html",
        document_id: "doc_1",
        title: "v1",
        file_class: "noumena_native",
        schema_version: null,
        document_type: null,
        revision: "sha256:v1",
        logical_version: 1,
        indexed_at: new Date().toISOString(),
        modified_at: null,
      });

      upsertDocument(db, {
        path: "test.html",
        document_id: "doc_1",
        title: "v2",
        file_class: "noumena_native",
        schema_version: null,
        document_type: null,
        revision: "sha256:v2",
        logical_version: 2,
        indexed_at: new Date().toISOString(),
        modified_at: null,
      });

      const doc = getDocument(db, "test.html");
      expect(doc!.title).toBe("v2");
      expect(doc!.logical_version).toBe(2);
    });
  });

  describe("blocks", () => {
    it("replaces blocks for a document", () => {
      replaceBlocks(db, "test.html", [
        {
          path: "test.html",
          block_id: "blk_1",
          role: "metadata",
          policy: "merge_text",
          block_hash: "sha256:m1",
          required: 1,
          known: 1,
        },
        {
          path: "test.html",
          block_id: "blk_2",
          role: "summary",
          policy: "replace_requires_clean_base",
          block_hash: "sha256:s1",
          required: 1,
          known: 1,
        },
      ]);

      const blocks = getBlocks(db, "test.html");
      expect(blocks).toHaveLength(2);
      expect(blocks[0].role).toBe("metadata");
      expect(blocks[1].role).toBe("summary");
    });
  });

  describe("patches", () => {
    it("inserts and retrieves a patch", () => {
      insertPatch(db, {
        patch_id: "patch_ABC",
        client_patch_id: "client-abc",
        path: "test.html",
        status: "applied",
        author_name: "Claude",
        author_type: "agent",
        intent: "Add evidence",
        base_revision: "sha256:base",
        previous_revision: "sha256:prev",
        revision: "sha256:new",
        patch_json_path: ".noumena/history/patches/patch_ABC.json",
        diff_path: null,
        snapshot_path: null,
        created_at: new Date().toISOString(),
        applied_at: new Date().toISOString(),
      });

      const p = getPatch(db, "patch_ABC");
      expect(p).toBeDefined();
      expect(p!.status).toBe("applied");
    });

    it("finds patch by client_patch_id (idempotency)", () => {
      insertPatch(db, {
        patch_id: "patch_XYZ",
        client_patch_id: "client-xyz",
        path: "test.html",
        status: "applied",
        author_name: null,
        author_type: null,
        intent: null,
        base_revision: null,
        previous_revision: null,
        revision: null,
        patch_json_path: null,
        diff_path: null,
        snapshot_path: null,
        created_at: new Date().toISOString(),
        applied_at: null,
      });

      const p = getPatchByClientId(db, "client-xyz");
      expect(p).toBeDefined();
      expect(p!.patch_id).toBe("patch_XYZ");
    });

    it("gets latest applied patch for a document", () => {
      const now = new Date();
      insertPatch(db, {
        patch_id: "patch_1",
        client_patch_id: "c1",
        path: "test.html",
        status: "applied",
        author_name: null,
        author_type: null,
        intent: null,
        base_revision: null,
        previous_revision: null,
        revision: null,
        patch_json_path: null,
        diff_path: null,
        snapshot_path: null,
        created_at: now.toISOString(),
        applied_at: new Date(now.getTime() - 1000).toISOString(),
      });

      insertPatch(db, {
        patch_id: "patch_2",
        client_patch_id: "c2",
        path: "test.html",
        status: "applied",
        author_name: null,
        author_type: null,
        intent: null,
        base_revision: null,
        previous_revision: null,
        revision: null,
        patch_json_path: null,
        diff_path: null,
        snapshot_path: null,
        created_at: now.toISOString(),
        applied_at: now.toISOString(),
      });

      const latest = getLatestAppliedPatch(db, "test.html");
      expect(latest).toBeDefined();
      expect(latest!.patch_id).toBe("patch_2");
    });
  });

  describe("reviews", () => {
    it("inserts and retrieves a review", () => {
      insertReview(db, {
        review_id: "rev_ABC",
        patch_id: "patch_ABC",
        path: "test.html",
        status: "pending",
        base_revision: "sha256:base",
        review_json_path: ".noumena/reviews/rev_ABC.json",
        diff_path: ".noumena/reviews/rev_ABC.diff",
        queued_at: new Date().toISOString(),
        resolved_at: null,
      });

      const r = getReview(db, "rev_ABC");
      expect(r).toBeDefined();
      expect(r!.status).toBe("pending");
    });
  });

  describe("history_events", () => {
    it("inserts and retrieves history events", () => {
      insertHistoryEvent(db, {
        event_id: "evt_1",
        path: "test.html",
        kind: "patch_applied",
        patch_id: "patch_1",
        review_id: null,
        revision_before: "sha256:a",
        revision_after: "sha256:b",
        created_at: new Date().toISOString(),
        data_json: null,
      });

      const events = getHistoryEvents(db, "test.html");
      expect(events).toHaveLength(1);
      expect(events[0].kind).toBe("patch_applied");
    });
  });

  describe("file writers", () => {
    it("writes snapshot to correct path", () => {
      const snapshotPath = writeSnapshot(
        vaultPath,
        "research/test.html",
        "patch_ABC",
        "<html>before</html>",
      );

      expect(snapshotPath).toContain(".noumena/history/snapshots/");
      expect(snapshotPath).toContain("patch_ABC.before.html");

      const absPath = path.join(vaultPath, snapshotPath);
      expect(fs.existsSync(absPath)).toBe(true);
      expect(fs.readFileSync(absPath, "utf-8")).toBe("<html>before</html>");
    });

    it("writes patch JSON to correct path", () => {
      const patchPath = writePatchJson(
        vaultPath,
        "patch_ABC",
        '{"op":"test"}',
      );

      expect(patchPath).toBe(".noumena/history/patches/patch_ABC.json");
      const absPath = path.join(vaultPath, patchPath);
      expect(fs.existsSync(absPath)).toBe(true);
    });

    it("writes review diff to correct path", () => {
      const diffPath = writeReviewDiff(
        vaultPath,
        "rev_ABC",
        "diff content",
      );

      expect(diffPath).toBe(".noumena/reviews/rev_ABC.diff");
      const absPath = path.join(vaultPath, diffPath);
      expect(fs.existsSync(absPath)).toBe(true);
    });
  });
});
