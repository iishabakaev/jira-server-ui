import { createHash, randomUUID } from 'node:crypto'
import {
  comments,
  db,
  fieldSchemas,
  issues,
  issueTypes,
  outboxEvents,
  projects,
  statuses,
  transitions,
} from '@db'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { rankSequence } from '../../lib/rank'
import { appError } from '../../plugins/error'
import { getIssueByKeyOrId } from './queries'
import type {
  BatchRankBody,
  CommentCreateBody,
  CommentEditBody,
  IssuePatch,
  QuickCreateBody,
  RankBody,
  TransitionBody,
} from './schema'

// Транзакционный outbox — единственный путь мутации в Jira. Каждая HTTP-мутация
// здесь оборачивается в db.transaction, чтобы локальная запись и строка outbox
// были атомарно закоммичены в одной транзакции (см. docs/specs/05-sync-engine.md).
//
// Idempotency-ключ детерминированный: один и тот же патч в пределах 5-секундного
// окна не создаст дубль outbox-строки — клиент может повторно нажать кнопку
// без неконтролируемого дребезга в Jira.

const IDEMPOTENCY_WINDOW_MS = 5_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function bucket(now: number): number {
  return Math.floor(now / IDEMPOTENCY_WINDOW_MS)
}

function hash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value) ?? '')
    .digest('hex')
    .slice(0, 16)
}

