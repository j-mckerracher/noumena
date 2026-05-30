/**
 * Parse Noumena HTML bytes into the NoumenaDocument internal model.
 *
 * WI-5034224 — Phase 1 Implementation Plan §8, §9, §11:
 *   Classifies files as noumena_native / raw_html / invalid_noumena.
 *   Extracts the document model for downstream canonical serialization,
 *   revision computation, and validation.
 */

import { parseHTML } from "linkedom";
import type {
  NoumenaDocument,
  NoumenaBlock,
  NoumenaArticle,
  NoumenaMetadataV1,
  ParseResult,
  BlockElement,
  BlockChild,
  SerializableElement,
  ConflictPolicy,
} from "./types.js";

// ---------------------------------------------------------------------------
// Void elements (self-closing in HTML)
// ---------------------------------------------------------------------------

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// ---------------------------------------------------------------------------
// Inline elements for serialization purposes
// ---------------------------------------------------------------------------

const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data",
  "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u",
  "var", "wbr",
]);

// ---------------------------------------------------------------------------
// Required roles for research-note@1
// ---------------------------------------------------------------------------

const REQUIRED_ROLES: readonly string[] = [
  "metadata", "summary", "notes", "evidence", "agent_events",
];

// ---------------------------------------------------------------------------
// Valid conflict policies
// ---------------------------------------------------------------------------

const VALID_POLICIES = new Set<string>([
  "append_only",
  "replace_requires_clean_base",
  "merge_text",
  "manual_review",
  "locked",
]);

// ---------------------------------------------------------------------------
// Role → allowed conflict policies mapping
// ---------------------------------------------------------------------------

const ROLE_ALLOWED_POLICIES: Record<string, Set<string>> = {
  metadata: new Set(["merge_text", "locked"]),
  summary: new Set(["replace_requires_clean_base", "manual_review", "locked"]),
  notes: new Set(["append_only", "locked"]),
  evidence: new Set(["append_only", "locked"]),
  agent_events: new Set(["append_only", "locked"]),
};

// ---------------------------------------------------------------------------
// Document ID pattern: doc_ + 26 Crockford Base32 chars
// ---------------------------------------------------------------------------

const DOC_ID_PATTERN = /^doc_[0-9A-HJKMNP-TV-Z]{26}$/i;

// ---------------------------------------------------------------------------
// Minimal DOM interfaces (avoids needing global DOM types)
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
}

