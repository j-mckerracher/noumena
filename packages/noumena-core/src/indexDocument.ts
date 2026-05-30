import { computeAllBlockHashes, computeRevisionFromDocument } from "./computeRevision.js";
import { replaceBlocks, upsertDocument } from "./db.js";
import type { BlockRecord, DocumentRecord, DatabaseType } from "./db.js";
import type { NoumenaDocument } from "./types.js";

const REQUIRED_ROLES = new Set(["metadata", "summary", "notes", "evidence", "agent_events"]);
const KNOWN_ROLES = REQUIRED_ROLES;

export function indexDocument(
  db: DatabaseType,
  docPath: string,
  doc: NoumenaDocument,
  logicalVersion: number,
  indexedAt: string,
): string {
  computeAllBlockHashes(doc);
  const revision = `sha256:${computeRevisionFromDocument(doc)}`;
  const record: DocumentRecord = {
    path: docPath,
    document_id: doc.documentId,
    title: doc.metadata.title ?? doc.title,
    file_class: "noumena_native",
    schema_version: doc.schemaVersion,
    document_type: doc.documentType,
    revision,
    logical_version: logicalVersion,
    indexed_at: indexedAt,
    modified_at: indexedAt,
  };
  upsertDocument(db, record);
  const blocks: BlockRecord[] = doc.blocks.map((block) => ({
    path: docPath,
    block_id: block.blockId,
    role: block.role,
    policy: block.policy,
    block_hash: `sha256:${block.blockHash}`,
    required: REQUIRED_ROLES.has(block.role) ? 1 : 0,
    known: KNOWN_ROLES.has(block.role) ? 1 : 0,
  }));
  replaceBlocks(db, docPath, blocks);
  return revision;
}