async function findIssue(tx: typeof db, keyOrId: string) {
  const cond = UUID_RE.test(keyOrId) ? eq(issues.id, keyOrId) : eq(issues.key, keyOrId)
  const rows = await tx
    .select()
    .from(issues)
    .where(and(cond, isNull(issues.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

async function findIssueById(tx: typeof db, id: string) {
  const rows = await tx
    .select()
    .from(issues)
    .where(and(eq(issues.id, id), isNull(issues.deletedAt)))
    .limit(1)
  return rows[0] ?? null
}

interface PatchUpdate {
  summary?: string
  assigneeId?: string | null
  priorityId?: string | null
  labels?: string[]
  components?: string[]
  dueDate?: string | null
  startDate?: string | null
  storyPoints?: string | null
  sprintId?: string | null
  epicJiraId?: string | null
  parentJiraId?: string | null
  customFields?: Record<string, unknown>
}

function buildPatchUpdate(patch: IssuePatch): PatchUpdate {
  const update: PatchUpdate = {}
  if ('summary' in patch && patch.summary !== undefined) update.summary = patch.summary
  if ('assigneeId' in patch) update.assigneeId = patch.assigneeId ?? null
  if ('priorityId' in patch) update.priorityId = patch.priorityId ?? null
  if ('labels' in patch && patch.labels !== undefined) update.labels = patch.labels
  if ('components' in patch && patch.components !== undefined) update.components = patch.components
  if ('dueDate' in patch) update.dueDate = patch.dueDate ?? null
  if ('startDate' in patch) update.startDate = patch.startDate ?? null
  if ('storyPoints' in patch) {
    // numeric хранится строкой — иначе drizzle криво кастует precision.
    update.storyPoints = patch.storyPoints == null ? null : String(patch.storyPoints)
  }
  if ('sprintId' in patch) update.sprintId = patch.sprintId ?? null
  if ('epicKey' in patch) update.epicJiraId = patch.epicKey ?? null
  if ('parentKey' in patch) update.parentJiraId = patch.parentKey ?? null
  if (patch.customFields !== undefined) update.customFields = patch.customFields
  return update
}

// Минимальный ADF-документ для plain-text комментария. Сервер всегда хранит
// тело в ADF, чтобы worker отправлял в Jira без дополнительной конверсии.
function adfFromPlainText(text: string): { type: 'doc'; version: 1; content: unknown[] } {
  const paragraphs = text.split(/\n{2,}/).map((para) => ({
    type: 'paragraph',
    content: para.length === 0 ? [] : [{ type: 'text', text: para }],
  }))
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.length ? paragraphs : [{ type: 'paragraph', content: [] }],
  }
}

function commentBody(body: CommentCreateBody | CommentEditBody): unknown {
  if (body.body !== undefined) return body.body
  if (typeof body.text === 'string') return adfFromPlainText(body.text)
  throw appError('validation_failed', 'Comment requires text or body')
}

export const issuesMutations = {
  async patch(userId: string, keyOrId: string, patch: IssuePatch) {
    if (Object.keys(patch).length === 0) {
      throw appError('validation_failed', 'Empty patch')
    }
    const result = await db.transaction(async (tx) => {
      const current = await findIssue(tx as unknown as typeof db, keyOrId)
      if (!current) throw appError('not_found', 'Issue not found')

      const update = buildPatchUpdate(patch)
      await tx
        .update(issues)
        .set({
          ...update,
          syncState: 'pending',
          updatedAt: new Date(),
        })
        .where(eq(issues.id, current.id))

      const idem = `issue.update:${current.id}:${hash(patch)}:${bucket(Date.now())}`
      await tx
        .insert(outboxEvents)
        .values({
          idempotencyKey: idem,
          userId,
          kind: 'issue.update',
          targetKind: 'issue',
          targetId: current.id,
          payload: { keyOrId: current.key, patch },
        })
        .onConflictDoNothing({ target: outboxEvents.idempotencyKey })

      return current.id
    })

    const issue = await getIssueByKeyOrId(result)
    if (!issue) throw appError('internal', 'Issue vanished after update')
    return issue
  },

  async transition(userId: string, keyOrId: string, body: TransitionBody) {
    const result = await db.transaction(async (tx) => {
      const current = await findIssue(tx as unknown as typeof db, keyOrId)
      if (!current) throw appError('not_found', 'Issue not found')

      // Резолвим jira_transition_id из кеша transitions. Если кеш пуст —
      // отдаём 422; пользователь должен дождаться refresh-workflow.
      const trRows = await tx
        .select({
          jiraTransitionId: transitions.jiraTransitionId,
          name: transitions.name,
        })
        .from(transitions)
        .where(
          and(
            eq(transitions.issueTypeId, current.issueTypeId),
            eq(transitions.fromStatusId, current.statusId),
            eq(transitions.toStatusId, body.toStatusId),
          ),
        )
        .limit(1)
      const tr = trRows[0]
      if (!tr) {
        throw appError(
          'no_workflow_path',
          'No direct transition for this issue type. Use workflow planner for multi-hop.',
        )
      }

      await tx
        .update(issues)
        .set({
          statusId: body.toStatusId,
          syncState: 'pending',
          updatedAt: new Date(),
        })
        .where(eq(issues.id, current.id))

      const idem = `issue.transition:${current.id}:${tr.jiraTransitionId}:${bucket(Date.now())}`
      await tx
        .insert(outboxEvents)
        .values({
          idempotencyKey: idem,
          userId,
          kind: 'issue.transition',
          targetKind: 'issue',
          targetId: current.id,
          // toStatusId хранится в payload, чтобы activity-feed мог отрисовать
          // "moved to <Status>" без обращения к кешу transitions.
          payload: {
            keyOrId: current.key,
            jiraTransitionId: tr.jiraTransitionId,
            toStatusId: body.toStatusId,
            fields: body.fields ?? {},
          },
        })
        .onConflictDoNothing({ target: outboxEvents.idempotencyKey })

      return current.id
    })

    const issue = await getIssueByKeyOrId(result)
    if (!issue) throw appError('internal', 'Issue vanished after transition')
    return issue
  },

  async rank(userId: string, keyOrId: string, body: RankBody) {
    return this.batchRank(
      userId,
      {
        issueIds: [],
        beforeId: body.beforeId,
        afterId: body.afterId,
        // single-card версия: positional resolve выполняем внутри transaction
      },
      keyOrId,
    )
  },

  // Перевыдаёт ranks нескольким карточкам сразу. Все ранки выпускаются
  // последовательно между соседями (beforeId/afterId) и записываются в
  // одной транзакции вместе с outbox-строками.
  //
  // singleKeyOrId — для удобства /issues/:k/rank: вызываем batchRank с пустым
  // issueIds и передаём key/uuid отдельно, чтобы заранее не дублировать
  // route-handler.
  async batchRank(userId: string, body: BatchRankBody, singleKeyOrId?: string) {
    const result = await db.transaction(async (tx) => {
      // Резолвим список карточек: либо из body.issueIds, либо single через keyOrId.
      let ids: string[]
      if (singleKeyOrId) {
        const issue = await findIssue(tx as unknown as typeof db, singleKeyOrId)
        if (!issue) throw appError('not_found', 'Issue not found')
        ids = [issue.id]
      } else {
        ids = body.issueIds
        if (ids.length === 0) throw appError('validation_failed', 'issueIds is empty')
      }

      // Соседи определяют интервал rank-пространства. Получаем их ranks одним
      // SELECT — внутри транзакции достаточно: rank читаем для границ,
      // изменяем только идентификаторы в `ids`.
      const neighborIds = [body.beforeId, body.afterId].filter((x): x is string => !!x)
      const neighborRows = neighborIds.length
        ? await tx
            .select({ id: issues.id, rank: issues.orderingRank })
            .from(issues)
            .where(inArray(issues.id, neighborIds))
        : []
      const neighborMap = new Map(neighborRows.map((r) => [r.id, r.rank]))

      const prevRank = body.beforeId ? (neighborMap.get(body.beforeId) ?? null) : null
      const nextRank = body.afterId ? (neighborMap.get(body.afterId) ?? null) : null

      const newRanks = rankSequence(prevRank, nextRank, ids.length)

      const now = Date.now()
      for (let i = 0; i < ids.length; i += 1) {
        const issueId = ids[i]!
        const newRank = newRanks[i]!
        const updates: {
          orderingRank: string
          syncState: 'pending'
          updatedAt: Date
          statusId?: string
        } = {
          orderingRank: newRank,
          syncState: 'pending',
          updatedAt: new Date(),
        }
        if (body.toStatusId) updates.statusId = body.toStatusId
        await tx.update(issues).set(updates).where(eq(issues.id, issueId))

        const idem = `issue.rank:${issueId}:${hash({ rank: newRank, status: body.toStatusId })}:${bucket(now)}`
        await tx
          .insert(outboxEvents)
          .values({
            idempotencyKey: idem,
            userId,
            kind: body.toStatusId ? 'issue.rank-and-transition' : 'issue.rank',
            targetKind: 'issue',
            targetId: issueId,
            payload: {
              orderingRank: newRank,
              toStatusId: body.toStatusId ?? null,
            },
          })
          .onConflictDoNothing({ target: outboxEvents.idempotencyKey })
      }

      return ids
    })

    // Возвращаем актуальное состояние всех затронутых карточек.
    const rows = await db.select({ id: issues.id }).from(issues).where(inArray(issues.id, result))
    const summaries: import('./schema').IssueSummary[] = []
    for (const r of rows) {
      const s = await getIssueByKeyOrId(r.id)
      if (s) summaries.push(s)
    }
    return summaries
  },
}

// ─── M6: Comments & Quick-create ───
// Все эти мутации делают то же, что и patch/transition: пишут локальное
// зеркало и outbox-строку в одной транзакции. Worker позже отправит в Jira.

async function findCommentWithIssue(tx: typeof db, commentId: string) {
  const rows = await tx
    .select({
      id: comments.id,
      jiraId: comments.jiraId,
      issueId: comments.issueId,
      authorId: comments.authorId,
      issueKey: issues.key,
    })
    .from(comments)
    .innerJoin(issues, eq(issues.id, comments.issueId))
    .where(eq(comments.id, commentId))
    .limit(1)
  return rows[0] ?? null
}

export const commentsMutations = {
  async add(
    userId: string,
    jiraAccountId: string | null,
    keyOrId: string,
    body: CommentCreateBody,
  ) {
    const adfBody = commentBody(body)
    const result = await db.transaction(async (tx) => {
      const issue = await findIssue(tx as unknown as typeof db, keyOrId)
      if (!issue) throw appError('not_found', 'Issue not found')

      const now = new Date()
      const inserted = await tx
        .insert(comments)
        .values({
          issueId: issue.id,
          // Для локально созданных — пока null, проставит worker после Jira-ответа.
          jiraId: null,
          // В author_id Jira ожидает свой accountId; если у пользователя
          // ещё нет привязки — оставим uuid сессии, нормализуем в worker'е.
          authorId: jiraAccountId ?? userId,
          body: adfBody as never,
          createdAt: now,
          updatedAt: now,
          syncState: 'pending',
        })
        .returning({ id: comments.id })
      const commentId = inserted[0]!.id

      const idem = `comment.create:${commentId}:${userId}:${bucket(Date.now())}`
      await tx
        .insert(outboxEvents)
        .values({
          idempotencyKey: idem,
          userId,
          kind: 'comment.create',
          targetKind: 'comment',
          targetId: commentId,
          payload: { issueKey: issue.key, issueId: issue.id, body: adfBody },
        })
        .onConflictDoNothing({ target: outboxEvents.idempotencyKey })

      return commentId
    })

    return loadComment(result)
  },

  async edit(
    userId: string,
    jiraAccountId: string | null,
    commentId: string,
    body: CommentEditBody,
  ) {
    if (!UUID_RE.test(commentId)) throw appError('validation_failed', 'commentId is not a uuid')
    const adfBody = commentBody(body)
    const result = await db.transaction(async (tx) => {
      const current = await findCommentWithIssue(tx as unknown as typeof db, commentId)
      if (!current) throw appError('not_found', 'Comment not found')
      // BOLA-guard: только автор может редактировать свой комментарий. Сравниваем
      // и с Jira accountId (нормальный случай), и с локальным userId (fallback
      // для пользователей, ещё не привязавших PAT — мы пишем userId в author_id).
      const owns = current.authorId === jiraAccountId || current.authorId === userId
      if (!owns) throw appError('forbidden', "Cannot edit another author's comment")

      await tx
        .update(comments)
        .set({
          body: adfBody as never,
          updatedAt: new Date(),
          syncState: 'pending',
        })
        .where(eq(comments.id, commentId))

      const idem = `comment.update:${commentId}:${userId}:${hash(adfBody)}:${bucket(Date.now())}`
      await tx
        .insert(outboxEvents)
        .values({
          idempotencyKey: idem,
          userId,
          kind: 'comment.update',
          targetKind: 'comment',
          targetId: commentId,
          payload: {
            issueKey: current.issueKey,
            issueId: current.issueId,
            jiraCommentId: current.jiraId,
            body: adfBody,
          },
        })
        .onConflictDoNothing({ target: outboxEvents.idempotencyKey })

      return commentId
    })

    return loadComment(result)
  },

  async remove(userId: string, jiraAccountId: string | null, commentId: string) {
    if (!UUID_RE.test(commentId)) throw appError('validation_failed', 'commentId is not a uuid')
    await db.transaction(async (tx) => {
      const current = await findCommentWithIssue(tx as unknown as typeof db, commentId)
      if (!current) throw appError('not_found', 'Comment not found')
      const owns = current.authorId === jiraAccountId || current.authorId === userId
      if (!owns) throw appError('forbidden', "Cannot delete another author's comment")

      const idem = `comment.delete:${commentId}:${userId}:${bucket(Date.now())}`
      await tx
        .insert(outboxEvents)
        .values({
          idempotencyKey: idem,
          userId,
          kind: 'comment.delete',
          targetKind: 'comment',
          targetId: commentId,
          payload: {
            issueKey: current.issueKey,
            issueId: current.issueId,
            jiraCommentId: current.jiraId,
          },
        })
        .onConflictDoNothing({ target: outboxEvents.idempotencyKey })

      // Удаляем локально: если worker'у не удастся синхронизировать,
      // он переоткроет конфликт через conflicts-таблицу.
      await tx.delete(comments).where(eq(comments.id, commentId))
    })
    return { ok: true as const }
  },
}

async function loadComment(commentId: string) {
  const rows = await db
    .select({
      id: comments.id,
      jiraId: comments.jiraId,
      authorId: comments.authorId,
      body: comments.body,
      createdAt: comments.createdAt,
      updatedAt: comments.updatedAt,
      syncState: comments.syncState,
    })
    .from(comments)
    .where(eq(comments.id, commentId))
    .limit(1)
  const r = rows[0]
  if (!r) throw appError('internal', 'Comment vanished after write')
  return {
    id: r.id,
    jiraId: r.jiraId,
    authorId: r.authorId,
    body: r.body as unknown,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    syncState: r.syncState,
  }
}

export const quickCreateMutations = {
  // Создаёт черновик issue: пишет локальную строку с временным ключом
  // вида `DRAFT-<uuid>` и outbox-событием. Worker, получив Jira-ответ,
  // подменит `key` и `jira_id` на настоящие.
  async create(userId: string, body: QuickCreateBody) {
    // Проверим существование project/issueType до транзакции — выдадим 422
    // с понятным сообщением, а не нарушение FK на insert.
    const projectRows = await db
      .select({ id: projects.id, jiraId: projects.jiraId, key: projects.key })
      .from(projects)
      .where(eq(projects.id, body.projectId))
      .limit(1)
    const project = projectRows[0]
    if (!project) throw appError('validation_failed', 'Unknown projectId')

    const typeRows = await db
      .select({ id: issueTypes.id, name: issueTypes.name, subtask: issueTypes.subtask })
      .from(issueTypes)
      .where(eq(issueTypes.id, body.issueTypeId))
      .limit(1)
    const issueType = typeRows[0]
    if (!issueType) throw appError('validation_failed', 'Unknown issueTypeId')

    if (issueType.subtask && !body.parentKey) {
      throw appError('validation_failed', 'Subtask requires parentKey')
    }

    // (project, issueType) допустим только если для этой пары есть field_schemas
    // запись — её пишет refresh-metadata при первичном sync'е. Это и есть
    // наша «эта пара поддерживается этим проектом» проверка.
    const schemaRows = await db
      .select({ id: fieldSchemas.id })
      .from(fieldSchemas)
      .where(
        and(
          eq(fieldSchemas.projectId, body.projectId),
          eq(fieldSchemas.issueTypeId, body.issueTypeId),
        ),
      )
      .limit(1)
    if (!schemaRows[0]) {
      throw appError('validation_failed', 'issueType is not configured for project')
    }

    // parentKey и epicKey, если заданы, должны принадлежать тому же проекту;
    // иначе пользователь может косвенно «прикрепить» свой draft к чужому проекту.
    for (const refKey of [body.parentKey, body.epicKey]) {
      if (!refKey) continue
      const refRows = await db
        .select({ projectId: issues.projectId })
        .from(issues)
        .where(and(eq(issues.key, refKey), isNull(issues.deletedAt)))
        .limit(1)
      const ref = refRows[0]
      if (!ref) throw appError('validation_failed', `Referenced issue ${refKey} not found`)
      if (ref.projectId !== body.projectId) {
        throw appError('validation_failed', `Issue ${refKey} is not in the same project`)
      }
    }

    // Стартовый статус — `new`-категорийный, который реально встречается в кеше
    // транзишенов этого issue-type. Иначе можно выбрать статус из чужого
    // workflow, и worker получит 400 от Jira при createIssue.
    const newStatusRows = await db
      .selectDistinct({ id: statuses.id })
      .from(statuses)
      .innerJoin(transitions, eq(transitions.fromStatusId, statuses.id))
      .where(and(eq(statuses.category, 'new'), eq(transitions.issueTypeId, body.issueTypeId)))
      .limit(1)
    const newStatus = newStatusRows[0]
    if (!newStatus) {
      throw appError(
        'internal',
        'No "new"-category status found in transitions cache for this issueType — run refresh-workflow first',
      )
    }

    const draftId = randomUUID()
    const draftJiraId = `local:${draftId}`
    const draftKey = `${project.key}-DRAFT-${draftId.slice(0, 8)}`
    const now = new Date()

    const result = await db.transaction(async (tx) => {
      await tx.insert(issues).values({
        id: draftId,
        jiraId: draftJiraId,
        projectId: project.id,
        key: draftKey,
        summary: body.summary,
        issueTypeId: issueType.id,
        statusId: newStatus.id,
        priorityId: body.priorityId ?? null,
        assigneeId: body.assigneeId ?? null,
        reporterId: null,
        parentJiraId: body.parentKey ?? null,
        epicJiraId: body.epicKey ?? null,
        labels: body.labels ?? [],
        customFields: {},
        jiraUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
        syncState: 'pending',
      })

      const idem = `issue.create:${draftId}:${userId}:${bucket(Date.now())}`
      await tx
        .insert(outboxEvents)
        .values({
          idempotencyKey: idem,
          userId,
          kind: 'issue.create',
          targetKind: 'issue',
          targetId: draftId,
          payload: {
            draftKey,
            projectKey: project.key,
            issueTypeId: issueType.id,
            issueTypeName: issueType.name,
            summary: body.summary,
            parentKey: body.parentKey ?? null,
            epicKey: body.epicKey ?? null,
            assigneeId: body.assigneeId ?? null,
            priorityId: body.priorityId ?? null,
            labels: body.labels ?? [],
          },
        })
        .onConflictDoNothing({ target: outboxEvents.idempotencyKey })

      return draftId
    })

    const issue = await getIssueByKeyOrId(result)
    if (!issue) throw appError('internal', 'Draft issue vanished after create')
    return issue
  },
}

export type IssuesMutations = typeof issuesMutations
export type CommentsMutations = typeof commentsMutations
export type QuickCreateMutations = typeof quickCreateMutations

// Utility — нужна тестам и refresh-workflow, чтобы построить ответ
// /api/issues/:k/transitions без обращения к Jira: всё уже лежит в кеше.
export async function listAvailableTransitions(issueId: string) {
  const issue = await findIssueById(db, issueId)
  if (!issue) return null

  const rows = await db
    .select({
      toStatusId: transitions.toStatusId,
      jiraTransitionId: transitions.jiraTransitionId,
      name: transitions.name,
      requiredFields: transitions.requiredFields,
      toStatusName: statuses.name,
    })
    .from(transitions)
    .innerJoin(statuses, eq(statuses.id, transitions.toStatusId))
    .where(
      and(
        eq(transitions.issueTypeId, issue.issueTypeId),
        eq(transitions.fromStatusId, issue.statusId),
      ),
    )

  return {
    fromStatusId: issue.statusId,
    options: rows.map((r) => ({
      toStatusId: r.toStatusId,
      toStatusName: r.toStatusName,
      jiraTransitionId: r.jiraTransitionId,
      name: r.name,
      requiredFields: r.requiredFields.map((f) => ({
        field: f.field,
        name: f.name,
        required: f.required,
        schemaType: f.schemaType,
      })),
    })),
  }
}

// Не используется напрямую в роуте, но экспортируем для тестов.
export const __test = {
  bucket,
  hash,
  IDEMPOTENCY_WINDOW_MS,
  adfFromPlainText,
  commentBody,
}
