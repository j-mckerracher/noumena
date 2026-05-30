/**
 * Create a new Noumena document in a vault.
 *
 * WI-5034224 — Phase 1 Implementation Plan §7.2, AC-006:
 *   Creates a research-note@1 HTML document from the canonical template,
 *   validates the result, updates SQLite index, returns creation metadata.
 *
 *   Rejects if:
 *   - File already exists (exit 4, document_already_exists)
 *   - Path escapes vault
 *   - --type is not research-note
 */

import type { NoumenaDocument, NoumenaBlock, NoumenaMetadataV1, ConflictPolicy } from "./types.js";
import { generateId } from "./ids.js";
import { canonicalSerialize } from "./canonicalSerialize.js";
import { computeRevisionFromDocument, computeAllBlockHashes } from "./computeRevision.js";
import { validateDocument } from "./validateDocument.js";
import { validateVaultRelativePath } from "./pathSafety.js";
import { openInitializedVault } from "./vault.js";
import { runWriteTransaction } from "./writeTransaction.js";
import { indexDocument } from "./indexDocument.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface DocCreateSuccess {
  ok: true;
  documentId: string;
  revision: string;
  logicalVersion: number;
  title: string;
  fileClass: "noumena_native";
  patchable: true;
  schemaVersion: "noumena.html.v1";
  documentType: "research-note";
  templateUsed: "research-note@1";
  indexUpdated: true;
  document: string; // vault-relative path
  next: {
    infoCommand: string;
  };
}

export interface DocCreateError {
  ok: false;
  code: string;
  message: string;
  path?: string;
}

export type DocCreateResult = DocCreateSuccess | DocCreateError;

// ---------------------------------------------------------------------------
// Template builder
// ---------------------------------------------------------------------------

/**
 * Build a research-note@1 document model for canonical serialization.
 * Uses the canonical serializer (not a hand-edited string).
 */
function buildResearchNoteTemplate(
  documentId: string,
  title: string,
  now: string,
): NoumenaDocument {
  const metadata: NoumenaMetadataV1 = {
    title,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    tags: [],
  };

  const blocks: NoumenaBlock[] = [
    {
      blockId: generateId("blk"),
      role: "metadata",
      policy: "merge_text" as ConflictPolicy,
      element: {
        tagName: "script",
        attributes: {
          "data-noumena-block-id": "", // placeholder, set below
          "data-noumena-role": "metadata",
          "data-conflict-policy": "merge_text",
          "type": "application/vnd.noumena.metadata+json",
        },
        children: [
          { type: "rawJson", json: JSON.stringify(metadata) },
        ],
      },
      blockHash: "",
    },
    {
      blockId: generateId("blk"),
      role: "summary",
      policy: "replace_requires_clean_base" as ConflictPolicy,
      element: {
        tagName: "section",
        attributes: {
          "id": "summary",
          "data-noumena-block-id": "", // placeholder
          "data-noumena-role": "summary",
          "data-conflict-policy": "replace_requires_clean_base",
        },
        children: [
          {
            type: "element",
            element: {
              tagName: "h2",
              attributes: {},
              children: [{ type: "text", text: "Summary" }],
              inline: false,
            },
          },
          {
            type: "element",
            element: {
              tagName: "p",
              attributes: {},
              children: [],
              inline: false,
            },
          },
        ],
      },
      blockHash: "",
    },
    {
      blockId: generateId("blk"),
      role: "notes",
      policy: "append_only" as ConflictPolicy,
      element: {
        tagName: "section",
        attributes: {
          "id": "notes",
          "data-noumena-block-id": "", // placeholder
          "data-noumena-role": "notes",
          "data-conflict-policy": "append_only",
        },
        children: [
          {
            type: "element",
            element: {
              tagName: "h2",
              attributes: {},
              children: [{ type: "text", text: "Notes" }],
              inline: false,
            },
          },
          {
            type: "element",
            element: {
              tagName: "p",
              attributes: {},
              children: [],
              inline: false,
            },
          },
        ],
      },
      blockHash: "",
    },
    {
      blockId: generateId("blk"),
      role: "evidence",
      policy: "append_only" as ConflictPolicy,
      element: {
        tagName: "section",
        attributes: {
          "id": "evidence",
          "data-noumena-block-id": "", // placeholder
          "data-noumena-role": "evidence",
          "data-conflict-policy": "append_only",
        },
        children: [
          {
            type: "element",
            element: {
              tagName: "h2",
              attributes: {},
              children: [{ type: "text", text: "Evidence" }],
              inline: false,
            },
          },
          {
            type: "element",
            element: {
              tagName: "ol",
              attributes: {},
              children: [],
              inline: false,
            },
          },
        ],
      },
      blockHash: "",
    },
    {
      blockId: generateId("blk"),
      role: "agent_events",
      policy: "append_only" as ConflictPolicy,
      element: {
        tagName: "section",
        attributes: {
          "id": "agent-events",
          "data-noumena-block-id": "", // placeholder
          "data-noumena-role": "agent_events",
          "data-conflict-policy": "append_only",
        },
        children: [
          {
            type: "element",
            element: {
              tagName: "h2",
              attributes: {},
              children: [{ type: "text", text: "Agent Events" }],
              inline: false,
            },
          },
          {
            type: "element",
            element: {
              tagName: "ol",
              attributes: {},
              children: [],
              inline: false,
            },
          },
        ],
      },
      blockHash: "",
    },
  ];

  // Set block IDs in attributes
  for (const block of blocks) {
    block.element.attributes["data-noumena-block-id"] = block.blockId;
  }

  // Build roles map
  const roles = new Map<string, NoumenaBlock>();
  for (const block of blocks) {
    roles.set(block.role, block);
  }

  return {
    schemaVersion: "noumena.html.v1",
    documentType: "research-note",
    documentId,
    title,
    metadata,
    article: {
      attributes: {
        "data-noumena-document": "",
        "data-noumena-document-id": documentId,
        "data-noumena-document-type": "research-note",
        "data-noumena-schema-version": "noumena.html.v1",
      },
    },
    roles,
    blocks,
  };
}

