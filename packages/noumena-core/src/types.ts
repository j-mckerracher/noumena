/**
 * Core data model for Noumena documents.
 *
 * WI-5034224 — Phase 1 Implementation Plan §8:
 *   Defines the internal document model used by parseNoumenaHtml,
 *   canonicalSerialize, computeRevision, and all downstream operations.
 */

// ---------------------------------------------------------------------------
// ID type aliases
// ---------------------------------------------------------------------------

export type DocumentId = string; // doc_[0-9A-HJKMNP-TV-Z]{26}
export type BlockId = string; // blk_[0-9A-HJKMNP-TV-Z]{26}

// ---------------------------------------------------------------------------
// Roles and conflict policies
// ---------------------------------------------------------------------------

/** The five required roles for research-note@1. */
export type NoumenaRole =
  | "metadata"
  | "summary"
  | "notes"
  | "evidence"
  | "agent_events";

/** Known conflict policies per PDF §9 / §17. */
export type ConflictPolicy =
  | "append_only"
  | "replace_requires_clean_base"
  | "merge_text"
  | "manual_review"
  | "locked";

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/** Metadata JSON schema per PDF §8 / §9. */
export interface NoumenaMetadataV1 {
  title: string;
  status: "draft" | "active" | "reviewed" | "archived";
  createdAt: string;
  updatedAt?: string;
  tags?: string[];
  aliases?: string[];
  [key: string]: unknown; // allow unknown fields (warning, not error)
}

// ---------------------------------------------------------------------------
// Block model
// ---------------------------------------------------------------------------

/** A parsed Noumena block (section, script, etc.). */
export interface NoumenaBlock {
  blockId: BlockId;
  role: string; // string to allow unknown roles (warning)
  policy: ConflictPolicy;
  /** The raw HTML element content as a string (inner serialization target). */
  element: BlockElement;
  /** Computed block hash (set after parsing). */
  blockHash: string;
}

/**
 * Represents a parsed block's structural data for serialization.
 * For metadata blocks this is the script element; for sections it's the section.
 */
export interface BlockElement {
  /** Tag name (lowercase). */
  tagName: string;
  /** Attributes as key-value pairs. */
  attributes: Record<string, string>;
  /** Child elements / text content (structured for serialization). */
  children: BlockChild[];
}

/** A child node within a block element. */
export type BlockChild =
  | { type: "element"; element: SerializableElement }
  | { type: "text"; text: string }
  | { type: "rawJson"; json: string }; // metadata JSON content

/** A generic serializable HTML element. */
export interface SerializableElement {
  tagName: string;
  attributes: Record<string, string>;
  children: BlockChild[];
  /** Whether this element should be rendered inline (no newline). */
  inline?: boolean;
  /** Whether this is a void/self-closing element. */
  void?: boolean;
}

// ---------------------------------------------------------------------------
// Article wrapper
// ---------------------------------------------------------------------------

/** The <article data-noumena-document> wrapper. */
export interface NoumenaArticle {
  /** Attributes on the article element. */
  attributes: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Document model
// ---------------------------------------------------------------------------

/** File classification result from parseNoumenaHtml. */
export type FileClass = "noumena_native" | "raw_html" | "invalid_noumena";

/** The complete parsed Noumena document. */
export interface NoumenaDocument {
  schemaVersion: "noumena.html.v1";
  documentType: "research-note";
  documentId: DocumentId;
  title: string;
  metadata: NoumenaMetadataV1;
  article: NoumenaArticle;
  /** Blocks keyed by role (for known roles). */
  roles: Map<string, NoumenaBlock>;
  /** All blocks in document order. */
  blocks: NoumenaBlock[];
}

/** Result of parsing an HTML file. */
export interface ParseResult {
  fileClass: FileClass;
  document: NoumenaDocument | null;
  /** Schema version if detected. */
  schemaVersion?: string;
  /** Document type if detected. */
  documentType?: string;
  /** Document ID if detected. */
  documentId?: string;
  /** Title if detected. */
  title?: string;
}
