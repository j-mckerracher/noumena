/**
 * Canonical serialization of Noumena documents.
 *
 * WI-5034224 — Phase 1 Implementation Plan §21:
 *   Deterministic serialization rules:
 *   - Lowercase tag names and attribute names
 *   - Two-space HTML indentation
 *   - LF line endings
 *   - One trailing newline
 *   - No trailing spaces
 *   - Block-level elements on their own lines
 *   - Inline elements stay inline where specified
 *   - Class tokens deduped and sorted lexicographically
 *
 *   Attribute order:
 *     1. id
 *     2. Sorted data-noumena-* attributes
 *     3. data-conflict-policy
 *     4. href
 *     5. src
 *     6. class
 *     7. Other allowed attributes sorted alphabetically
 *
 *   Metadata JSON:
 *     - Keys sorted recursively
 *     - 2-space JSON indentation
 *     - Arrays one item per line
 *     - JSON starts at column 1 inside the script block
 */

import type {
  NoumenaDocument,
  BlockChild,
  SerializableElement,
} from "./types.js";

// ---------------------------------------------------------------------------
// Attribute ordering
// ---------------------------------------------------------------------------

/**
 * Sort attributes per PDF §21 attribute-order rules.
 */
function sortAttributes(attrs: Record<string, string>): [string, string][] {
  const entries = Object.entries(attrs);
  const result: [string, string][] = [];

  // Phase 1: id
  const id = entries.find(([k]) => k === "id");
  if (id) result.push(id);

  // Phase 2: sorted data-noumena-* attributes
  const noumenaAttrs = entries
    .filter(([k]) => k.startsWith("data-noumena-"))
    .sort((a, b) => a[0].localeCompare(b[0]));
  result.push(...noumenaAttrs);

  // Phase 3: data-conflict-policy
  const conflictPolicy = entries.find(([k]) => k === "data-conflict-policy");
  if (conflictPolicy) result.push(conflictPolicy);

  // Phase 4: href
  const href = entries.find(([k]) => k === "href");
  if (href) result.push(href);

  // Phase 5: src
  const src = entries.find(([k]) => k === "src");
  if (src) result.push(src);

  // Phase 6: class (deduped and sorted)
  const cls = entries.find(([k]) => k === "class");
  if (cls) {
    const tokens = cls[1].split(/\s+/).filter(Boolean);
    const deduped = [...new Set(tokens)].sort();
    result.push(["class", deduped.join(" ")]);
  }

  // Phase 7: other attributes sorted alphabetically
  const used = new Set(result.map(([k]) => k));
  const others = entries
    .filter(([k]) => !used.has(k))
    .sort((a, b) => a[0].localeCompare(b[0]));
  result.push(...others);

  return result;
}

/**
 * Format sorted attributes for an opening tag.
 * Boolean attributes (value === attribute name or empty) rendered as just the name.
 */
function formatAttributes(attrs: [string, string][]): string {
  if (attrs.length === 0) return "";
  return attrs
    .map(([k, v]) => {
      // Boolean attribute (like data-noumena-document)
      if (v === "" || v === k) {
        return k;
      }
      return `${k}="${escapeAttr(v)}"`;
    })
    .join("\n");
}

/**
 * Escape attribute values for HTML.
 */
function escapeAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Metadata JSON serialization
// ---------------------------------------------------------------------------

/**
 * Recursively sort JSON keys and format with 2-space indent,
 * arrays one item per line, starting at column 1.
 */
export function canonicalJsonSerialize(obj: unknown): string {
  return formatJsonValue(obj, 0);
}

function formatJsonValue(val: unknown, depth: number): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "boolean") return String(val);
  if (typeof val === "number") return String(val);
  if (typeof val === "string") return JSON.stringify(val);

  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);

  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const items = val.map((item) => `${childIndent}${formatJsonValue(item, depth + 1)}`);
    return `[\n${items.join(",\n")}\n${indent}]`;
  }

  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>)
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) return "{}";
    const items = entries.map(
      ([k, v]) => `${childIndent}${JSON.stringify(k)}: ${formatJsonValue(v, depth + 1)}`,
    );
    return `{\n${items.join(",\n")}\n${indent}}`;
  }

  return String(val);
}

