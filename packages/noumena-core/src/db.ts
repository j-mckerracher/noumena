/**
 * SQLite derived state store for Noumena vaults.
 *
 * Phase 1 Implementation Plan §20 — SQLite derived state:
 *   Tables: documents, blocks, patches, reviews, history_events
 *   SQLite is derived state, not the canonical document source.
 */

import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";

// Re-export the Database type for external use
export type { DatabaseType };

/** Schema version for migration tracking. */
const SCHEMA_VERSION = 1;

/** SQL statements to create the initial schema per PDF §20. */
const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS documents (
  path TEXT PRIMARY KEY,
  document_id TEXT,
  title TEXT,
  file_class TEXT NOT NULL,
  schema_version TEXT,
  document_type TEXT,
  revision TEXT NOT NULL,
  logical_version INTEGER NOT NULL,
  indexed_at TEXT NOT NULL,
  modified_at TEXT
);

CREATE TABLE IF NOT EXISTS blocks (
  path TEXT NOT NULL,
  block_id TEXT NOT NULL,
  role TEXT NOT NULL,
  policy TEXT NOT NULL,
  block_hash TEXT NOT NULL,
  required INTEGER NOT NULL,
  known INTEGER NOT NULL,
  PRIMARY KEY (path, block_id)
);

CREATE TABLE IF NOT EXISTS patches (
  patch_id TEXT PRIMARY KEY,
  client_patch_id TEXT UNIQUE,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  author_name TEXT,
  author_type TEXT,
  intent TEXT,
  base_revision TEXT,
  previous_revision TEXT,
  revision TEXT,
  patch_json_path TEXT,
  diff_path TEXT,
  snapshot_path TEXT,
  created_at TEXT NOT NULL,
  applied_at TEXT
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id TEXT PRIMARY KEY,
  patch_id TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  base_revision TEXT NOT NULL,
  review_json_path TEXT NOT NULL,
  diff_path TEXT NOT NULL,
  queued_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS history_events (
  event_id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  kind TEXT NOT NULL,
  patch_id TEXT,
  review_id TEXT,
  revision_before TEXT,
  revision_after TEXT,
  created_at TEXT NOT NULL,
  data_json TEXT
);
`;

/**
 * Open or create the vault's SQLite database.
 *
 * @param vaultRoot - Absolute path to the vault root directory.
 * @returns The opened database instance.
 */
export function openDatabase(vaultRoot: string): DatabaseType {
  const dbPath = path.join(vaultRoot, ".noumena", "index.sqlite");
  const db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma("journal_mode = WAL");
  // Enable foreign keys
  db.pragma("foreign_keys = ON");

  return db;
}

/**
 * Initialize the database schema. Creates all tables if they don't exist.
 *
 * @param db - The database instance to initialize.
 */
export function initializeSchema(db: DatabaseType): void {
  db.exec(CREATE_TABLES);
}

/**
 * Create a new vault database with the full schema.
 *
 * @param vaultRoot - Absolute path to the vault root directory.
 * @returns The initialized database instance.
 */
export function createVaultDatabase(vaultRoot: string): DatabaseType {
  const db = openDatabase(vaultRoot);
  initializeSchema(db);
  return db;
}

// ---------------------------------------------------------------------------
// Document index operations
// ---------------------------------------------------------------------------

export interface DocumentRecord {
  path: string;
  document_id: string | null;
  title: string | null;
  file_class: string;
  schema_version: string | null;
  document_type: string | null;
  revision: string;
  logical_version: number;
  indexed_at: string;
  modified_at: string | null;
}

/**
 * Upsert a document record in the index.
 */
export function upsertDocument(db: DatabaseType, doc: DocumentRecord): void {
  const stmt = db.prepare(`
    INSERT INTO documents (path, document_id, title, file_class, schema_version,
      document_type, revision, logical_version, indexed_at, modified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      document_id = excluded.document_id,
      title = excluded.title,
      file_class = excluded.file_class,
      schema_version = excluded.schema_version,
      document_type = excluded.document_type,
      revision = excluded.revision,
      logical_version = excluded.logical_version,
      indexed_at = excluded.indexed_at,
      modified_at = excluded.modified_at
  `);
  stmt.run(
    doc.path,
    doc.document_id,
    doc.title,
    doc.file_class,
    doc.schema_version,
    doc.document_type,
    doc.revision,
    doc.logical_version,
    doc.indexed_at,
    doc.modified_at,
  );
}

/**
 * Get a document record by path.
 */
export function getDocument(
  db: DatabaseType,
  docPath: string,
): DocumentRecord | undefined {
  const stmt = db.prepare("SELECT * FROM documents WHERE path = ?");
  return stmt.get(docPath) as DocumentRecord | undefined;
}

// ---------------------------------------------------------------------------
// Block operations
// ---------------------------------------------------------------------------

export interface BlockRecord {
  path: string;
  block_id: string;
  role: string;
  policy: string;
  block_hash: string;
  required: number;
  known: number;
}

/**
 * Replace all block records for a document path.
 */
export function replaceBlocks(
  db: DatabaseType,
  docPath: string,
  blocks: BlockRecord[],
): void {
  const del = db.prepare("DELETE FROM blocks WHERE path = ?");
  const ins = db.prepare(`
    INSERT INTO blocks (path, block_id, role, policy, block_hash, required, known)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  del.run(docPath);
  for (const b of blocks) {
    ins.run(b.path, b.block_id, b.role, b.policy, b.block_hash, b.required, b.known);
  }
}

/**
 * Get all blocks for a document path.
 */
export function getBlocks(db: DatabaseType, docPath: string): BlockRecord[] {
  const stmt = db.prepare("SELECT * FROM blocks WHERE path = ?");
  return stmt.all(docPath) as BlockRecord[];
}

// ---------------------------------------------------------------------------
// Patch operations
// ---------------------------------------------------------------------------

export interface PatchRecord {
  patch_id: string;
  client_patch_id: string | null;
  path: string;
  status: string;
  author_name: string | null;
  author_type: string | null;
  intent: string | null;
  base_revision: string | null;
  previous_revision: string | null;
  revision: string | null;
  patch_json_path: string | null;
  diff_path: string | null;
  snapshot_path: string | null;
  created_at: string;
  applied_at: string | null;
}

/**
 * Insert a patch record.
 */
export function insertPatch(db: DatabaseType, patch: PatchRecord): void {
  const stmt = db.prepare(`
    INSERT INTO patches (patch_id, client_patch_id, path, status, author_name,
      author_type, intent, base_revision, previous_revision, revision,
      patch_json_path, diff_path, snapshot_path, created_at, applied_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    patch.patch_id,
    patch.client_patch_id,
    patch.path,
    patch.status,
    patch.author_name,
    patch.author_type,
    patch.intent,
    patch.base_revision,
    patch.previous_revision,
    patch.revision,
    patch.patch_json_path,
    patch.diff_path,
    patch.snapshot_path,
    patch.created_at,
    patch.applied_at,
  );
}

/**
 * Get a patch by patch_id.
 */
export function getPatch(
  db: DatabaseType,
  patchId: string,
): PatchRecord | undefined {
  const stmt = db.prepare("SELECT * FROM patches WHERE patch_id = ?");
  return stmt.get(patchId) as PatchRecord | undefined;
}

/**
 * Get a patch by client_patch_id (for idempotency).
 */
export function getPatchByClientId(
  db: DatabaseType,
  clientPatchId: string,
): PatchRecord | undefined {
  const stmt = db.prepare("SELECT * FROM patches WHERE client_patch_id = ?");
  return stmt.get(clientPatchId) as PatchRecord | undefined;
}

/**
 * Get the latest applied patch for a document.
 */
export function getLatestAppliedPatch(
  db: DatabaseType,
  docPath: string,
): PatchRecord | undefined {
  const stmt = db.prepare(
    "SELECT * FROM patches WHERE path = ? AND status = 'applied' ORDER BY applied_at DESC LIMIT 1",
  );
  return stmt.get(docPath) as PatchRecord | undefined;
}

/**
 * Update patch status.
 */
export function updatePatchStatus(
  db: DatabaseType,
  patchId: string,
  status: string,
  appliedAt?: string,
  revision?: string,
): void {
  if (appliedAt && revision) {
    db.prepare(
      "UPDATE patches SET status = ?, applied_at = ?, revision = ? WHERE patch_id = ?",
    ).run(status, appliedAt, revision, patchId);
  } else {
    db.prepare("UPDATE patches SET status = ? WHERE patch_id = ?").run(
      status,
      patchId,
    );
  }
}

// ---------------------------------------------------------------------------
// Review operations
// ---------------------------------------------------------------------------

export interface ReviewRecord {
  review_id: string;
  patch_id: string;
  path: string;
  status: string;
  base_revision: string;
  review_json_path: string;
  diff_path: string;
  queued_at: string;
  resolved_at: string | null;
}

/**
 * Insert a review record.
 */
export function insertReview(db: DatabaseType, review: ReviewRecord): void {
  const stmt = db.prepare(`
    INSERT INTO reviews (review_id, patch_id, path, status, base_revision,
      review_json_path, diff_path, queued_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    review.review_id,
    review.patch_id,
    review.path,
    review.status,
    review.base_revision,
    review.review_json_path,
    review.diff_path,
    review.queued_at,
    review.resolved_at,
  );
}

/**
 * Get a review by review_id.
 */
export function getReview(
  db: DatabaseType,
  reviewId: string,
): ReviewRecord | undefined {
  const stmt = db.prepare("SELECT * FROM reviews WHERE review_id = ?");
  return stmt.get(reviewId) as ReviewRecord | undefined;
}

/**
 * Update review status.
 */
export function updateReviewStatus(
  db: DatabaseType,
  reviewId: string,
  status: string,
  resolvedAt?: string,
): void {
  if (resolvedAt) {
    db.prepare(
      "UPDATE reviews SET status = ?, resolved_at = ? WHERE review_id = ?",
    ).run(status, resolvedAt, reviewId);
  } else {
    db.prepare("UPDATE reviews SET status = ? WHERE review_id = ?").run(
      status,
      reviewId,
    );
  }
}

// ---------------------------------------------------------------------------
// History event operations
// ---------------------------------------------------------------------------

export interface HistoryEventRecord {
  event_id: string;
  path: string;
  kind: string;
  patch_id: string | null;
  review_id: string | null;
  revision_before: string | null;
  revision_after: string | null;
  created_at: string;
  data_json: string | null;
}

/**
 * Insert a history event.
 */
export function insertHistoryEvent(
  db: DatabaseType,
  event: HistoryEventRecord,
): void {
  const stmt = db.prepare(`
    INSERT INTO history_events (event_id, path, kind, patch_id, review_id,
      revision_before, revision_after, created_at, data_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    event.event_id,
    event.path,
    event.kind,
    event.patch_id,
    event.review_id,
    event.revision_before,
    event.revision_after,
    event.created_at,
    event.data_json,
  );
}

/**
 * Get history events for a document path.
 */
export function getHistoryEvents(
  db: DatabaseType,
  docPath: string,
): HistoryEventRecord[] {
  const stmt = db.prepare(
    "SELECT * FROM history_events WHERE path = ? ORDER BY created_at DESC",
  );
  return stmt.all(docPath) as HistoryEventRecord[];
}

// ---------------------------------------------------------------------------
// Snapshot operations
// ---------------------------------------------------------------------------

/**
 * Write a pre-mutation snapshot to .noumena/history/snapshots/.
 *
 * @param vaultRoot - Absolute path to the vault root.
 * @param docRelPath - Vault-relative document path (e.g. "research/local-llms.html").
 * @param patchId - The patch ID triggering this snapshot.
 * @param htmlContent - The current HTML content before mutation.
 * @returns The vault-relative path to the snapshot file.
 */
export function writeSnapshot(
  vaultRoot: string,
  docRelPath: string,
  patchId: string,
  htmlContent: string,
): string {

  const snapshotRelPath = `.noumena/history/snapshots/${docRelPath.replace(/\//g, "__")}/${patchId}.before.html`;
  const snapshotAbsPath = path.join(vaultRoot, snapshotRelPath);

  // Ensure directory exists
  fs.mkdirSync(path.dirname(snapshotAbsPath), { recursive: true });
  fs.writeFileSync(snapshotAbsPath, htmlContent, "utf-8");

  return snapshotRelPath;
}

/**
 * Write patch JSON to .noumena/history/patches/.
 *
 * @param vaultRoot - Absolute path to the vault root.
 * @param patchId - The patch ID.
 * @param patchJson - The patch JSON content.
 * @returns The vault-relative path to the patch file.
 */
export function writePatchJson(
  vaultRoot: string,
  patchId: string,
  patchJson: string,
): string {

  const patchRelPath = `.noumena/history/patches/${patchId}.json`;
  const patchAbsPath = path.join(vaultRoot, patchRelPath);

  fs.mkdirSync(path.dirname(patchAbsPath), { recursive: true });
  fs.writeFileSync(patchAbsPath, patchJson, "utf-8");

  return patchRelPath;
}

/**
 * Write a review diff to .noumena/reviews/.
 *
 * @param vaultRoot - Absolute path to the vault root.
 * @param reviewId - The review ID.
 * @param diffContent - The diff content.
 * @returns The vault-relative path to the diff file.
 */
export function writeReviewDiff(
  vaultRoot: string,
  reviewId: string,
  diffContent: string,
): string {

  const diffRelPath = `.noumena/reviews/${reviewId}.diff`;
  const diffAbsPath = path.join(vaultRoot, diffRelPath);

  fs.mkdirSync(path.dirname(diffAbsPath), { recursive: true });
  fs.writeFileSync(diffAbsPath, diffContent, "utf-8");

  return diffRelPath;
}
