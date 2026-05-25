# 14 — Workflow Engine (multi-step transition planner)

## Problem

In the target Jira (and most real Jira deployments), issue workflows are step-by-step. To move a `Process task` from `Sprint backlog` to `Closed`, the user must walk through `In Progress → REVIEW → Closed`. Some transitions require additional fields (e.g. closing requires `resolution` and a couple of custom fields — see `13-jira-reality.md`).

Today in Jira's UI this means: open the issue, click Transition, fill the screen, save; repeat. Slow, error-prone, and easy to abandon halfway through.

We want one decisive action: **"set this issue to `<target status>`"**. The system:

1. Plans the path of transitions.
2. Asks the user once for every required field across the chain.
3. Executes the chain in the background.
4. Surfaces progress on the issue card/editor.
5. Can pause / resume on error.

## High-level design

```
UI: user clicks "Set status: Closed" on a Process task currently "Sprint backlog"
  → POST /api/workflow/plan { issueKey, toStatusId }
  → server reads transitions cache, BFS finds the path:
      Sprint backlog → In Progress → REVIEW → Closed
    collects required fields per step:
      [step0] none
      [step1] none
      [step2] resolution + customfield_67470 + customfield_67471
  → returns PlanPreview to UI
  → UI renders a wizard with one screen per step that has required fields
  → user fills, clicks "Run"
  → POST /api/workflow/execute { planId, fieldValuesByStep }
  → server persists workflow_plans + workflow_steps, state='queued'
  → enqueue a pg-boss job 'workflow-run' { planId }
  → worker drains steps one at a time via the outbox
  → SSE events update the UI ('workflow.step.done', 'workflow.plan.done')
```

## Data model

See [`packages/db/src/schema/workflow.ts`](../../packages/db/src/schema/workflow.ts):

- `transitions` — per (issue_type, from_status, to_status) cache populated by `refresh-workflow` job. Each row carries the Jira transition id and its `requiredFields` snapshot.
- `workflow_plans` — one row per user-initiated chain. State: `draft → queued → running → paused | done | failed | cancelled`.
- `workflow_steps` — N rows per plan, ordered by `seq`. State: `pending → running → done | failed | skipped`.

## Planner: BFS over transitions cache

Pseudocode in `apps/server/src/modules/workflow/planner.ts`:

```ts
interface PlanStep {
  fromStatusId: string
  toStatusId: string
  jiraTransitionId: string
  requiredFields: TransitionFieldRequirement[]
}

export async function planPath(
  issueTypeId: string,
  fromStatusId: string,
  toStatusId: string,
): Promise<PlanStep[]> {
  if (fromStatusId === toStatusId) return []

  // BFS using `transitions` as edges.
  const queue: Array<{ node: string; path: PlanStep[] }> = [{ node: fromStatusId, path: [] }]
  const seen = new Set<string>([fromStatusId])

  while (queue.length) {
    const { node, path } = queue.shift()!
    const edges = await db.select().from(transitions)
      .where(and(eq(transitions.issueTypeId, issueTypeId),
                 eq(transitions.fromStatusId, node)))
    for (const e of edges) {
      if (seen.has(e.toStatusId)) continue
      const step: PlanStep = {
        fromStatusId: e.fromStatusId,
        toStatusId:   e.toStatusId,
        jiraTransitionId: e.jiraTransitionId,
        requiredFields: e.requiredFields,
      }
      if (e.toStatusId === toStatusId) return [...path, step]
      seen.add(e.toStatusId)
      queue.push({ node: e.toStatusId, path: [...path, step] })
    }
  }
  throw new NoPathError({ from: fromStatusId, to: toStatusId, issueTypeId })
}
```

### Choosing among multiple paths

BFS finds the shortest path. When there are ties, prefer the path with **fewer required-field steps**; tie-break by preferring transitions whose target status has the same `category` as the destination's category.

### Refreshing the cache

`refresh-workflow` job runs:

- Whenever metadata changes (project or workflow scheme webhook).
- On admin trigger.
- Lazily: if a plan call hits `NoPathError` and the cache is older than 1h, refresh and retry once.

For each `(project, issue_type)` pair, it walks every status in use and calls `GET /rest/api/2/issue/{anyIssueInStatus}/transitions?expand=transitions.fields` to populate `transitions` rows. Cached by `(issueTypeId, fromStatusId)`.

## Execution model

`workflow-run` job (`apps/jobs/src/tasks/workflow-run.ts`):

```ts
async function run({ planId }) {
  await markPlan(planId, 'running')
  for (const step of stepsFor(planId)) {
    if (step.state === 'done') continue
    await markStep(step.id, 'running')
    const idem = `workflow:${planId}:${step.seq}`
    // Enqueue outbox; in this case do NOT batch — we want step ordering enforced
    await withTx(async (tx) => {
      await tx.update(issues)
        .set({ syncState: 'pushing' })
        .where(eq(issues.id, plan.issueId))
      await tx.insert(outboxEvents).values({
        idempotencyKey: idem,
        userId: plan.userId,
        kind: 'issue.transition',
        targetKind: 'issue',
        targetId: plan.issueId,
        payload: {
          transitionId: step.jiraTransitionId,
          fields: step.fieldValues,
        },
      })
    })
    // Wait for the outbox row to land in 'done' (driven by push-outbox worker)
    const outcome = await awaitOutboxOutcome(idem, { timeoutMs: 60_000 })
    if (outcome === 'done') {
      await markStep(step.id, 'done')
      publishSse('issue:' + plan.issueKey, { type: 'workflow.step.done', seq: step.seq })
    } else {
      await markStep(step.id, 'failed', outcome.error)
      await markPlan(planId, 'paused', outcome.error)
      publishSse('issue:' + plan.issueKey, { type: 'workflow.plan.paused' })
      return
    }
  }
  await markPlan(planId, 'done')
  publishSse('issue:' + plan.issueKey, { type: 'workflow.plan.done' })
}
```