// ---------------------------------------------------------------------------
// Element serialization
// ---------------------------------------------------------------------------

/** Void elements (self-closing). */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** Inline elements. */
const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data",
  "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u",
  "var", "wbr",
]);

/**
 * Serialize a SerializableElement to canonical HTML.
 */
function serializeElement(
  el: SerializableElement,
  depth: number,
  parentIsInline: boolean,
): string {
  const indent = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();
  const isInline = el.inline ?? INLINE_ELEMENTS.has(tag);
  const isVoid = el.void ?? VOID_ELEMENTS.has(tag);
  const sortedAttrs = sortAttributes(el.attributes);

  // Build opening tag
  let openTag: string;
  if (sortedAttrs.length === 0) {
    openTag = `<${tag}>`;
  } else if (sortedAttrs.length === 1) {
    const attrStr = formatAttributes(sortedAttrs);
    openTag = `<${tag} ${attrStr}>`;
  } else {
    // Multi-attribute: each on its own line, indented
    const attrIndent = "  ".repeat(depth + 1);
    const attrLines = sortedAttrs.map(([k, v]) => {
      if (v === "" || v === k) return `${attrIndent}${k}`;
      return `${attrIndent}${k}="${escapeAttr(v)}"`;
    });
    openTag = `<${tag}\n${attrLines.join("\n")}>`;
  }

  // Void element
  if (isVoid) {
    if (isInline && parentIsInline) {
      return openTag;
    }
    return `${indent}${openTag}`;
  }

  // Inline element with only text children
  if (isInline) {
    const innerParts = serializeChildrenInline(el.children, depth);
    return `${openTag}${innerParts}</${tag}>`;
  }

  // Block element
  const hasOnlyTextOrInline = el.children.every(
    (c) => c.type === "text" || (c.type === "element" && (c.element.inline ?? INLINE_ELEMENTS.has(c.element.tagName))),
  );

  if (hasOnlyTextOrInline && el.children.length > 0) {
    // Single-line content: e.g., <h2>Summary</h2>, <p>text</p>
    const inner = serializeChildrenInline(el.children, depth);
    return `${indent}${openTag}${inner}</${tag}>`;
  }

  if (el.children.length === 0) {
    return `${indent}${openTag}</${tag}>`;
  }

  // Multi-line content
  const childLines = serializeChildren(el.children, depth + 1);
  return `${indent}${openTag}\n${childLines}\n${indent}</${tag}>`;
}

/**
 * Serialize children as inline content (no extra indentation or newlines).
 */
function serializeChildrenInline(children: BlockChild[], depth: number): string {
  return children
    .map((child) => {
      if (child.type === "text") {
        return escapeHtml(child.text.trim());
      }
      if (child.type === "element") {
        return serializeElement(child.element, depth, true);
      }
      return "";
    })
    .join("");
}

/**
 * Serialize children as block content (each on its own line with indentation).
 */
function serializeChildren(children: BlockChild[], depth: number): string {
  const lines: string[] = [];
  for (const child of children) {
    if (child.type === "text") {
      const trimmed = child.text.trim();
      if (trimmed) {
        lines.push(`${"  ".repeat(depth)}${escapeHtml(trimmed)}`);
      }
    } else if (child.type === "element") {
      lines.push(serializeElement(child.element, depth, false));
    } else if (child.type === "rawJson") {
      // Should not appear outside metadata blocks
      lines.push(child.json);
    }
  }
  return lines.join("\n");
}

/**
 * Escape HTML text content.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Block serialization
// ---------------------------------------------------------------------------

/**
 * Serialize a single block element to canonical HTML at the given depth.
 */
