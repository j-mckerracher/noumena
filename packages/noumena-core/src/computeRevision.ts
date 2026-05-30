/**
 * Compute document revision and block hashes.
 *
 * WI-5034224 — Phase 1 Implementation Plan §12:
 *   Native document revision:  sha256(canonicalSerialize(parseNoumenaHtml(fileBytes)))
 *   Raw/imported HTML revision: sha256(fileBytes)
 *   Block hash:                sha256(canonicalSerializeBlock(block))
 *
 *   noumena:revision must NOT appear in HTML — it is always computed.
 */

import { createHash } from "node:crypto";
import { parseNoumenaHtml } from "./parseNoumenaHtml.js";
import { canonicalSerialize } from "./canonicalSerialize.js";
import { canonicalSerializeBlock } from "./canonicalSerializeBlock.js";
import type { NoumenaBlock, NoumenaDocument } from "./types.js";

/**
 * Compute a sha256 hex digest of the given data.
 */
export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Compute the document revision from raw file bytes.
 *
 * For noumena_native files:
 *   sha256(canonicalSerialize(parseNoumenaHtml(fileBytes)))
 *
 * For raw_html or invalid_noumena files:
 *   sha256(fileBytes)
 */
export function computeRevision(fileBytes: Buffer | string): string {
  const parseResult = parseNoumenaHtml(fileBytes);

  if (parseResult.fileClass === "noumena_native" && parseResult.document) {
    const canonical = canonicalSerialize(parseResult.document);
    return sha256(canonical);
  }

  // Raw or invalid: hash the raw bytes
  return sha256(typeof fileBytes === "string" ? Buffer.from(fileBytes) : fileBytes);
}

/**
 * Compute the revision of an already-parsed native document.
 * Avoids re-parsing when the document model is already available.
 */
export function computeRevisionFromDocument(doc: NoumenaDocument): string {
  const canonical = canonicalSerialize(doc);
  return sha256(canonical);
}

/**
 * Compute the block hash for a single block.
 *
 * blockHash = sha256(canonicalSerializeBlock(block))
 */
export function computeBlockHash(block: NoumenaBlock): string {
  const canonical = canonicalSerializeBlock(block);
  return sha256(canonical);
}

/**
 * Compute block hashes for all blocks in a document.
 * Mutates the block objects in place, setting block.blockHash.
 * Returns a map of blockId → blockHash.
 */
export function computeAllBlockHashes(
  doc: NoumenaDocument,
): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const block of doc.blocks) {
    block.blockHash = computeBlockHash(block);
    hashes.set(block.blockId, block.blockHash);
  }
  return hashes;
}
