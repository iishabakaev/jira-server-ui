import {
  db,
  projects,
  issueTypes,
  statuses,
  priorities,
  resolutions,
  linkTypes,
  boards,
  sprints,
  type ProjectMetadata,
} from '@db'
import { eq, sql } from 'drizzle-orm'
import { createJiraClient } from '@jira/client'
import type {
  JiraField,
  JiraProject,
  JiraIssueType,
  JiraStatus,
  JiraPriority,
  JiraResolution,
  JiraLinkType,
  JiraBoard,
  JiraSprint,
} from '@jira/client'
import type { Queue, TaskCtx } from '../lib/queue'
import { pickAnyBearer } from '../lib/credentials'
import { acquireAndRun } from '../lib/rate-limit'
import { env } from '../env'

// Обновление справочников: projects, issueTypes, statuses, priorities,
// resolutions, linkTypes, fields и customfield-map. Запускается админ-роутом
// (POST /api/sync/projects/:id/full-sync прежде всего) и по расписанию
// (раз в час) — чтобы локальная картина не отставала от Jira.
//
// Контракт payload — опциональный `projectId` для точечного refresh; без
// него обновляем глобальные таблицы и пересобираем карту проектов.

export interface RefreshMetadataPayload {
  projectId?: string
}

// Эвристика: распознаём промотированные поля по имени, чтобы заполнить
// projects.metadata.promoted после первого refresh без ручной конфигурации.
function detectPromoted(fields: JiraField[]): ProjectMetadata['promoted'] {
  const byName = (needle: RegExp): string | undefined => {
    const f = fields.find((x) => x.custom && needle.test(x.name))
    return f?.id
  }
  return {
    rank: byName(/^Rank$/i),
    storyPoints: byName(/^Story Points$/i),
    sprint: byName(/^Sprint$/i),
    epicLink: byName(/^Epic Link$/i),
    epicName: byName(/^Epic Name$/i),
    acceptanceCriteria: byName(/Acceptance Criteria/i),
  }
}

function customfieldMap(fields: JiraField[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const f of fields) if (f.custom) map[f.id] = f.name
  return map
}

