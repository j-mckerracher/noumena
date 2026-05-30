/**
 * Tests for validateDocument.
 *
 * WI-5034224 — AC-002: Document validation rules.
 */

import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import {
  validateDocument,
  loadInvalidFixture,
  loadValidFixture,
  fixturePath,
} from "@noumena/core";

// ---------------------------------------------------------------------------
// Helper: build a valid research-note HTML string programmatically
// ---------------------------------------------------------------------------

function validResearchNote(overrides: {
  title?: string;
  metadataJson?: string;
  extraBlocks?: string;
  noDoctype?: boolean;
  noSchemaMeta?: boolean;
  noArticle?: boolean;
  schemaVersion?: string;
  documentId?: string;
  revisionMeta?: boolean;
  articleContent?: string;
} = {}): string {
  const title = overrides.title ?? "Test Note";
  const docId = overrides.documentId ?? "doc_01JZ9A7V6QK8M3X2T5N4R1B0CY";
  const schemaVersion = overrides.schemaVersion ?? "noumena.html.v1";
  const metadataJson = overrides.metadataJson ?? JSON.stringify({
    title,
    status: "draft",
    createdAt: "2026-01-01T00:00:00Z",
  });

  const doctype = overrides.noDoctype ? "" : "<!doctype html>\n";
  const schemaMeta = overrides.noSchemaMeta
    ? ""
    : `  <meta name="noumena:schema" content="${schemaVersion}">\n`;
  const revisionMeta = overrides.revisionMeta
    ? '  <meta name="noumena:revision" content="sha256:abc">\n'
    : "";

  if (overrides.noArticle) {
    return `${doctype}<html lang="en">
<head>
  <meta charset="utf-8">
${schemaMeta}${revisionMeta}  <title>${title}</title>
</head>
<body>
  <div>No article here</div>
</body>
</html>`;
  }

  const articleContent = overrides.articleContent ?? `
    <script
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000001"
      data-noumena-role="metadata"
      data-conflict-policy="merge_text"
      type="application/vnd.noumena.metadata+json">
${metadataJson}
    </script>
    <section
      id="summary"
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000002"
      data-noumena-role="summary"
      data-conflict-policy="replace_requires_clean_base">
      <h2>Summary</h2>
      <p></p>
    </section>
    <section
      id="notes"
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000003"
      data-noumena-role="notes"
      data-conflict-policy="append_only">
      <h2>Notes</h2>
    </section>
    <section
      id="evidence"
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000004"
      data-noumena-role="evidence"
      data-conflict-policy="append_only">
      <h2>Evidence</h2>
      <ol></ol>
    </section>
    <section
      id="agent-events"
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000005"
      data-noumena-role="agent_events"
      data-conflict-policy="append_only">
      <h2>Agent Events</h2>
      <ol></ol>
    </section>${overrides.extraBlocks ?? ""}`;

  return `${doctype}<html lang="en">
<head>
  <meta charset="utf-8">
${schemaMeta}${revisionMeta}  <title>${title}</title>
  <meta name="noumena:document-id" content="${docId}">
  <meta name="noumena:document-type" content="research-note">
</head>
<body>
  <article
    data-noumena-document
    data-noumena-document-id="${docId}"
    data-noumena-document-type="research-note"
    data-noumena-schema-version="${schemaVersion}">
${articleContent}
  </article>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Valid documents
// ---------------------------------------------------------------------------

describe("validateDocument — valid documents", () => {
  it("valid research-note with all required roles returns patchable: true", () => {
    const result = validateDocument(validResearchNote());
    expect(result.valid).toBe(true);
    expect(result.patchable).toBe(true);
    expect(result.fileClass).toBe("noumena_native");
    expect(result.errors).toHaveLength(0);
  });

  it("warning-only docs are patchable: true", () => {
    const result = validateDocument(validResearchNote({
      title: "HTML Title",
      metadataJson: JSON.stringify({
        title: "Different Metadata Title",
        status: "draft",
        createdAt: "2026-01-01T00:00:00Z",
      }),
    }));
    expect(result.patchable).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.code === "title_metadata_mismatch")).toBe(true);
  });

  it("unknown metadata fields produce warnings not errors", () => {
    const result = validateDocument(validResearchNote({
      metadataJson: JSON.stringify({
        title: "Test Note",
        status: "draft",
        createdAt: "2026-01-01T00:00:00Z",
        customField: "value",
      }),
    }));
    expect(result.patchable).toBe(true);
    expect(result.warnings.some((w) => w.code === "metadata_unknown_field")).toBe(true);
  });

  it("unknown role produces warning, not error", () => {
    const result = validateDocument(validResearchNote({
      extraBlocks: `
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000006"
      data-noumena-role="custom_role"
      data-conflict-policy="append_only">
      <p>Custom content</p>
    </section>`,
    }));
    expect(result.patchable).toBe(true);
    expect(result.warnings.some((w) => w.code === "unknown_role")).toBe(true);
  });

  it("raw HTML (no noumena markers) returns raw_html, patchable: false", () => {
    const result = validateDocument("<html><body><p>Hello</p></body></html>");
    expect(result.fileClass).toBe("raw_html");
    expect(result.patchable).toBe(false);
    expect(result.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Invalid documents — error code verification
// ---------------------------------------------------------------------------

describe("validateDocument — error codes", () => {
  it("missing_document_article — no article", () => {
    const result = validateDocument(validResearchNote({ noArticle: true }));
    expect(result.patchable).toBe(false);
    expect(result.errors.some((e) => e.code === "missing_document_article")).toBe(true);
  });

  it("unknown_schema_version", () => {
    const result = validateDocument(validResearchNote({ schemaVersion: "noumena.html.v99" }));
    expect(result.patchable).toBe(false);
    expect(result.errors.some((e) => e.code === "unknown_schema_version")).toBe(true);
  });

  it("forbidden_revision_meta", () => {
    const result = validateDocument(validResearchNote({ revisionMeta: true }));
    expect(result.patchable).toBe(false);
    expect(result.errors.some((e) => e.code === "forbidden_revision_meta")).toBe(true);
  });

  it("invalid_document_id", () => {
    const result = validateDocument(validResearchNote({ documentId: "bad_id" }));
    expect(result.patchable).toBe(false);
    expect(result.errors.some((e) => e.code === "invalid_document_id")).toBe(true);
  });

  it("duplicate_block_id", () => {
    const html = validResearchNote({
      articleContent: `
    <script
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000001"
      data-noumena-role="metadata"
      data-conflict-policy="merge_text"
      type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000001"
      data-noumena-role="summary"
      data-conflict-policy="replace_requires_clean_base">
    </section>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000003"
      data-noumena-role="notes"
      data-conflict-policy="append_only">
    </section>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000004"
      data-noumena-role="evidence"
      data-conflict-policy="append_only">
      <ol></ol>
    </section>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000005"
      data-noumena-role="agent_events"
      data-conflict-policy="append_only">
      <ol></ol>
    </section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "duplicate_block_id")).toBe(true);
  });

  it("duplicate_role", () => {
    const html = validResearchNote({
      articleContent: `
    <script
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000001"
      data-noumena-role="metadata"
      data-conflict-policy="merge_text"
      type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000002"
      data-noumena-role="metadata"
      data-conflict-policy="merge_text">
    </section>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000003"
      data-noumena-role="summary"
      data-conflict-policy="replace_requires_clean_base">
    </section>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000004"
      data-noumena-role="notes"
      data-conflict-policy="append_only">
    </section>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000005"
      data-noumena-role="evidence"
      data-conflict-policy="append_only">
      <ol></ol>
    </section>
    <section
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000006"
      data-noumena-role="agent_events"
      data-conflict-policy="append_only">
      <ol></ol>
    </section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "duplicate_role")).toBe(true);
  });

  it("metadata_invalid_json", () => {
    const html = validResearchNote({
      articleContent: `
    <script
      data-noumena-block-id="blk_01JZ9A7Y80000000000000000001"
      data-noumena-role="metadata"
      data-conflict-policy="merge_text"
      type="application/vnd.noumena.metadata+json">
    {invalid json}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "metadata_invalid_json")).toBe(true);
  });

  it("unknown_conflict_policy", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="unknown_policy"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "unknown_conflict_policy")).toBe(true);
  });

  it("policy_not_allowed_for_role", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "policy_not_allowed_for_role")).toBe(true);
  });

  it("forbidden_element — iframe", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"><iframe src="evil.html"></iframe></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "forbidden_element")).toBe(true);
  });

  it("forbidden_element — executable script", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"><script>alert(1)</script></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "forbidden_element")).toBe(true);
  });

  it("forbidden_event_handler", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"><p onclick="alert(1)">Evil</p></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "forbidden_event_handler")).toBe(true);
  });

  it("forbidden_url_scheme — javascript:", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"><a href="javascript:alert(1)">Evil</a></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "forbidden_url_scheme")).toBe(true);
  });

  it("missing_required_role — missing summary", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "missing_required_role" && e.role === "summary")).toBe(true);
  });

  it("evidence_missing_ol", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><p>No ol here</p></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "evidence_missing_ol")).toBe(true);
  });

  it("agent_events_missing_ol", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><p>No ol here</p></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "agent_events_missing_ol")).toBe(true);
  });

  it("wrong_element_for_role — metadata as section instead of script", () => {
    const html = validResearchNote({
      articleContent: `
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text">
      <p>Should be a script</p>
    </section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "wrong_element_for_role")).toBe(true);
  });

  it("block_missing_conflict_policy", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary">
    </section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "block_missing_conflict_policy")).toBe(true);
  });

  it("forbidden_srcdoc", () => {
    const html = validResearchNote({
      articleContent: `
    <script data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text" type="application/vnd.noumena.metadata+json">
{"title":"Test","status":"draft","createdAt":"2026-01-01T00:00:00Z"}
    </script>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000002" data-noumena-role="summary" data-conflict-policy="replace_requires_clean_base"><div srcdoc="<script>alert(1)</script>">Evil</div></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000003" data-noumena-role="notes" data-conflict-policy="append_only"></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000004" data-noumena-role="evidence" data-conflict-policy="append_only"><ol></ol></section>
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000005" data-noumena-role="agent_events" data-conflict-policy="append_only"><ol></ol></section>`,
    });
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "forbidden_srcdoc")).toBe(true);
  });

  it("unsupported_document_type", () => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="noumena:schema" content="noumena.html.v1">
  <title>Test</title>
  <meta name="noumena:document-type" content="journal">
</head>
<body>
  <article data-noumena-document data-noumena-document-type="journal">
    <section data-noumena-block-id="blk_01JZ9A7Y80000000000000000001" data-noumena-role="metadata" data-conflict-policy="merge_text">
    </section>
  </article>
</body>
</html>`;
    const result = validateDocument(html);
    expect(result.errors.some((e) => e.code === "unsupported_document_type")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture-based tests — all invalid fixtures produce exact expected error codes
// ---------------------------------------------------------------------------

/**
 * Expected error codes for each invalid fixture, validated against the actual
 * validator output. The array order matches sorted error codes (with
 * duplicates preserved) so a simple deep-equal catches wrong, missing, or
 * extra error codes.
 *
 * WI-5034224 AC-002 / AC-006: exact expected error codes per DoD.
 */
const EXPECTED_FIXTURE_ERRORS: Map<string, string[]> = new Map([
  ["agent-events-missing-ol.invalid.html", ["agent_events_missing_ol", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "wrong_element_for_role"]],
  ["duplicate-block-id.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "duplicate_block_id", "wrong_element_for_role"]],
  ["duplicate-role.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "duplicate_role", "wrong_element_for_role"]],
  ["evidence-missing-ol.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "evidence_missing_ol", "wrong_element_for_role"]],
  ["forbidden-iframe.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "forbidden_element", "wrong_element_for_role"]],
  ["forbidden-revision-meta.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "forbidden_revision_meta", "wrong_element_for_role"]],
  ["forbidden-script.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "forbidden_element", "wrong_element_for_role"]],
  ["invalid-document-id.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "invalid_document_id", "wrong_element_for_role"]],
  ["invalid-metadata-json.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "metadata_invalid_json", "wrong_element_for_role"]],
  ["javascript-url.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "forbidden_url_scheme", "wrong_element_for_role"]],
  ["missing-agent-events-role.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "missing_required_role", "wrong_element_for_role"]],
  ["missing-doctype.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "missing_document_article", "wrong_element_for_role"]],
  ["missing-document-article.invalid.html", ["missing_document_article"]],
  ["missing-evidence-role.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "missing_required_role", "wrong_element_for_role"]],
  ["missing-metadata-role.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "missing_required_role"]],
  ["missing-notes-role.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "missing_required_role", "wrong_element_for_role"]],
  ["missing-schema-meta.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "missing_document_article", "wrong_element_for_role"]],
  ["missing-summary-role.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "missing_required_role", "wrong_element_for_role"]],
  ["multiple-document-articles.invalid.html", ["missing_document_article"]],
  ["policy-not-allowed-for-role.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "policy_not_allowed_for_role", "wrong_element_for_role"]],
  ["unknown-conflict-policy.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "unknown_conflict_policy", "wrong_element_for_role"]],
  ["unknown-schema-version.invalid.html", ["block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "block_missing_conflict_policy", "unknown_schema_version", "wrong_element_for_role"]],
]);

describe("validateDocument — fixture-based invalid documents", () => {
  const invalidFixtureDir = fixturePath("validation/invalid", "");
  let invalidFiles: string[] = [];

  try {
    invalidFiles = readdirSync(invalidFixtureDir).filter((f) => f.endsWith(".html"));
  } catch {
    // Directory may not exist in test env
  }

  it("has expected error metadata for every invalid fixture", () => {
    expect(invalidFiles.length).toBeGreaterThan(0);
    for (const f of invalidFiles) {
      expect(EXPECTED_FIXTURE_ERRORS.has(f)).toBe(true);
    }
  });

  for (const filename of invalidFiles) {
    it(`${filename} produces exact expected error codes`, () => {
      const html = loadInvalidFixture(filename);
      const result = validateDocument(html);
      const actualCodes = result.errors.map((e) => e.code).sort();
      const expectedCodes = EXPECTED_FIXTURE_ERRORS.get(filename) ?? [];
      expect(actualCodes).toEqual(expectedCodes);
      expect(result.patchable).toBe(false);
    });
  }
});

// ---------------------------------------------------------------------------
// Fixture-based tests — all valid fixtures pass with patchable: true
// WI-5034224 AC-002 / AC-006: valid fixture DoD coverage.
// ---------------------------------------------------------------------------

describe("validateDocument — fixture-based valid documents", () => {
  const validFixtureDir = fixturePath("validation/valid", "");
  let validFiles: string[] = [];

  try {
    validFiles = readdirSync(validFixtureDir).filter((f) => f.endsWith(".html"));
  } catch {
    // Directory may not exist in test env
  }

  it("has at least one valid fixture", () => {
    expect(validFiles.length).toBeGreaterThan(0);
  });

  for (const filename of validFiles) {
    it(`${filename} passes with valid:true and patchable:true`, () => {
      const html = loadValidFixture(filename);
      const result = validateDocument(html);
      expect(result.valid).toBe(true);
      expect(result.patchable).toBe(true);
      expect(result.fileClass).toBe("noumena_native");
      expect(result.errors).toHaveLength(0);
    });
  }
});
