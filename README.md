# Noumena

A structured document patching system with vault-based storage, conflict policies, and review workflows.

## Prerequisites

- Node.js ≥ 20.0.0
- pnpm

## Install

```bash
pnpm install
```

## Build

```bash
pnpm build
```

## Done Condition

Phase 1 is complete when both gates pass from a clean checkout:

1. **`pnpm test:phase1`** — runs the full Vitest suite (291 core + 29 CLI = 320 tests), including all 21 AC-005 integration scenarios
2. **`pnpm demo:phase1`** — runs the end-to-end dogfood loop and prints a success JSON to stdout

No Electron or browser process is required at any point.

## Commands

```bash
# Run all Phase 1 tests (core + CLI integration)
pnpm test:phase1

# Run the Phase 1 demo dogfood loop
pnpm demo:phase1
```

### CLI Usage

```bash
# Initialize a vault
noumena vault init <vault> --json

# Create a document
noumena doc create <vault> <path> --type=research-note --title="Title" --json

# Inspect a document (revision, roles, block hashes)
noumena doc info <vault> <path> --json

# Validate a document
noumena doc validate <vault> <path> --json

# Submit a patch
noumena patch submit <vault> <doc> <patch-file> --json

# Dry-run a patch (no mutations)
noumena patch dry-run <vault> <doc> <patch-file> --json

# Approve a queued review
noumena patch approve <vault> <review-id> --json

# Reject a queued review
noumena patch reject <vault> <review-id> --json

# Roll back the latest applied patch
noumena patch rollback <vault> <patch-id> --json

# Show patch status
noumena patch status <vault> <id> --json

# Show patch diff (human-readable)
noumena patch show <vault> <id> --format=block-diff
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Valid domain outcome |
| 2 | CLI usage error |
| 3 | Patch JSON parse or schema error |
| 4 | Vault, path, or document error |
| 5 | Internal failure |

## Architecture

```
packages/
  noumena-core/     Core logic: parsing, patching, conflict policies, vault ops
  noumena-cli/      CLI plumbing only — delegates all logic to core
  noumena-desktop/  Phase 2: read-only Electron viewer/review shell
scripts/
  demo-phase1.mjs  End-to-end dogfood loop script
```

All domain logic lives in `noumena-core`. The CLI (`noumena-cli`) is pure command routing and exit-code mapping. The desktop app (`noumena-desktop`) is a hardened Electron shell that wraps `noumena-core` in-process — no new mutation primitives.

## Phase 2: Desktop viewer

Read-only viewer + queued-review approver. Wraps the Phase 1 core; never bypasses it. No Tiptap editor.

```bash
# Dev (Vite + Electron, hot reload)
pnpm dev:desktop

# Build all artifacts (main, preload, renderer)
pnpm build:desktop

# Launch built app
pnpm start:desktop

# Phase 2 unit tests
pnpm test:phase2
```

Capabilities:

- Open vault via OS file picker (vault must be initialized with `noumena vault init`).
- Recent vaults remembered between launches.
- File tree of `.html` documents.
- Read-only Noumena-native HTML preview (rendered from the on-disk article element, validated through `validateDocument`).
- Pending review queue with Approve / Reject buttons — delegate to `approvePatch` / `rejectPatch` in `@noumena/core`.
- Block diff view via `patchShow --format=block-diff`.
- Document history list with rollback of the latest applied patch.
- Live refresh via `chokidar` watcher when files or `.noumena/` change externally (e.g. CLI patches in another terminal).

Security defaults:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Strict CSP set via `webRequest.onHeadersReceived`.
- Renderer never imports `@noumena/core` and never touches the filesystem directly — every operation goes through typed IPC to the main process.