Key choices:

- **One transition at a time.** No parallelism across steps. Jira's workflow has side effects (auto-assignments, custom listeners) that must complete before the next transition.
- **The outbox is the actual egress.** We don't call Jira from the workflow worker; we enqueue and wait. This keeps the rate limit, retries, and PAT loading in one place.
- **Pause on first failure.** Plan state goes to `paused`; UI offers Retry (re-run from the failed step) or Cancel.
- **Idempotent re-runs.** Idempotency key is `workflow:<planId>:<seq>` — the outbox dedupes; retries are safe.

## Conflict handling

While a plan is running, an external Jira change can move the issue to a different status:

- After each step, the worker re-reads the issue (from Jira via the outbox response) and verifies `currentStatusId == step.toStatusId`. If not:
  - If the new status is **further along** the planned path, mark intermediate steps `skipped` and continue from the appropriate seq.
  - Otherwise mark the plan `paused`, persist a `conflict` row referencing the divergence, and SSE-emit `workflow.plan.paused` with a diagnostic.

## API surface

See `06-api.md` for full schemas. Quick reference:

```
POST   /api/workflow/plan        { issueKey, toStatusId } → PlanPreview
POST   /api/workflow/execute     { planId, fieldValuesByStep, finalComment? } → { planId, state }
GET    /api/workflow/plans/:id   → plan + steps
POST   /api/workflow/plans/:id/retry
POST   /api/workflow/plans/:id/cancel
```

`PlanPreview` (TypeBox):

```ts
const TransitionFieldReq = t.Object({
  field: t.String(),
  name: t.String(),
  required: t.Boolean(),
  schemaType: t.String(),
  allowedValues: t.Optional(t.Array(t.Object({
    id: t.String(),
    value: t.Optional(t.String()),
    name: t.Optional(t.String()),
  }))),
})

export const PlanPreview = t.Object({
  planId: t.String(),
  steps: t.Array(t.Object({
    seq: t.Integer(),
    fromStatusName: t.String(),
    toStatusName: t.String(),
    transitionName: t.String(),
    requiredFields: t.Array(TransitionFieldReq),
  })),
  hasRequiredFields: t.Boolean(),
  totalSteps: t.Integer(),
})
```

## UI surface

See `09-ui-issue-editor.md` for the editor integration. The workflow planner appears as:

- **Status dropdown** in the issue editor lists *all* reachable statuses (not just one-hop transitions). Selecting a multi-hop target opens the **workflow wizard**.
- **Wizard** shows the planned chain as a horizontal stepper, with one form per step that has required fields. The user can scroll through all forms before clicking Run.
- **Card-level badge**: while a plan is running, the issue card shows a small spinner with the current step ("step 2/3 → REVIEW").
- **Inline error / retry** on the card and in the editor when the plan pauses.

## Edge cases (must handle)

- **No path**: `NoPathError` → UI shows "There is no transition path from X to Y; this status may require a different workflow scheme." We offer a 1-click "refresh workflow cache" action that re-runs `refresh-workflow` then retries plan.
- **Cycle in workflow graph**: BFS naturally avoids revisiting nodes; cycles are not traversed.
- **Transition removed mid-execution** (admin changed the workflow): outbox push returns Jira's `400 - transition no longer available`. Plan → `failed`, step → `failed`, UI offers re-plan.
- **Permission lost mid-execution**: 403 from Jira → mark `dead` per outbox rules, plan → `paused`, UI shows "your PAT can't perform this transition".
- **Required fields drift** between plan time and execute time: at execute time, the worker re-validates that supplied fields cover current requirements. Drift → plan → `paused` with a diagnostic listing the new requirements.
- **Concurrent plans for the same issue**: rejected at `POST /api/workflow/plan` if an active plan (state in `queued|running|paused`) exists; UI offers "view active plan" instead.

## Audit

Each plan emits `audit_log` rows:

- `workflow.plan.created`
- `workflow.step.executed` (per step, with from/to + transition id)
- `workflow.plan.done | paused | failed | cancelled`

## Why this is worth building

Without the planner, multi-step transitions are the most painful daily-driver flow in the target workflow (per the user). With it, the team gets:

- **One click to "Close".** The system handles the chain.
- **No half-finished transitions.** Wizard makes the user provide every required field upfront — the chain runs unattended.
- **Resumable on error.** Network blip or stale PAT no longer means "restart the whole chain manually".
- **Visible in the UI.** Sync badge on the card shows the current step; conflict / pause states are surfaced clearly.