interface DomDocument {
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Parse HTML bytes into a NoumenaDocument model.
 *
 * Classification rules:
 *   - noumena_native: has Noumena schema meta, valid article structure, passes
 *     all structural validation (required roles, no duplicates, valid metadata
 *     JSON, no forbidden elements, valid conflict policies, etc.)
 *   - raw_html: valid HTML but has no Noumena markers at all
 *   - invalid_noumena: has Noumena markers but fails structural requirements
 */
export function parseNoumenaHtml(bytes: Buffer | string): ParseResult {
  const html = typeof bytes === "string" ? bytes : bytes.toString("utf-8");

  // Try to parse with linkedom
  let doc: DomDocument;
  try {
    const result = parseHTML(html);
    doc = result.document as unknown as DomDocument;
  } catch {
    return { fileClass: "raw_html", document: null };
  }

  // -----------------------------------------------------------------------
  // Detect Noumena markers — any of: schema meta, article, role attributes
  // -----------------------------------------------------------------------

  const schemaMeta = doc.querySelector('meta[name="noumena:schema"]');
  const articles = doc.querySelectorAll("article[data-noumena-document]");
  const hasNoumenaRoles = doc.querySelector("[data-noumena-role]") !== null;

  const hasMarkers =
    schemaMeta !== null || articles.length > 0 || hasNoumenaRoles;

  if (!hasMarkers) {
    return { fileClass: "raw_html", document: null };
  }

  // -----------------------------------------------------------------------
  // Extract top-level metadata for result envelope
  // -----------------------------------------------------------------------

  const schemaVersion = schemaMeta?.getAttribute("content") ?? undefined;
  const docIdMeta = doc.querySelector('meta[name="noumena:document-id"]');
  const documentId = docIdMeta?.getAttribute("content") ?? undefined;
  const docTypeMeta = doc.querySelector('meta[name="noumena:document-type"]');
  const documentType = docTypeMeta?.getAttribute("content") ?? undefined;
  const titleEl = doc.querySelector("title");
  const title = titleEl?.textContent ?? undefined;

  /** Shorthand: return invalid_noumena with envelope metadata. */
  const invalid = (): ParseResult => ({
    fileClass: "invalid_noumena",
    document: null,
    schemaVersion,
    documentType,
    documentId,
    title,
  });

  // -----------------------------------------------------------------------
  // Structural validation
  // -----------------------------------------------------------------------

  // V1: Schema meta must exist
  if (!schemaMeta) return invalid();

  // V2: Schema version must be recognized
  if (schemaVersion !== "noumena.html.v1") return invalid();

  // V3: Doctype declaration required
  if (!html.trimStart().toLowerCase().startsWith("<!doctype")) return invalid();

  // V4: No forbidden noumena:revision meta
  if (doc.querySelector('meta[name="noumena:revision"]')) return invalid();

  // V5: Exactly one article[data-noumena-document]
  if (articles.length !== 1) return invalid();

  const article = articles[0]!;

  // V6: Validate document IDs if present (non-boolean attribute values)
  const articleDocAttr = article.getAttribute("data-noumena-document") ?? "";
  if (articleDocAttr && !DOC_ID_PATTERN.test(articleDocAttr)) return invalid();

  const articleDocIdAttr =
    article.getAttribute("data-noumena-document-id") ?? "";
  if (articleDocIdAttr && !DOC_ID_PATTERN.test(articleDocIdAttr))
    return invalid();

  if (documentId && !DOC_ID_PATTERN.test(documentId)) return invalid();

  // -----------------------------------------------------------------------
  // Parse blocks — support both data-noumena-block-id and data-block-id
  // -----------------------------------------------------------------------

  const articleAttrs = extractAttributes(article);
  const noumenaArticle: NoumenaArticle = { attributes: articleAttrs };

  const blocks: NoumenaBlock[] = [];
  const roles = new Map<string, NoumenaBlock>();
  const blockIds = new Set<string>();
  const roleNames = new Set<string>();

  for (let ci = 0; ci < article.children.length; ci++) {
    const child = article.children[ci]!;
    const blockId =
      child.getAttribute("data-noumena-block-id") ??
      child.getAttribute("data-block-id");
    if (!blockId) continue;

    // V7: No duplicate block IDs
    if (blockIds.has(blockId)) return invalid();
    blockIds.add(blockId);

    const role = child.getAttribute("data-noumena-role") ?? "";
    const policyStr = child.getAttribute("data-conflict-policy") ?? "";

    // V8: No duplicate roles (non-empty roles only)
    if (role && roleNames.has(role)) return invalid();
    if (role) roleNames.add(role);

    // V9: Conflict policy must be a known value (if present)
    if (policyStr && !VALID_POLICIES.has(policyStr)) return invalid();

    // V10: Required roles must use their designated policy (if policy present)
    if (role && policyStr && role in ROLE_ALLOWED_POLICIES) {
      if (!ROLE_ALLOWED_POLICIES[role]!.has(policyStr)) return invalid();
    }

    const policy = (policyStr || "") as ConflictPolicy;
    const element = parseElement(child);
    const block: NoumenaBlock = {
      blockId,
      role,
      policy,
      element,
      blockHash: "",
    };

    blocks.push(block);
    if (role) {
      roles.set(role, block);
    }
  }

  // V11: All required roles must be present
  for (const required of REQUIRED_ROLES) {
    if (!roles.has(required)) return invalid();
  }

  // V12: Evidence and agent_events blocks must contain an <ol>
  for (const listRole of ["evidence", "agent_events"]) {
    const block = roles.get(listRole);
    if (block && !hasOlChild(block.element)) return invalid();
  }

  // V13: Validate metadata JSON (must parse without error)
  let metadata: NoumenaMetadataV1 = {
    title: title ?? "",
    status: "draft",
    createdAt: new Date().toISOString(),
  };

  const metadataBlock = roles.get("metadata");
  if (metadataBlock) {
    const jsonStr = findRawJson(metadataBlock.element.children);
    if (jsonStr !== null) {
      try {
        metadata = JSON.parse(jsonStr) as NoumenaMetadataV1;
      } catch {
        return invalid();
      }
    }
  }

  // V14: No forbidden elements or javascript: URLs within article
  if (containsForbiddenContent(article)) return invalid();

  // -----------------------------------------------------------------------
  // All validations passed — build NoumenaDocument
  // -----------------------------------------------------------------------

  const resolvedDocId = articleDocIdAttr || documentId || articleDocAttr || "";

  const noumenaDoc: NoumenaDocument = {
    schemaVersion: "noumena.html.v1",
    documentType: "research-note",
    documentId: resolvedDocId,
    title: metadata.title ?? title ?? "",
    metadata,
    article: noumenaArticle,
    roles,
    blocks,
  };

  return {
    fileClass: "noumena_native",
    document: noumenaDoc,
    schemaVersion,
    documentType,
    documentId,
    title,
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Check if a block element contains an <ol> child (direct element children). */
function hasOlChild(element: BlockElement): boolean {
  for (const child of element.children) {
    if (child.type === "element" && child.element.tagName === "ol") return true;
  }
  return false;
}

/** Recursively search for rawJson content in block children. */
function findRawJson(children: BlockChild[]): string | null {
  for (const child of children) {
    if (child.type === "rawJson") return child.json;
    if (child.type === "element") {
      const found = findRawJson(child.element.children);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Check for forbidden elements (iframe, executable scripts) and javascript: URLs. */
function containsForbiddenContent(article: DomElement): boolean {
  // Forbidden: <iframe>
  if (article.querySelectorAll("iframe").length > 0) return true;

  // Forbidden: executable <script> (scripts without a non-JS data type)
  const scripts = article.querySelectorAll("script");
  for (let i = 0; i < scripts.length; i++) {
    const script = scripts[i]!;
    const type = (script.getAttribute("type") ?? "").toLowerCase().trim();
    if (
      type === "" ||
      type === "text/javascript" ||
      type === "application/javascript" ||
      type === "module"
    ) {
      return true;
    }
  }

  // Forbidden: javascript: URLs in href or src attributes
  const allElements = article.querySelectorAll("*");
  for (let i = 0; i < allElements.length; i++) {
    const el = allElements[i]!;
    for (const attrName of ["href", "src"]) {
      const val = el.getAttribute(attrName);
      if (val && val.trim().toLowerCase().startsWith("javascript:"))
        return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Element parsing helpers
// ---------------------------------------------------------------------------

/** Extract all attributes from a DOM element as a lowercase key-value record. */
function extractAttributes(el: DomElement): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    attrs[attr.name.toLowerCase()] = attr.value;
  }
  return attrs;
}

/**
 * Parse a DOM Element into a BlockElement structure for serialization.
 */
function parseElement(el: DomElement): BlockElement {
  const tagName = el.tagName.toLowerCase();
  const attributes = extractAttributes(el);
  const children = parseChildren(el);
  return { tagName, attributes, children };
}

/**
 * Parse child nodes of an element into BlockChild array.
 * For metadata script blocks, extract the raw JSON text.
 */
function parseChildren(el: DomElement): BlockChild[] {
  const tagName = el.tagName.toLowerCase();
  const children: BlockChild[] = [];

  // Special case: metadata script block — extract raw JSON
  if (tagName === "script") {
    const type = (el.getAttribute("type") ?? "").toLowerCase().trim();
    if (
      type === "application/vnd.noumena.metadata+json" ||
      type === "application/json"
    ) {
      const jsonText = el.textContent ?? "";
      children.push({ type: "rawJson", json: jsonText.trim() });
      return children;
    }
  }

  for (let i = 0; i < el.childNodes.length; i++) {
    const node = el.childNodes[i]!;
    if (node.nodeType === 3) {
      // Text node
      const text = node.textContent ?? "";
      if (text.trim() || text.includes("\n")) {
        children.push({ type: "text", text });
      }
    } else if (node.nodeType === 1) {
      // Element node
      const childEl = node as unknown as DomElement;
      const childTagName = childEl.tagName.toLowerCase();
      const attrs = extractAttributes(childEl);

      const isInline = INLINE_ELEMENTS.has(childTagName);
      const isVoid = VOID_ELEMENTS.has(childTagName);

      const serEl: SerializableElement = {
        tagName: childTagName,
        attributes: attrs,
        children: parseChildren(childEl),
        inline: isInline,
        void: isVoid,
      };

      children.push({ type: "element", element: serEl });
    }
  }

  return children;
}
