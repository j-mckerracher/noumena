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
  getAttribute(name: string): string | null;
}

interface DomDocument {
  querySelector(selector: string): DomElement | null;
}

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

/**
 * Parse HTML bytes into a NoumenaDocument model.
 *
 * Classification rules:
 *   - noumena_native: has Noumena schema meta, valid article structure
 *   - raw_html: valid HTML but not Noumena-native
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

  // Check for Noumena schema meta tag
  const schemaMeta = doc.querySelector('meta[name="noumena:schema"]');
  if (!schemaMeta) {
    return { fileClass: "raw_html", document: null };
  }

  const schemaVersion = schemaMeta.getAttribute("content") ?? undefined;

  // Check for document-id meta
  const docIdMeta = doc.querySelector('meta[name="noumena:document-id"]');
  const documentId = docIdMeta?.getAttribute("content") ?? undefined;

  // Check for document-type meta
  const docTypeMeta = doc.querySelector('meta[name="noumena:document-type"]');
  const documentType = docTypeMeta?.getAttribute("content") ?? undefined;

  // Get title
  const titleEl = doc.querySelector("title");
  const title = titleEl?.textContent ?? undefined;

  // Find the article element
  const article = doc.querySelector("article[data-noumena-document]");
  if (!article) {
    return {
      fileClass: "invalid_noumena",
      document: null,
      schemaVersion,
      documentType,
      documentId,
      title,
    };
  }

  // Parse article attributes
  const articleAttrs: Record<string, string> = {};
  for (let i = 0; i < article.attributes.length; i++) {
    const attr = article.attributes[i]!;
    articleAttrs[attr.name.toLowerCase()] = attr.value;
  }

  const noumenaArticle: NoumenaArticle = { attributes: articleAttrs };

  // Parse blocks (direct children of article with data-noumena-block-id)
  const blocks: NoumenaBlock[] = [];
  const roles = new Map<string, NoumenaBlock>();

  for (let ci = 0; ci < article.children.length; ci++) {
    const child = article.children[ci]!;
    const blockId = child.getAttribute("data-noumena-block-id");
    if (!blockId) continue;

    const role = child.getAttribute("data-noumena-role") ?? "";
    const policy = (child.getAttribute("data-conflict-policy") ?? "") as ConflictPolicy;

    const element = parseElement(child);
    const block: NoumenaBlock = {
      blockId,
      role,
      policy,
      element,
      blockHash: "", // computed later by computeBlockHash
    };

    blocks.push(block);
    if (role) {
      roles.set(role, block);
    }
  }

  // Parse metadata JSON from metadata block
  let metadata: NoumenaMetadataV1 = {
    title: title ?? "",
    status: "draft",
    createdAt: new Date().toISOString(),
  };

  const metadataBlock = roles.get("metadata");
  if (metadataBlock) {
    for (const child of metadataBlock.element.children) {
      if (child.type === "rawJson") {
        try {
          metadata = JSON.parse(child.json) as NoumenaMetadataV1;
        } catch {
          // Invalid JSON — leave default metadata
        }
        break;
      }
    }
  }

  const noumenaDoc: NoumenaDocument = {
    schemaVersion: "noumena.html.v1",
    documentType: "research-note",
    documentId: documentId ?? "",
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
// Element parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse a DOM Element into a BlockElement structure for serialization.
 */
function parseElement(el: DomElement): BlockElement {
  const tagName = el.tagName.toLowerCase();
  const attributes: Record<string, string> = {};

  for (let i = 0; i < el.attributes.length; i++) {
    const attr = el.attributes[i]!;
    attributes[attr.name.toLowerCase()] = attr.value;
  }

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
  if (
    tagName === "script" &&
    el.getAttribute("type") === "application/vnd.noumena.metadata+json"
  ) {
    const jsonText = el.textContent ?? "";
    children.push({ type: "rawJson", json: jsonText.trim() });
    return children;
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
      const attrs: Record<string, string> = {};

      for (let ai = 0; ai < childEl.attributes.length; ai++) {
        const attr = childEl.attributes[ai]!;
        attrs[attr.name.toLowerCase()] = attr.value;
      }

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
