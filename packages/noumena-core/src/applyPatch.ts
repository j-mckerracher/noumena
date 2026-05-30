import { generateId } from "./ids.js";
import type { BlockChild, NoumenaDocument, SerializableElement } from "./types.js";
import type { ParsedPatch, PatchOp } from "./evaluatePatch.js";

export interface ApplyPatchResult {
  document: NoumenaDocument;
  changed: boolean;
}

export interface SanitizeResult {
  html: string;
  changed: boolean;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function sanitizeSummaryFragment(html: string): SanitizeResult {
  const sanitized = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, "");
  return { html: sanitized, changed: sanitized !== html };
}

function textElement(tagName: string, text: string, attrs: Record<string, string> = {}): SerializableElement {
  return {
    tagName,
    attributes: attrs,
    children: [{ type: "text", text }],
    inline: false,
  };
}

function li(children: BlockChild[]): BlockChild {
  return {
    type: "element",
    element: {
      tagName: "li",
      attributes: { "data-noumena-item-id": generateId("ev") },
      children,
      inline: false,
    },
  };
}

function findElementChildren(doc: NoumenaDocument, role: string, tagName: string): BlockChild[] | undefined {
  const block = doc.roles.get(role);
  const child = block?.element.children.find((c) => c.type === "element" && c.element.tagName === tagName);
  return child?.type === "element" ? child.element.children : undefined;
}

function replaceBlockChildrenAfterHeading(doc: NoumenaDocument, role: string, child: BlockChild): void {
  const block = doc.roles.get(role);
  if (!block) return;
  const heading = block.element.children.find((c) => c.type === "element" && c.element.tagName === "h2");
  block.element.children = heading ? [heading, child] : [child];
}

function appendNote(doc: NoumenaDocument, op: PatchOp): void {
  const text = String(op.text ?? op.content ?? "");
  const block = doc.roles.get("notes");
  if (!block) return;
  block.element.children.push({
    type: "element",
    element: textElement("p", text, { "data-noumena-note-id": generateId("note") }),
  });
}

function appendEvidence(doc: NoumenaDocument, op: PatchOp): void {
  const target = findElementChildren(doc, "evidence", "ol");
  if (!target) return;
  const text = String(op.text ?? op.claim ?? op.content ?? "");
  const url = typeof op.url === "string" ? op.url : undefined;
  const children: BlockChild[] = url
    ? [
        { type: "text", text: `${text} ` },
        {
          type: "element",
          element: {
            tagName: "a",
            attributes: { href: url },
            children: [{ type: "text", text: url }],
            inline: true,
          },
        },
      ]
    : [{ type: "text", text }];
  target.push(li(children));
}

function appendAgentEvent(doc: NoumenaDocument, op: PatchOp): void {
  const target = findElementChildren(doc, "agent_events", "ol");
  if (!target) return;
  const text = String(op.text ?? op.message ?? op.content ?? "");
  target.push(li([{ type: "text", text }]));
}

function setStatus(doc: NoumenaDocument, op: PatchOp): void {
  const status = String(op.status ?? op.value ?? "");
  if (["draft", "active", "reviewed", "archived"].includes(status)) {
    doc.metadata.status = status as "draft" | "active" | "reviewed" | "archived";
    syncMetadataBlock(doc);
  }
}

function setMetadata(doc: NoumenaDocument, op: PatchOp): void {
  const fields = (op.fields ?? op.metadata ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(fields)) {
    doc.metadata[key] = value;
  }
  if (typeof fields.title === "string") {
    doc.title = fields.title;
  }
  syncMetadataBlock(doc);
}

function proposeSummary(doc: NoumenaDocument, op: PatchOp): void {
  const content = (op.content ?? {}) as Record<string, unknown>;
  const raw = String(content.html ?? op.html ?? op.text ?? "");
  const sanitized = sanitizeSummaryFragment(raw).html;
  const text = sanitized.replace(/<[^>]+>/g, "").trim();
  replaceBlockChildrenAfterHeading(doc, "summary", {
    type: "element",
    element: textElement("p", text),
  });
}

function syncMetadataBlock(doc: NoumenaDocument): void {
  doc.metadata.updatedAt = new Date().toISOString();
  const block = doc.roles.get("metadata");
  if (block) {
    block.element.children = [{ type: "rawJson", json: JSON.stringify(doc.metadata) }];
  }
}

export function applyPatch(doc: NoumenaDocument, patch: ParsedPatch): ApplyPatchResult {
  for (const op of patch.ops) {
    switch (op.op) {
      case "append_note":
        appendNote(doc, op);
        break;
      case "append_evidence":
        appendEvidence(doc, op);
        break;
      case "append_agent_event":
        appendAgentEvent(doc, op);
        break;
      case "set_status":
        setStatus(doc, op);
        break;
      case "set_metadata":
        setMetadata(doc, op);
        break;
      case "propose_summary":
        proposeSummary(doc, op);
        break;
    }
  }
  return { document: doc, changed: patch.ops.length > 0 };
}