// ---------------------------------------------------------------------------
// Main create function
// ---------------------------------------------------------------------------

/**
 * Create a new Noumena document in a vault.
 *
 * @param vaultPath - Path to the vault root.
 * @param docRelPath - Vault-relative document path (e.g. "research/local-llms.html").
 * @param docType - Document type (must be "research-note").
 * @param title - Document title.
 */
export function createDocument(
  vaultPath: string,
  docRelPath: string,
  docType: string,
  title: string,
): DocCreateResult {
  // Type must be research-note
  if (docType !== "research-note") {
    return {
      ok: false,
      code: "unsupported_document_type",
      message: `Unsupported document type: ${docType}. Only "research-note" is supported in Phase 1.`,
    };
  }

  // Open vault
  const vaultResult = openInitializedVault(vaultPath);
  if (!vaultResult.ok) {
    return {
      ok: false,
      code: vaultResult.code,
      message: vaultResult.message,
    };
  }

  const { vault } = vaultResult;
  vault.db.close();

  const pathResult = validateVaultRelativePath(vault.root, docRelPath);
  if (!pathResult.valid) {
    return {
      ok: false,
      code: pathResult.code,
      message: pathResult.message,
    };
  }

  const documentId = generateId("doc");
  const now = new Date().toISOString();
  const doc = buildResearchNoteTemplate(documentId, title, now);
  computeAllBlockHashes(doc);
  const htmlContent = canonicalSerialize(doc);
  const validation = validateDocument(htmlContent);
  if (!validation.patchable) {
    return {
      ok: false,
      code: "internal_validation_failed",
      message: `Generated document failed validation: ${validation.errors.map((e) => e.code).join(", ")}`,
    };
  }

  const tx = runWriteTransaction({
    vaultRoot: vault.root,
    docPath: docRelPath,
    command: "doc.create",
    execute: (ctx) => {
      if (ctx.fileBytes !== null) {
        return {
          type: "rejected",
          result: {
            ok: false,
            code: "document_already_exists",
            message: "A file already exists at the requested document path.",
            path: docRelPath,
          },
        };
      }

      const revision = `sha256:${computeRevisionFromDocument(doc)}`;
      return {
        type: "applied",
        newContent: htmlContent,
        updateIndex: (db) => {
          indexDocument(db, docRelPath, doc, 1, now);
        },
        result: {
          ok: true,
          documentId,
          revision,
          logicalVersion: 1,
          title,
          fileClass: "noumena_native",
          patchable: true,
          schemaVersion: "noumena.html.v1",
          documentType: "research-note",
          templateUsed: "research-note@1",
          indexUpdated: true,
          document: docRelPath,
          next: {
            infoCommand: `noumena doc info ${vaultPath} ${docRelPath} --json`,
          },
        },
      };
    },
  });

  return tx.result as unknown as DocCreateResult;
}

const REQUIRED_ROLES_SET = new Set(["metadata", "summary", "notes", "evidence", "agent_events"]);
const KNOWN_ROLES_SET = new Set(["metadata", "summary", "notes", "evidence", "agent_events"]);
