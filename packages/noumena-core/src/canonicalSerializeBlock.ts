/**
 * Canonical serialization of a single Noumena block.
 *
 * WI-5034224 — Phase 1 Implementation Plan §12, §21:
 *   canonicalSerializeBlock(block) includes the canonical persistent block identity,
 *   attributes, and child content. It excludes nothing in Phase 1 unless explicitly
 *   declared non-canonical.
 *
 *   Block hash = sha256(canonicalSerializeBlock(block))
 */

import type { NoumenaBlock, BlockChild, SerializableElement } from "./types.js";
import { canonicalJsonSerialize } from "./canonicalSerialize.js";

// ---------------------------------------------------------------------------
// Attribute ordering (same rules as canonicalSerialize.ts §21)
// ---------------------------------------------------------------------------

function sortAttributes(attrs: Record<string, string>): [string, string][] {
  const entries = Object.entries(attrs);
  const result: [string, string][] = [];

  const id = entries.find(([k]) => k === "id");
  if (id) result.push(id);

  const noumenaAttrs = entries
    .filter(([k]) => k.startsWith("data-noumena-"))
    .sort((a, b) => a[0].localeCompare(b[0]));
  result.push(...noumenaAttrs);

  const conflictPolicy = entries.find(([k]) => k === "data-conflict-policy");
  if (conflictPolicy) result.push(conflictPolicy);

  const href = entries.find(([k]) => k === "href");
  if (href) result.push(href);

  const src = entries.find(([k]) => k === "src");
  if (src) result.push(src);

  const cls = entries.find(([k]) => k === "class");
  if (cls) {
    const tokens = cls[1].split(/\s+/).filter(Boolean);
    const deduped = [...new Set(tokens)].sort();
    result.push(["class", deduped.join(" ")]);
  }

  const used = new Set(result.map(([k]) => k));
  const others = entries
    .filter(([k]) => !used.has(k))
    .sort((a, b) => a[0].localeCompare(b[0]));
  result.push(...others);

  return result;
}

function escapeAttr(val: string): string {
  return val
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------
// Inline elements
// ---------------------------------------------------------------------------

const INLINE_ELEMENTS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "br", "cite", "code", "data",
  "dfn", "em", "i", "kbd", "mark", "q", "rp", "rt", "ruby", "s",
  "samp", "small", "span", "strong", "sub", "sup", "time", "u",
  "var", "wbr",
]);

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

// ---------------------------------------------------------------------------
// Element serialization
// ---------------------------------------------------------------------------

function serializeElement(el: SerializableElement, depth: number, parentInline: boolean): string {
  const indent = "  ".repeat(depth);
  const tag = el.tagName.toLowerCase();
  const isInline = el.inline ?? INLINE_ELEMENTS.has(tag);
  const isVoid = el.void ?? VOID_ELEMENTS.has(tag);
  const sortedAttrs = sortAttributes(el.attributes);

  let openTag: string;
  if (sortedAttrs.length === 0) {
    openTag = `<${tag}>`;
  } else if (sortedAttrs.length === 1) {
    const [k, v] = sortedAttrs[0]!;
    const attrStr = v === "" || v === k ? k : `${k}="${escapeAttr(v)}"`;
    openTag = `<${tag} ${attrStr}>`;
  } else {
    const attrIndent = "  ".repeat(depth + 1);
    const attrLines = sortedAttrs.map(([k, v]) => {
      if (v === "" || v === k) return `${attrIndent}${k}`;
      return `${attrIndent}${k}="${escapeAttr(v)}"`;
    });
    openTag = `<${tag}\n${attrLines.join("\n")}>`;
  }

  if (isVoid) {
    return isInline && parentInline ? openTag : `${indent}${openTag}`;
  }

  if (isInline) {
    const inner = serializeChildrenInline(el.children, depth);
    return `${openTag}${inner}</${tag}>`;
  }

  const hasOnlyInline = el.children.every(
    (c) =>
      c.type === "text" ||
      (c.type === "element" && (c.element.inline ?? INLINE_ELEMENTS.has(c.element.tagName))),
  );

  if (hasOnlyInline && el.children.length > 0) {
    const inner = serializeChildrenInline(el.children, depth);
    return `${indent}${openTag}${inner}</${tag}>`;
  }

  if (el.children.length === 0) {
    return `${indent}${openTag}</${tag}>`;
  }

  const childLines = serializeChildren(el.children, depth + 1);
  return `${indent}${openTag}\n${childLines}\n${indent}</${tag}>`;
}

function serializeChildrenInline(children: BlockChild[], depth: number): string {
  return children
    .map((c) => {
      if (c.type === "text") return escapeHtml(c.text.trim());
      if (c.type === "element") return serializeElement(c.element, depth, true);
      return "";
    })
    .join("");
}

function serializeChildren(children: BlockChild[], depth: number): string {
  const lines: string[] = [];
  for (const child of children) {
    if (child.type === "text") {
      const trimmed = child.text.trim();
      if (trimmed) lines.push(`${"  ".repeat(depth)}${escapeHtml(trimmed)}`);
    } else if (child.type === "element") {
      lines.push(serializeElement(child.element, depth, false));
    } else if (child.type === "rawJson") {
      lines.push(child.json);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Canonically serialize a single block for block hash computation.
 *
 * Includes the block element's tag, all attributes, and all child content
 * in canonical form. The output starts at indent depth 0 (no leading indent).
 */
export function canonicalSerializeBlock(block: NoumenaBlock): string {
  const { tagName, attributes, children } = block.element;
  const tag = tagName.toLowerCase();
  const sortedAttrs = sortAttributes(attributes);

  // Build opening tag
  let openTag: string;
  if (sortedAttrs.length <= 1) {
    const attrStr = sortedAttrs.length === 1
      ? (() => {
          const [k, v] = sortedAttrs[0]!;
          return ` ${v === "" || v === k ? k : `${k}="${escapeAttr(v)}"`}`;
        })()
      : "";
    openTag = `<${tag}${attrStr}>`;
  } else {
    const attrIndent = "  ";
    const attrLines = sortedAttrs.map(([k, v]) => {
      if (v === "" || v === k) return `${attrIndent}${k}`;
      return `${attrIndent}${k}="${escapeAttr(v)}"`;
    });
    openTag = `<${tag}\n${attrLines.join("\n")}>`;
  }

  // Metadata script: serialize JSON canonically
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
      return `${openTag}\n${canonicalJson}\n</${tag}>`;
    }
  }

  if (children.length === 0) {
    return `${openTag}</${tag}>`;
  }

  const childLines = serializeChildren(children, 1);
  return `${openTag}\n${childLines}\n</${tag}>`;
}
