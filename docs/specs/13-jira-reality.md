# 13 — Observed Jira Reality

This document records what we learned by probing the real target Jira instance (`jira`, Jira Server **9.12.19**) on **2026-05-15**. It exists so future implementation agents can ground assumptions in concrete data instead of generic Jira-API folklore.

> **Note**: any token, user, or URL referenced here is for illustrative reference only. The PAT used to gather this data is **not** persisted in the codebase. Real connectivity is configured at deploy time via `JIRA_BASE_URL` and a per-user PAT (`03-auth.md`).

## Target instance

| Property           | Value                            |
| ------------------ | -------------------------------- |
| Base URL           | `https://jira`                   |
| Deployment         | `Server`                         |
| Version            | `9.12.19`                        |
| REST surface       | `/rest/api/2`, `/rest/agile/1.0` |
| Auth               | PAT (Bearer)                     |
| Description format | Wiki + ADF (mixed; we store ADF) |

## Reference project: `ALFAIAAS` (alfa-iaas)

- `projectTypeKey`: `software`.
- **28 issue types** are configured. Many are bank-specific, several in Russian. Their canonical names:

  ```
  Epic, Task, Bug, User Story, Test, Issue, Idea, Tech, Request (FR), Запрос,
  Discovery Task, Process task, Change task, TechDebt, archDEBT, cyberDEBT,
  Platform Devops Task, Platform Request Task, Design BAU, Design Corp,
  Дефект промсреды, Клиентский долг, Настройка продуктов, ДПА,
  Процессы сервиса и взыскания, Новый счет в SAP АХД, Мероприятие, Обновление лимитов
  ```

- The team's **primary working set** is `Epic`, `Process task`, `Change task`, `User Story`, `Task`, `Bug`, `TechDebt`. Everything else is supported but less common.
- The default kanban board is **id 73355** ("ALFAIAAS (Epic board)") with columns:

  ```
  Backlog          (no Jira status — overflow)
  Business idea    → status 28611 (Business Idea)
  Research         → status 28609 (Research)
  Value decomp     → status 28610 (Value Decomp)
  In Progress      → status 3
  Closed           → status 6
  ```

- Board sub-query: `fixVersion in unreleasedVersions() OR fixVersion is EMPTY`.
- Board ranking is driven by `customfield_11582` (Rank). **This differs from Jira Cloud / older instances**, which often use `customfield_10374`. We must read `rankCustomFieldId` from the board config rather than hard-coding.

## Promoted-field IDs we discovered

These are defaults; `projects.metadata.promoted` overrides per project.

| Promoted column       | customfield id                                                 |
| --------------------- | -------------------------------------------------------------- |
| `story_points`        | `customfield_10372`                                            |
| `sprint`              | `customfield_10375`                                            |
| `epic_link`           | `customfield_10376`                                            |
| `epic_name`           | `customfield_10377`                                            |
| `rank` (canonical)    | `customfield_11582`                                            |
| `rank` (legacy)       | `customfield_10374` (`Rank (Obsolete)`)                        |
| `acceptance_criteria` | `customfield_31172` or `customfield_12074` (varies by project) |

There are **2,574 custom fields** instance-wide. They are NOT promoted; `issues.custom_fields` JSONB holds the long tail.

## Example: workflow on issue ALFAIAAS-4642 (Epic, status "In Progress")

`GET /rest/api/2/issue/ALFAIAAS-4642/transitions?expand=transitions.fields` returns:

```
id=31    name="In Progress"   to="In Progress"     fields=[]
id=51    name="Business Idea" to="Business Idea"   fields=[]
id=61    name="Research"      to="Research"        fields=[]
id=71    name="Value Decomp"  to="Value Decomp"    fields=[]
id=101   name="Closed"        to="Closed"          fields=[customfield_67470, customfield_67471, resolution]
```

Two important observations:

1. The Epic workflow lets you jump between most non-final states freely. That's not true for many other issue types — see below.
2. Going to **Closed** **requires** `resolution` plus two custom fields. The UI must prompt for these _before_ dispatching the transition; the worker must apply them in the same Jira REST call.