function serializeBlock(
  block: { element: { tagName: string; attributes: Record<string, string>; children: BlockChild[] } },
  depth: number,
): string {
  const { tagName, attributes, children } = block.element;
  const indent = "  ".repeat(depth);
  const tag = tagName.toLowerCase();
  const sortedAttrs = sortAttributes(attributes);

  // Build opening tag (always multi-line for blocks with multiple attributes)
  let openTag: string;
  if (sortedAttrs.length <= 1) {
    const attrStr = sortedAttrs.length === 1
      ? ` ${formatAttributes(sortedAttrs)}`
      : "";
    openTag = `<${tag}${attrStr}>`;
  } else {
    const attrIndent = "  ".repeat(depth + 1);
    const attrLines = sortedAttrs.map(([k, v]) => {
      if (v === "" || v === k) return `${attrIndent}${k}`;
      return `${attrIndent}${k}="${escapeAttr(v)}"`;
    });
    openTag = `<${tag}\n${attrLines.join("\n")}>`;
  }

  // Special case: metadata script block
  if (
    tag === "script" &&
    attributes["type"] === "application/vnd.noumena.metadata+json"
  ) {
    const jsonChild = children.find((c) => c.type === "rawJson");
    if (jsonChild && jsonChild.type === "rawJson") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(jsonChild.json);
      } catch {
        parsed = {};
      }
      const canonicalJson = canonicalJsonSerialize(parsed);
      return `${indent}${openTag}\n${canonicalJson}\n${indent}</${tag}>`;
    }
  }

  // Empty block
  if (children.length === 0) {
    return `${indent}${openTag}</${tag}>`;
  }

  // Serialize children
  const childLines = serializeChildren(children, depth + 1);
  return `${indent}${openTag}\n${childLines}\n${indent}</${tag}>`;
}

// ---------------------------------------------------------------------------
// Full document serialization
// ---------------------------------------------------------------------------

/**
 * Canonically serialize a NoumenaDocument to HTML.
 *
 * Produces deterministic output suitable for byte-for-byte comparison.
 * Must be idempotent: canonicalSerialize(parse(canonicalSerialize(parse(bytes)))) ===
 *                     canonicalSerialize(parse(bytes))
 */
export function canonicalSerialize(doc: NoumenaDocument): string {
  const lines: string[] = [];

  // Doctype
  lines.push("<!doctype html>");

  // <html lang="en">
  lines.push('<html lang="en">');

  // <head>
  lines.push("<head>");
  lines.push('  <meta charset="utf-8">');
  // Reconcile title to metadata.title per §11.3
  const title = doc.metadata.title || doc.title;
  lines.push(`  <title>${escapeHtml(title)}</title>`);
  lines.push('  <meta name="noumena:schema" content="noumena.html.v1">');
  lines.push(
    `  <meta name="noumena:document-id" content="${escapeAttr(doc.documentId)}">`,
  );
  lines.push(
    `  <meta name="noumena:document-type" content="${escapeAttr(doc.documentType)}">`,
  );
  lines.push("</head>");

  // <body>
  lines.push("<body>");

  // <article> with sorted attributes
  const articleAttrs = sortAttributes({
    "data-noumena-document": "",
    "data-noumena-document-id": doc.documentId,
    "data-noumena-document-type": doc.documentType,
    "data-noumena-schema-version": doc.schemaVersion,
  });

  const articleAttrIndent = "    "; // depth 2
  const articleAttrLines = articleAttrs.map(([k, v]) => {
    if (v === "" || v === k) return `${articleAttrIndent}${k}`;
    return `${articleAttrIndent}${k}="${escapeAttr(v)}"`;
  });
  lines.push(`  <article\n${articleAttrLines.join("\n")}>`);

  // Blocks in document order
  for (const block of doc.blocks) {
    lines.push(serializeBlock(block, 2));
  }

  // Close elements
  lines.push("  </article>");
  lines.push("</body>");
  lines.push("</html>");

  // Join with LF, strip trailing spaces, ensure one trailing newline
  return (
    lines
      .join("\n")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n") + "\n"
  );
}