async function upsertProjects(rows: JiraProject[]) {
  for (const p of rows) {
    await db
      .insert(projects)
      .values({
        jiraId: p.id,
        key: p.key,
        name: p.name,
        projectTypeKey: p.projectTypeKey,
        leadAccountId: p.lead?.accountId ?? p.lead?.name ?? null,
        metadata: { customfieldMap: {}, promoted: {} } satisfies ProjectMetadata,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: projects.jiraId,
        set: {
          key: p.key,
          name: p.name,
          projectTypeKey: p.projectTypeKey,
          leadAccountId: p.lead?.accountId ?? p.lead?.name ?? null,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
  }
}

async function upsertIssueTypes(rows: JiraIssueType[]) {
  for (const it of rows) {
    await db
      .insert(issueTypes)
      .values({
        jiraId: it.id,
        name: it.name,
        iconUrl: it.iconUrl,
        subtask: it.subtask ?? false,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: issueTypes.jiraId,
        set: {
          name: it.name,
          iconUrl: it.iconUrl,
          subtask: it.subtask ?? false,
          syncedAt: new Date(),
        },
      })
  }
}

async function upsertStatuses(rows: JiraStatus[]) {
  for (const s of rows) {
    await db
      .insert(statuses)
      .values({
        jiraId: s.id,
        name: s.name,
        category: s.statusCategory.key,
        colorName: s.statusCategory.colorName,
        description: s.description,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: statuses.jiraId,
        set: {
          name: s.name,
          category: s.statusCategory.key,
          colorName: s.statusCategory.colorName,
          description: s.description,
          syncedAt: new Date(),
        },
      })
  }
}

async function upsertPriorities(rows: JiraPriority[]) {
  for (const p of rows) {
    await db
      .insert(priorities)
      .values({
        jiraId: p.id,
        name: p.name,
        iconUrl: p.iconUrl,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: priorities.jiraId,
        set: { name: p.name, iconUrl: p.iconUrl, syncedAt: new Date() },
      })
  }
}

async function upsertResolutions(rows: JiraResolution[]) {
  for (const r of rows) {
    await db
      .insert(resolutions)
      .values({
        jiraId: r.id,
        name: r.name,
        description: r.description,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: resolutions.jiraId,
        set: { name: r.name, description: r.description, syncedAt: new Date() },
      })
  }
}

async function upsertLinkTypes(rows: JiraLinkType[]) {
  for (const l of rows) {
    await db
      .insert(linkTypes)
      .values({
        jiraId: l.id,
        name: l.name,
        inward: l.inward,
        outward: l.outward,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: linkTypes.jiraId,
        set: {
          name: l.name,
          inward: l.inward,
          outward: l.outward,
          syncedAt: new Date(),
        },
      })
  }
}

async function upsertBoardsForProject(
  projectKeyOrId: string,
  projectUuid: string,
  jiraBoards: JiraBoard[],
) {
  for (const b of jiraBoards) {
    await db
      .insert(boards)
      .values({
        jiraId: b.id,
        name: b.name,
        type: b.type,
        projectId: projectUuid,
        config: { columns: [] },
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: boards.jiraId,
        set: {
          name: b.name,
          type: b.type,
          projectId: projectUuid,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
  }
}

async function upsertSprintsForBoard(boardUuid: string, jiraSprints: JiraSprint[]) {
  for (const s of jiraSprints) {
    await db
      .insert(sprints)
      .values({
        jiraId: s.id,
        name: s.name,
        state: s.state,
        startDate: s.startDate ? new Date(s.startDate) : null,
        endDate: s.endDate ? new Date(s.endDate) : null,
        completeDate: s.completeDate ? new Date(s.completeDate) : null,
        goal: s.goal,
        boardId: boardUuid,
        syncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: sprints.jiraId,
        set: {
          name: s.name,
          state: s.state,
          startDate: s.startDate ? new Date(s.startDate) : null,
          endDate: s.endDate ? new Date(s.endDate) : null,
          completeDate: s.completeDate ? new Date(s.completeDate) : null,
          goal: s.goal,
          boardId: boardUuid,
          syncedAt: new Date(),
          updatedAt: new Date(),
        },
      })
  }
}

async function refreshGlobalCatalogs(ctx: TaskCtx<RefreshMetadataPayload>) {
  const creds = await pickAnyBearer()
  if (!creds) {
    ctx.log('refresh-metadata.no-credentials')
    return
  }
  if (!env.JIRA_BASE_URL) {
    ctx.log('refresh-metadata.no-jira-base-url')
    return
  }
  const jira = createJiraClient({
    baseUrl: env.JIRA_BASE_URL,
    bearer: creds.bearer,
    timeoutMs: 30_000,
  })

  await acquireAndRun({ userId: creds.userId, instance: env.JIRA_BASE_URL }, async () => {
    const [prjs, its, sts, prs, rss, lts, flds] = await Promise.all([
      jira.getProjects(),
      jira.getIssueTypes(),
      jira.getStatuses(),
      jira.getPriorities(),
      jira.getResolutions(),
      jira.getLinkTypes(),
      jira.getFields(),
    ])
    await upsertProjects(prjs)
    await upsertIssueTypes(its)
    await upsertStatuses(sts)
    await upsertPriorities(prs)
    await upsertResolutions(rss)
    await upsertLinkTypes(lts.issueLinkTypes ?? [])

    // Прокидываем customfieldMap и promoted в каждый проект, сохраняя
    // per-project оверрайды (defaultBoardId, syncWindowDays, fieldVisibility,
    // а также уже настроенный promoted/customfieldMap, если он был сильнее).
    // Раньше единый UPDATE без WHERE затирал каждую запись общим значением —
    // это удаляло настройки конкретных проектов (architect+security review).
    const promoted = detectPromoted(flds)
    const map = customfieldMap(flds)
    for (const p of prjs) {
      await db
        .update(projects)
        .set({
          metadata: sql`jsonb_build_object(
            'customfieldMap', ${JSON.stringify(map)}::jsonb,
            'promoted',
              coalesce(nullif(${projects.metadata}->'promoted', '{}'::jsonb),
                       ${JSON.stringify(promoted)}::jsonb),
            'defaultBoardId', ${projects.metadata}->'defaultBoardId',
            'syncWindowDays', ${projects.metadata}->'syncWindowDays',
            'fieldVisibility', ${projects.metadata}->'fieldVisibility'
          )`,
          syncedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(projects.jiraId, p.id))
    }

    ctx.log('refresh-metadata.global', {
      projects: prjs.length,
      issueTypes: its.length,
      statuses: sts.length,
      priorities: prs.length,
      resolutions: rss.length,
      linkTypes: lts.issueLinkTypes?.length ?? 0,
      fields: flds.length,
    })
  })
}

async function refreshOneProject(projectUuid: string, ctx: TaskCtx<RefreshMetadataPayload>) {
  const creds = await pickAnyBearer()
  if (!creds || !env.JIRA_BASE_URL) return
  const prjRows = await db
    .select({ key: projects.key })
    .from(projects)
    .where(eq(projects.id, projectUuid))
    .limit(1)
  const prj = prjRows[0]
  if (!prj) return
  const jira = createJiraClient({
    baseUrl: env.JIRA_BASE_URL,
    bearer: creds.bearer,
    timeoutMs: 30_000,
  })

  await acquireAndRun({ userId: creds.userId, instance: env.JIRA_BASE_URL }, async () => {
    const boardsResp = await jira.getBoardsByProject(prj.key)
    await upsertBoardsForProject(prj.key, projectUuid, boardsResp.values ?? [])

    // Спринты — постранично, ограничение 50 на страницу.
    for (const b of boardsResp.values ?? []) {
      if (b.type !== 'scrum') continue
      const boardRow = (
        await db
          .select({ id: boards.id })
          .from(boards)
          .where(eq(boards.jiraId, b.id))
          .limit(1)
      )[0]
      if (!boardRow) continue
      let startAt = 0
      // safety-нор: не пагинируем бесконечно — 1000 спринтов на борд более чем достаточно.
      for (let page = 0; page < 20; page += 1) {
        const sp = await jira.getSprintsForBoard(b.id, { startAt, maxResults: 50 })
        await upsertSprintsForBoard(boardRow.id, sp.values ?? [])
        if (sp.isLast || !sp.values || sp.values.length < 50) break
        startAt += sp.values.length
      }
    }
    ctx.log('refresh-metadata.project', { project: prj.key, boards: boardsResp.values?.length ?? 0 })
  })
}

export function registerRefreshMetadata(queue: Queue) {
  queue.defineTask<RefreshMetadataPayload>(
    'refresh-metadata',
    async (ctx: TaskCtx<RefreshMetadataPayload>) => {
      // Глобальные справочники обновляем всегда — они общие для всех проектов.
      await refreshGlobalCatalogs(ctx)
      // Если задан конкретный projectId, дополнительно тянем agile-конфиг
      // (борды + спринты).
      if (ctx.data.projectId) {
        await refreshOneProject(ctx.data.projectId, ctx)
      }
    },
  )
}
