# `features/workflow-planner`

Wizard UI for multi-hop Jira transitions backed by the M5b workflow engine.

## Surface

- `WorkflowWizard` — modal dialog. Mount once per `IssuePanel`. Reads `useWorkflowWizard` store to decide whether it is open and for which `issueKey` / `targetStatusId`.
- `PlanProgressBadge` — inline `<span>` showing live state of the active plan for an issue. Polls every 2 s while running; stops on terminal state.
- `useWorkflowWizard()` — Zustand store. Call `open({ issueKey, targetStatusId, targetStatusName })` to launch the wizard from any feature (typically the status field of `PropertiesGrid`).

## Data flow

```
PropertiesGrid status field
  → useWorkflowWizard.open(...)
  → WorkflowWizard mounts
  → POST /api/workflow/plan (usePlanTransition)
  → render PlanStepPreview[]; collect required-field values
  → POST /api/workflow/execute (useExecutePlan)
  → poll GET /api/workflow/plans/:id every 2 s (usePlanDetail)
  → on terminal state: close on Done, surface error on Failed (retry/cancel)
```

The worker (`apps/jobs/src/tasks/workflow-run.ts`) is the only thing that talks to Jira; the UI just polls plan state.

## Rules

- No direct `fetch`. All transport goes through `lib/eden.ts` re-exported from this feature's `api.ts`.
- Cross-feature imports go through `index.ts`.
- All inline comments in TypeScript files are in Russian (see `.agents/DO_NOT.md`).
