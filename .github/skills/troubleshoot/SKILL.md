---
name: troubleshoot
description: |
  Multi-agent troubleshooting workflow for code bugs, runtime errors, and UI/CSS styling issues.
  Use when a bug or visual regression needs systematic root-cause analysis and a written fix report.
  Provides: (1) 5-agent sequential pipeline — triage → diagnostic → analyzer → resolver → verifier,
  (2) Structured Markdown report with root cause, fix diff, and verification status,
  (3) Automated test verification or explicit human-validation checklist when automation is not possible.
  Keywords: troubleshoot, debug, bug, error, crash, css, styling, runtime error, stack trace, layout regression, component bug, ui bug, type error, null reference
---

# Troubleshoot

Systematic multi-agent investigation for code bugs, runtime errors, and UI/CSS styling issues.

## When to Use This Skill

Activate when:
- A runtime error, exception, stack trace, or crash needs root-cause analysis
- A UI component has unexpected styling, layout, or visual regression
- A bug needs a written report with fix recommendation and verification evidence

## Orchestration Instructions

**You are the orchestrator.** Execute these steps in order.

---

### Step 1 — Collect the problem description

If the user invoked `/troubleshoot` without a description, ask:

> "What is the problem? Paste the error message, describe the visual issue, or describe the unexpected behavior."

Wait for the response before continuing.

---

### Step 2 — Generate RUN-ID and create artifact directory

```bash
RUN_ID="$(date +%Y%m%d-%H%M%S)-troubleshoot"
ARTIFACT_DIR="/Users/mckerracher.joshua/Code/agent-troubleshooting-team/reports/${RUN_ID}"
mkdir -p "${ARTIFACT_DIR}"
echo "${RUN_ID}"
```

Write the problem description to `${ARTIFACT_DIR}/problem.txt`.

Tell the user: "Starting troubleshooting run `{RUN_ID}`. Artifacts will be written to `agent-troubleshooting-team/reports/{RUN_ID}/`."

---

### Step 3 — Create the team

Use `TeamCreate` with:
- `team_name`: `troubleshoot-{RUN_ID}` (truncate to fit name limits if needed)
- `description`: The problem description (first 100 chars)

---

### Step 4 — Run the 5-agent pipeline (sequential)

Spawn each agent using the `Agent` tool. **Each agent must complete before the next is spawned.**

For each spawn, pass a prompt containing:
1. The `artifact_dir` absolute path
2. A brief summary of the problem
3. Which YAML files they should read (listed below)

#### Agent 1: `troubleshoot-triage`
- Prompt must include: full problem description text, `artifact_dir`
- Reads: `problem.txt`
- Writes: `triage.yaml`

#### Agent 2: `troubleshoot-diagnostic`
- Prompt must include: `artifact_dir`, note that `triage.yaml` is ready
- Reads: `triage.yaml`
- Writes: `diagnostic.yaml`

#### Agent 3: `troubleshoot-analyzer`
- Prompt must include: `artifact_dir`, note that `diagnostic.yaml` is ready
- Reads: `diagnostic.yaml`
- Writes: `analysis.yaml`

#### Agent 4: `troubleshoot-resolver`
- Prompt must include: `artifact_dir`, note that `analysis.yaml` is ready
- Reads: `analysis.yaml` and `diagnostic.yaml`
- Writes: `resolution.yaml` and `report-draft.md`

#### Agent 5: `troubleshoot-verifier`
- Prompt must include: `artifact_dir`, note that `resolution.yaml` and `report-draft.md` are ready
- Reads: `resolution.yaml` and `report-draft.md`
- Writes: `report.md`

---

### Step 5 — Report to user

After the verifier completes, read `${ARTIFACT_DIR}/report.md` and display:

1. The full **Verification Status** section
2. The **Root Cause** section
3. The path to the full report: `agent-troubleshooting-team/reports/{RUN_ID}/report.md`

If the verifier marked `FIX FAILED`, ask the user: "The recommended fix failed automated tests. Would you like me to try Option 2, or do you want to escalate?"

---

## Required Skills

- `execution-discipline` — plan before acting, verify before done
- `scope-and-security` — forbidden file patterns, no credential access
- `session-logging` — log orchestration activity per agent spawn
