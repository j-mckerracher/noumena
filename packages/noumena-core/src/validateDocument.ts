/**
 * Two-layer document validation for Noumena HTML v1.
 *
 * WI-5034224 — Phase 1 Implementation Plan §11, AC-002:
 *   Layer 1: Structural rules for all Noumena HTML v1 documents.
 *   Layer 2: research-note@1 specific rules (roles, policies, child elements).
 *   Errors block patching (patchable: false).
 *   Warnings do not block patching.
 */

import { parseHTML } from "linkedom";
import type { FileClass, NoumenaDocument } from "./types.js";
import { parseNoumenaHtml } from "./parseNoumenaHtml.js";

// ---------------------------------------------------------------------------
// Validation result types
// ---------------------------------------------------------------------------

/** A single validation issue (error or warning). */
export interface ValidationIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
  role?: string;
  blockId?: string;
  policy?: string;
}

/** Result of validateDocument(). */
export interface ValidationResult {
  valid: boolean;
  patchable: boolean;
  fileClass: FileClass;
  schemaVersion?: string;
  documentType?: string;
  documentId?: string;
  title?: string;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  /** The parsed document model, if parsing succeeded. */
  document?: NoumenaDocument;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOC_ID_PATTERN = /^doc_[0-9A-HJKMNP-TV-Z]{26}$/i;
// Block IDs: blk_ prefix followed by Crockford Base32 chars (lenient on length for compatibility)
const BLK_ID_PATTERN = /^blk_[0-9A-Z]{10,30}$/i;

const VALID_POLICIES = new Set([
  "append_only",
  "replace_requires_clean_base",
  "merge_text",
  "manual_review",
  "locked",
]);

const ROLE_ALLOWED_POLICIES: Record<string, Set<string>> = {
  metadata: new Set(["merge_text", "locked"]),
  summary: new Set(["replace_requires_clean_base", "manual_review", "locked"]),
  notes: new Set(["append_only", "locked"]),
  evidence: new Set(["append_only", "locked"]),
  agent_events: new Set(["append_only", "locked"]),
};

const REQUIRED_ROLES = new Set([
  "metadata", "summary", "notes", "evidence", "agent_events",
]);

const KNOWN_ROLES = new Set([
  "metadata", "summary", "notes", "evidence", "agent_events",
]);

const FORBIDDEN_ELEMENTS = new Set([
  "iframe", "object", "embed", "form", "input",
]);

const FORBIDDEN_URL_SCHEMES = ["javascript:", "vbscript:", "file:"];

const KNOWN_METADATA_FIELDS = new Set([
  "title", "status", "createdAt", "updatedAt", "tags", "aliases",
]);

const METADATA_ELEMENT_FOR_ROLE: Record<string, string> = {
  metadata: "script",
  summary: "section",
  notes: "section",
  evidence: "section",
  agent_events: "section",
};

// ---------------------------------------------------------------------------
// Minimal DOM interfaces
// ---------------------------------------------------------------------------

interface DomAttr {
  name: string;
  value: string;
}

interface DomNode {
  nodeType: number;
  textContent: string | null;
}

interface DomElement extends DomNode {
  tagName: string;
  attributes: ArrayLike<DomAttr>;
  children: ArrayLike<DomElement>;
  childNodes: ArrayLike<DomNode>;
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  getAttribute(name: string): string | null;
  id?: string;
}

interface DomDocument {
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}

// ---------------------------------------------------------------------------
// Main validation function
// ---------------------------------------------------------------------------

/**
 * Validate a Noumena HTML document.
 *
 * Returns a ValidationResult with all errors and warnings.
 * A document is patchable only when:
 *   - fileClass = "noumena_native"
 *   - schemaVersion = "noumena.html.v1"
 *   - documentType = "research-note"
 *   - errors.length = 0
 */
export function validateDocument(bytes: Buffer | string): ValidationResult {
  const html = typeof bytes === "string" ? bytes : bytes.toString("utf-8");
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Try to parse with linkedom
  let dom: DomDocument;
  try {
    const result = parseHTML(html);
    dom = result.document as unknown as DomDocument;
  } catch {
    return {
      valid: false,
      patchable: false,
      fileClass: "raw_html",
      errors: [{ severity: "error", code: "parse_error", message: "HTML could not be parsed" }],
      warnings: [],
    };
  }

  // Detect Noumena markers
  const schemaMeta = dom.querySelector('meta[name="noumena:schema"]');
  const articles = dom.querySelectorAll("article[data-noumena-document]");
  const hasNoumenaRoles = dom.querySelector("[data-noumena-role]") !== null;
  const hasMarkers = schemaMeta !== null || articles.length > 0 || hasNoumenaRoles;

  if (!hasMarkers) {
    return {
      valid: true,
      patchable: false,
      fileClass: "raw_html",
      errors: [],
      warnings: [],
    };
  }

  // Extract top-level metadata
  const schemaVersion = schemaMeta?.getAttribute("content") ?? undefined;
  const docIdMeta = dom.querySelector('meta[name="noumena:document-id"]');
  const documentId = docIdMeta?.getAttribute("content") ?? undefined;
  const docTypeMeta = dom.querySelector('meta[name="noumena:document-type"]');
  const documentType = docTypeMeta?.getAttribute("content") ?? undefined;
  const titleEl = dom.querySelector("title");
  const htmlTitle = titleEl?.textContent ?? undefined;

  // -----------------------------------------------------------------------
  // Layer 1: Structural validation
  // -----------------------------------------------------------------------

  // Doctype check
  if (!html.trimStart().toLowerCase().startsWith("<!doctype")) {
    errors.push({
      severity: "error",
      code: "missing_document_article",
      message: "Document is missing <!doctype html> declaration",
    });
  }

  // Schema meta check
  if (!schemaMeta) {
    errors.push({
      severity: "error",
      code: "missing_document_article",
      message: "Missing <meta name=\"noumena:schema\"> tag",
    });
  } else if (schemaVersion !== "noumena.html.v1") {
    errors.push({
      severity: "error",
      code: "unknown_schema_version",
      message: `Unknown schema version: ${schemaVersion ?? "none"}`,
    });
  }

  // Forbidden revision meta
  if (dom.querySelector('meta[name="noumena:revision"]')) {
    errors.push({
      severity: "error",
      code: "forbidden_revision_meta",
      message: "noumena:revision meta is forbidden; revision is always computed",
    });
  }

  // Document article check
  if (articles.length === 0) {
    errors.push({
      severity: "error",
      code: "missing_document_article",
      message: "No <article data-noumena-document> element found",
    });
    return buildResult(errors, warnings, "invalid_noumena", schemaVersion, documentType, documentId, htmlTitle);
  }

  if (articles.length > 1) {
    errors.push({
      severity: "error",
      code: "missing_document_article",
      message: `Expected exactly one <article data-noumena-document>, found ${articles.length}`,
    });
    return buildResult(errors, warnings, "invalid_noumena", schemaVersion, documentType, documentId, htmlTitle);
  }

  const article = articles[0]!;

  // Validate document IDs
  const articleDocAttr = article.getAttribute("data-noumena-document") ?? "";
  if (articleDocAttr && articleDocAttr !== "" && !DOC_ID_PATTERN.test(articleDocAttr)) {
    errors.push({
      severity: "error",
      code: "invalid_document_id",
      message: `Invalid document ID format on article: ${articleDocAttr}`,
    });
  }

  const articleDocIdAttr = article.getAttribute("data-noumena-document-id") ?? "";
  if (articleDocIdAttr && !DOC_ID_PATTERN.test(articleDocIdAttr)) {
    errors.push({
      severity: "error",
      code: "invalid_document_id",
      message: `Invalid document ID on data-noumena-document-id: ${articleDocIdAttr}`,
    });
  }

  if (documentId && !DOC_ID_PATTERN.test(documentId)) {
    errors.push({
      severity: "error",
      code: "invalid_document_id",
      message: `Invalid document ID in meta tag: ${documentId}`,
    });
  }

  // Unsupported document type
  if (documentType && documentType !== "research-note") {
    errors.push({
      severity: "error",
      code: "unsupported_document_type",
      message: `Unsupported document type: ${documentType}`,
    });
  }

  // -----------------------------------------------------------------------
  // Parse blocks and validate
  // -----------------------------------------------------------------------

  const blockIds = new Set<string>();
  const roleNames = new Set<string>();
  const htmlIds = new Set<string>();

  for (let ci = 0; ci < article.children.length; ci++) {
    const child = article.children[ci]!;
    const blockId =
      child.getAttribute("data-noumena-block-id") ??
      child.getAttribute("data-block-id");
    const role = child.getAttribute("data-noumena-role") ?? "";
    const policyStr = child.getAttribute("data-conflict-policy") ?? "";
    const tagName = child.tagName.toLowerCase();

    // Skip non-block children
    if (!blockId && !role) continue;

    // Block ID validation
    if (!blockId) {
      errors.push({
        severity: "error",
        code: "block_missing_id",
        message: `Block with role "${role}" is missing a block ID attribute`,
        role,
      });
    } else if (!BLK_ID_PATTERN.test(blockId)) {
      errors.push({
        severity: "error",
        code: "invalid_block_id",
        message: `Invalid block ID format: ${blockId}`,
        blockId,
        role,
      });
    } else if (blockIds.has(blockId)) {
      errors.push({
        severity: "error",
        code: "duplicate_block_id",
        message: `Duplicate block ID: ${blockId}`,
        blockId,
        role,
      });
    }
    if (blockId) blockIds.add(blockId);

    // Role validation
    if (!role) {
      errors.push({
        severity: "error",
        code: "block_missing_role",
        message: `Block ${blockId ?? "unknown"} is missing data-noumena-role`,
        blockId: blockId ?? undefined,
      });
    } else if (roleNames.has(role)) {
      errors.push({
        severity: "error",
        code: "duplicate_role",
        message: `Duplicate role: ${role}`,
        role,
        blockId: blockId ?? undefined,
      });
    } else {
      roleNames.add(role);

      // Unknown role warning
      if (!KNOWN_ROLES.has(role)) {
        warnings.push({
          severity: "warning",
          code: "unknown_role",
          message: `Unknown role: ${role}`,
          role,
          blockId: blockId ?? undefined,
        });
      }
    }

    // Conflict policy validation
    if (!policyStr) {
      errors.push({
        severity: "error",
        code: "block_missing_conflict_policy",
        message: `Block ${blockId ?? role} is missing data-conflict-policy`,
        role,
        blockId: blockId ?? undefined,
      });
    } else if (!VALID_POLICIES.has(policyStr)) {
      errors.push({
        severity: "error",
        code: "unknown_conflict_policy",
        message: `Unknown conflict policy: ${policyStr}`,
        role,
        blockId: blockId ?? undefined,
        policy: policyStr,
      });
    } else if (role && KNOWN_ROLES.has(role) && !ROLE_ALLOWED_POLICIES[role]!.has(policyStr)) {
      errors.push({
        severity: "error",
        code: "policy_not_allowed_for_role",
        message: `Policy "${policyStr}" is not allowed for role "${role}"`,
        role,
        blockId: blockId ?? undefined,
        policy: policyStr,
      });
    }

    // Wrong element type for role
    if (role && KNOWN_ROLES.has(role) && METADATA_ELEMENT_FOR_ROLE[role] !== tagName) {
      errors.push({
        severity: "error",
        code: "wrong_element_for_role",
        message: `Role "${role}" requires <${METADATA_ELEMENT_FOR_ROLE[role]}> but found <${tagName}>`,
        role,
        blockId: blockId ?? undefined,
      });
    }

    // Evidence and agent_events must have <ol> child
    if (role === "evidence") {
      if (!hasDirectOlChild(child)) {
        errors.push({
          severity: "error",
          code: "evidence_missing_ol",
          message: "Evidence block must contain a direct <ol> child",
          role: "evidence",
          blockId: blockId ?? undefined,
        });
      } else {
        // Check evidence items for missing IDs
        const olEl = findDirectChild(child, "ol");
        if (olEl) {
          checkListItemIds(olEl, "evidence_item_missing_id", warnings);
        }
      }
    }

    if (role === "agent_events") {
      if (!hasDirectOlChild(child)) {
        errors.push({
          severity: "error",
          code: "agent_events_missing_ol",
          message: "Agent events block must contain a direct <ol> child",
          role: "agent_events",
          blockId: blockId ?? undefined,
        });
      } else {
        // Check agent event items for missing timestamps
        const olEl = findDirectChild(child, "ol");
        if (olEl) {
          checkEventTimestamps(olEl, warnings);
        }
      }
    }

    // Notes items missing ID check
    if (role === "notes") {
      checkNoteItemIds(child, warnings);
    }

    // Metadata block validation
    if (role === "metadata") {
      const scriptEl = tagName === "script" ? child : findDirectChild(child, "script");
      if (scriptEl) {
        const jsonText = (scriptEl.textContent ?? "").trim();
        if (jsonText) {
          try {
            const parsed = JSON.parse(jsonText);
            // Check required fields
            if (!parsed.title || !parsed.status || !parsed.createdAt) {
              if (!parsed.title && !parsed.status && !parsed.createdAt) {
                // Accept legacy formats with created_at
                if (!parsed.created_at) {
                  errors.push({
                    severity: "error",
                    code: "metadata_invalid_json",
                    message: "Metadata JSON is missing required fields: title, status, createdAt",
                    role: "metadata",
                    blockId: blockId ?? undefined,
                  });
                }
              }
            }
            // Check for unknown metadata fields
            if (typeof parsed === "object" && parsed !== null) {
              for (const key of Object.keys(parsed)) {
                if (!KNOWN_METADATA_FIELDS.has(key) && key !== "created_at" && key !== "updated_at") {
                  warnings.push({
                    severity: "warning",
                    code: "metadata_unknown_field",
                    message: `Unknown metadata field: ${key}`,
                    role: "metadata",
                    blockId: blockId ?? undefined,
                  });
                }
              }
            }

            // Check title mismatch
            if (parsed.title && htmlTitle && parsed.title !== htmlTitle) {
              warnings.push({
                severity: "warning",
                code: "title_metadata_mismatch",
                message: `HTML <title> "${htmlTitle}" does not match metadata.title "${parsed.title}"`,
                role: "metadata",
                blockId: blockId ?? undefined,
              });
            }
          } catch {
            errors.push({
              severity: "error",
              code: "metadata_invalid_json",
              message: "Metadata JSON could not be parsed",
              role: "metadata",
              blockId: blockId ?? undefined,
            });
          }
        } else {
          errors.push({
            severity: "error",
            code: "missing_metadata_block",
            message: "Metadata script block is empty",
            role: "metadata",
            blockId: blockId ?? undefined,
          });
        }
      }
    }

    // Track HTML IDs for duplicate check
    const htmlId = child.getAttribute("id");
    if (htmlId) {
      if (htmlIds.has(htmlId)) {
        warnings.push({
          severity: "warning",
          code: "duplicate_html_id",
          message: `Duplicate HTML id attribute: ${htmlId}`,
        });
      }
      htmlIds.add(htmlId);
    }
  }

  // Missing required roles
  for (const required of REQUIRED_ROLES) {
    if (!roleNames.has(required)) {
      errors.push({
        severity: "error",
        code: "missing_required_role",
        message: `Missing required role: ${required}`,
        role: required,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Layer 2: Forbidden content (security)
  // -----------------------------------------------------------------------

  // Forbidden elements
  const allElements = article.querySelectorAll("*");
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i]!;
    const tag = el.tagName.toLowerCase();

    if (FORBIDDEN_ELEMENTS.has(tag)) {
      errors.push({
        severity: "error",
        code: "forbidden_element",
        message: `Forbidden element: <${tag}>`,
      });
    }

    // Executable scripts (not metadata script)
    if (tag === "script") {
      const type = (el.getAttribute("type") ?? "").toLowerCase().trim();
      if (
        type === "" ||
        type === "text/javascript" ||
        type === "application/javascript" ||
        type === "module"
      ) {
        errors.push({
          severity: "error",
          code: "forbidden_element",
          message: "Forbidden executable <script> element",
        });
      }
    }

    // Event handler attributes
    for (let a = 0; a < el.attributes.length; a++) {
      const attr = el.attributes[a]!;
      if (attr.name.toLowerCase().startsWith("on")) {
        errors.push({
          severity: "error",
          code: "forbidden_event_handler",
          message: `Forbidden event handler attribute: ${attr.name}`,
        });
      }
    }

    // srcdoc attribute
    if (el.getAttribute("srcdoc") !== null) {
      errors.push({
        severity: "error",
        code: "forbidden_srcdoc",
        message: "Forbidden srcdoc attribute",
      });
    }

    // Forbidden URL schemes
    for (const attrName of ["href", "src"]) {
      const val = el.getAttribute(attrName);
      if (val) {
        const trimmed = val.trim().toLowerCase();
        for (const scheme of FORBIDDEN_URL_SCHEMES) {
          if (trimmed.startsWith(scheme)) {
            errors.push({
              severity: "error",
              code: "forbidden_url_scheme",
              message: `Forbidden URL scheme in ${attrName}: ${scheme}`,
            });
          }
        }
      }
    }

    // meta http-equiv="refresh"
    if (tag === "meta" && (el.getAttribute("http-equiv") ?? "").toLowerCase() === "refresh") {
      errors.push({
        severity: "error",
        code: "forbidden_element",
        message: 'Forbidden <meta http-equiv="refresh">',
      });
    }
  }

  // -----------------------------------------------------------------------
  // Build result
  // -----------------------------------------------------------------------

  // Attempt to parse document model for successful results
  let document: NoumenaDocument | undefined;
  if (errors.length === 0) {
    const parseResult = parseNoumenaHtml(bytes);
    if (parseResult.fileClass === "noumena_native" && parseResult.document) {
      document = parseResult.document;
    }
  }

  const fileClass: FileClass = errors.length === 0 ? "noumena_native" : "invalid_noumena";
  const patchable =
    fileClass === "noumena_native" &&
    schemaVersion === "noumena.html.v1" &&
    documentType === "research-note" &&
    errors.length === 0;

  return {
    valid: errors.length === 0,
    patchable,
    fileClass,
    schemaVersion,
    documentType,
    documentId,
    title: htmlTitle,
    errors,
    warnings,
    document,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResult(
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
  fileClass: FileClass,
  schemaVersion?: string,
  documentType?: string,
  documentId?: string,
  title?: string,
): ValidationResult {
  return {
    valid: errors.length === 0,
    patchable: false,
    fileClass,
    schemaVersion,
    documentType,
    documentId,
    title,
    errors,
    warnings,
  };
}

function hasDirectOlChild(el: DomElement): boolean {
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i]!.tagName.toLowerCase() === "ol") return true;
  }
  return false;
}

function findDirectChild(el: DomElement, tagName: string): DomElement | null {
  for (let i = 0; i < el.children.length; i++) {
    if (el.children[i]!.tagName.toLowerCase() === tagName) return el.children[i]!;
  }
  return null;
}

function checkListItemIds(ol: DomElement, code: string, warnings: ValidationIssue[]): void {
  for (let i = 0; i < ol.children.length; i++) {
    const li = ol.children[i]!;
    if (li.tagName.toLowerCase() === "li" && !li.getAttribute("id")) {
      warnings.push({
        severity: "warning",
        code,
        message: `List item at index ${i} is missing an id attribute`,
      });
    }
  }
}

function checkEventTimestamps(ol: DomElement, warnings: ValidationIssue[]): void {
  for (let i = 0; i < ol.children.length; i++) {
    const li = ol.children[i]!;
    if (li.tagName.toLowerCase() === "li") {
      const hasTime = li.querySelector("time") !== null;
      const hasDatetime = li.getAttribute("data-timestamp") !== null;
      if (!hasTime && !hasDatetime) {
        warnings.push({
          severity: "warning",
          code: "agent_event_missing_timestamp",
          message: `Agent event item at index ${i} is missing a timestamp`,
        });
      }
    }
  }
}

function checkNoteItemIds(section: DomElement, warnings: ValidationIssue[]): void {
  // Check for list items or direct children that could be note items
  const items = section.querySelectorAll("li");
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!item.getAttribute("id")) {
      warnings.push({
        severity: "warning",
        code: "note_item_missing_id",
        message: `Note item at index ${i} is missing an id attribute`,
      });
    }
  }
}