## Per-issue-type workflows (subset)

The full status list is large. Highlights of step-by-step workflows that motivate the **workflow-planner** feature (`14-workflow-engine.md`):

| Issue type           | Status set (typical path)                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Epic                 | Business Idea → Research → Value Decomp → In Progress → Closed                                                                                                                                           |
| Process task         | Sprint backlog → In Progress → REVIEW → Closed                                                                                                                                                           |
| Change task          | Sprint backlog → In Progress → REVIEW → Testing → Ready to Deploy → Closed                                                                                                                               |
| TechDebt / archDEBT  | Sprint backlog → In Progress → REVIEW → Testing → Ready to Deploy → Closed (+ TechLead control / Escalated / Cancel branches)                                                                            |
| Platform Devops Task | To Do → Scoring → SCORING BY COMPONENT LEAD → Scoring Approve → WAITING APPROVAL BY SECURITY → Testing → Stress Testing → Deploying to production → Ready To Production → Waiting Feedback (Live) → Done |
| Дефект промсреды     | New → Принят к исправлению → На исправление → К закрытию → Закрыт                                                                                                                                        |
| Discovery Task       | To Do → In Progress → Done (with Cancel / Hold branches)                                                                                                                                                 |

These chains are **not skippable**. A user clicking "Done" on a Process task from "Sprint backlog" cannot single-shot it; they must walk through "In Progress" → "REVIEW" → "Closed". Our UI hides this complexity behind the workflow planner.

## Bilingual content

- Status names, custom field names, and labels mix **English and Russian** freely (e.g. `"ОЧЕРЕДЬ НА РАЗРАБОТКУ"`, `"Поставка на контур нагрузочного тестирования [In Progress]"`).
- The UI must render arbitrary Unicode and not assume Latin-1.
- Search must be case- and accent-insensitive for both alphabets (Postgres `unaccent` extension recommended; collation `und-x-icu`).

## Description format

`ALFAIAAS-4642.fields.description` is **wiki-markup** on this instance, not ADF. Newer instances return ADF. The codebase handles both:

- Detect: if `expand=renderedFields` is requested, `renderedFields.description` returns HTML.
- Persist: we store the raw `description` (wiki or ADF) and a derived `description_text` (plain text for FTS).
- Render: TipTap extension renders wiki via a small parser (jira-to-tiptap), and ADF natively. On save, we round-trip back to the original format.

## Field naming notes

- `"name"` (Jira Server `userKey`) is the **stable identifier** for users in REST 2/2; `displayName` can change. We mirror both in `users` and join on `name`.
- `"accountId"` is present in newer instances but not always populated on Server 9.x. We rely on `name` as the canonical key.

## Implications for the spec

1. `boards.config.rankCustomFieldId` must come from the live board config, not a global constant.
2. `projects.metadata.customfieldMap` must be hydrated at first sync, before any kanban renders.
3. The transition cache (`workflow.ts: transitions`) must be populated _per issue type_, not just per project.
4. The issue editor must collect transition-required fields BEFORE dispatching the workflow plan.
5. i18n / Unicode is a hard requirement, including in saved-view names and labels.
6. Description format detection must be project-scoped (some projects on the same instance might be on ADF after migration).

## API-budget rule (see `15-performance.md`)

`/rest/agile/1.0` is slower than `/rest/api/2` on this instance (typical 2–5× latency on board endpoints). We use it **only**:

- Once per board on first sync: `GET /rest/agile/1.0/board/{id}/configuration` (no v2 equivalent).
- Once per board on first sync: `GET /rest/agile/1.0/board/{id}/sprint` (no v2 equivalent).
- For sprint bulk moves: `POST /rest/agile/1.0/sprint/{id}/issue`.

Steady-state reads (kanban renders, timeline renders, search) **never** hit the agile API. Sprint membership comes from the per-issue Sprint custom field (`customfield_10375` on this instance) returned by `/rest/api/2/search` with an explicit `fields=` list.
