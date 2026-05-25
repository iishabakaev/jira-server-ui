// Минимальный REST-клиент Jira. Тонкая обёртка над fetch с инъекцией
// Authorization: Bearer <PAT>. Эндпоинты добавляются по мере подключения
// сценариев — sync, write-back, workflow planner.

export interface JiraClientOptions {
  baseUrl: string
  bearer: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export class JiraHttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    public body: unknown,
  ) {
    super(`Jira ${status} ${statusText}${formatJiraErrorBody(body)}`)
    this.name = 'JiraHttpError'
  }
}

function formatJiraErrorBody(body: unknown): string {
  if (!body) return ''
  if (typeof body === 'string') return ` :: ${body.slice(0, 500)}`
  if (typeof body === 'object') {
    const obj = body as { errorMessages?: unknown; errors?: unknown }
    const msgs = Array.isArray(obj.errorMessages) ? obj.errorMessages.join('; ') : ''
    const fieldErrs =
      obj.errors && typeof obj.errors === 'object'
        ? Object.entries(obj.errors as Record<string, unknown>)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join('; ')
        : ''
    const joined = [msgs, fieldErrs].filter(Boolean).join(' | ')
    if (joined) return ` :: ${joined.slice(0, 500)}`
    try {
      return ` :: ${JSON.stringify(body).slice(0, 500)}`
    } catch {
      return ''
    }
  }
  return ''
}

// JQL accepts only "yyyy-MM-dd HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd",
// or relative periods like "-5d". ISO-8601 ("2026-05-09T16:08:00.000Z")
// is rejected with HTTP 400. Helper formats a JS Date to the minute-precision
// form Jira accepts. Dates are interpreted in the Jira server's timezone, so
// callers should pass UTC dates and accept some overlap from TZ skew — the
// upsert path is idempotent and tolerates duplicates.
export function formatJqlDate(d: Date): string {
  // Use UTC components — slightly conservative (overshoots window in some TZs)
  // but never invalid. The sync loop dedupes via out-of-order check.
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0')
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const dd = d.getUTCDate().toString().padStart(2, '0')
  const hh = d.getUTCHours().toString().padStart(2, '0')
  const mi = d.getUTCMinutes().toString().padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

// ─── Типы ответов /rest/api/2 ───────────────────────────────────────────────
// Описаны до уровня, который читается sync-нормализатором; всё, что нам
// неинтересно, оставляем как `unknown` — Jira возвращает много шума.

export interface JiraProject {
  id: string
  key: string
  name: string
  projectTypeKey?: string
  lead?: { accountId?: string; name?: string; key?: string }
}

export interface JiraIssueType {
  id: string
  name: string
  iconUrl?: string
  subtask?: boolean
  description?: string
}

export interface JiraStatusCategory {
  id?: number
  key: string
  name: string
  colorName?: string
}

export interface JiraStatus {
  id: string
  name: string
  description?: string
  iconUrl?: string
  statusCategory: JiraStatusCategory
}

export interface JiraPriority {
  id: string
  name: string
  iconUrl?: string
}

export interface JiraResolution {
  id: string
  name: string
  description?: string
}

export interface JiraLinkType {
  id: string
  name: string
  inward: string
  outward: string
}

export interface JiraField {
  id: string
  name: string
  custom: boolean
  schema?: {
    type: string
    items?: string
    custom?: string
    customId?: number
    system?: string
  }
}

export interface JiraTransition {
  id: string
  name: string
  to: { id: string; name: string }
  fields?: Record<
    string,
    {
      required: boolean
      name: string
      schema: { type: string; items?: string; custom?: string; system?: string }
      allowedValues?: Array<{ id: string; value?: string; name?: string }>
    }
  >
}

export interface JiraSearchResult {
  startAt: number
  maxResults: number
  total: number
  issues: JiraIssueRaw[]
}

export type JiraIssueRaw = {
  id: string
  key: string
  fields: Record<string, unknown>
  names?: Record<string, string>
  changelog?: unknown
}

export interface JiraBoard {
  id: number
  name: string
  type: string
  location?: { projectId?: number; projectKey?: string }
}

export interface JiraBoardConfiguration {
  id: number
  name: string
  type: string
  filter: { id: string }
  subQuery?: { query: string }
  columnConfig: {
    columns: Array<{ name: string; statuses: Array<{ id: string }> }>
    constraintType?: string
  }
  ranking?: { rankCustomFieldId: number }
}

export interface JiraSprint {
  id: number
  name: string
  state: string
  startDate?: string
  endDate?: string
  completeDate?: string
  goal?: string
  originBoardId?: number
}

export function createJiraClient(opts: JiraClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const doFetch = opts.fetchImpl ?? fetch

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${base}${path.startsWith('/') ? path : `/${path}`}`
    const headers = new Headers(init?.headers)
    headers.set('Authorization', `Bearer ${opts.bearer}`)
    headers.set('Accept', 'application/json')
    if (init?.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }
    const controller = new AbortController()
    const timer = opts.timeoutMs ? setTimeout(() => controller.abort(), opts.timeoutMs) : null
    try {
      const res = await doFetch(url, { ...init, headers, signal: controller.signal })
      const text = await res.text()
      const body: unknown = text ? safeJson(text) : null
      if (!res.ok) throw new JiraHttpError(res.status, res.statusText, body)
      return body as T
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return {
    // ─── Сервисные ──────────────────────────────────────────────────────────
    myself: () =>
      call<{
        name: string
        key: string
        emailAddress?: string
        displayName: string
        accountId?: string
      }>('/rest/api/2/myself'),

    // ─── Метаданные (refresh-metadata) ─────────────────────────────────────
    // Один список значений; пагинация не нужна — все эти эндпоинты возвращают
    // полные коллекции, обычно в пределах сотен записей.
    getProjects: () => call<JiraProject[]>('/rest/api/2/project'),
    getIssueTypes: () => call<JiraIssueType[]>('/rest/api/2/issuetype'),
    getStatuses: () => call<JiraStatus[]>('/rest/api/2/status'),
    getPriorities: () => call<JiraPriority[]>('/rest/api/2/priority'),
    getResolutions: () => call<JiraResolution[]>('/rest/api/2/resolution'),
    getLinkTypes: () => call<{ issueLinkTypes: JiraLinkType[] }>('/rest/api/2/issueLinkType'),
    getFields: () => call<JiraField[]>('/rest/api/2/field'),

    // ─── Issues ─────────────────────────────────────────────────────────────
    getIssue: (keyOrId: string, params?: { fields?: string; expand?: string }) => {
      const q = new URLSearchParams()
      if (params?.fields) q.set('fields', params.fields)
      if (params?.expand) q.set('expand', params.expand)
      const suffix = q.size ? `?${q.toString()}` : ''
      return call<JiraIssueRaw>(`/rest/api/2/issue/${encodeURIComponent(keyOrId)}${suffix}`)
    },
    search: (
      jql: string,
      params: {
        fields?: string
        startAt?: number
        maxResults?: number
        expand?: string
      } = {},
    ) => {
      const q = new URLSearchParams({ jql })
      if (params.fields) q.set('fields', params.fields)
      if (params.expand) q.set('expand', params.expand)
      q.set('startAt', String(params.startAt ?? 0))
      q.set('maxResults', String(params.maxResults ?? 100))
      return call<JiraSearchResult>(`/rest/api/2/search?${q.toString()}`)
    },

    // ─── Мутации (push-outbox) ──────────────────────────────────────────────
    updateIssue: (keyOrId: string, fields: Record<string, unknown>) =>
      call<unknown>(`/rest/api/2/issue/${encodeURIComponent(keyOrId)}`, {
        method: 'PUT',
        body: JSON.stringify({ fields }),
      }),
    // POST /issue возвращает { id, key, self } — нам нужны id и key, чтобы
    // подменить локальные DRAFT-плейсхолдеры на реальные значения.
    createIssue: (body: { fields: Record<string, unknown> }) =>
      call<{ id: string; key: string; self?: string }>('/rest/api/2/issue', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    // POST /issue/:key/comment. Тело передаём как ADF JSON через `body`,
    // Jira Server / DC принимает строку или wiki-markup — но для DC8+ ADF
    // приходит через REST v3; на v2 безопасный путь — markdown/plain string.
    // Worker'у на вход даём raw-объект `body`, а здесь сериализуем как text.
    addComment: (keyOrIssueId: string, args: { body: string }) =>
      call<{ id: string; body?: unknown }>(
        `/rest/api/2/issue/${encodeURIComponent(keyOrIssueId)}/comment`,
        { method: 'POST', body: JSON.stringify({ body: args.body }) },
      ),
    updateComment: (keyOrIssueId: string, commentId: string, args: { body: string }) =>
      call<{ id: string }>(
        `/rest/api/2/issue/${encodeURIComponent(keyOrIssueId)}/comment/${encodeURIComponent(commentId)}`,
        { method: 'PUT', body: JSON.stringify({ body: args.body }) },
      ),
    deleteComment: (keyOrIssueId: string, commentId: string) =>
      call<unknown>(
        `/rest/api/2/issue/${encodeURIComponent(keyOrIssueId)}/comment/${encodeURIComponent(commentId)}`,
        { method: 'DELETE' },
      ),
    getTransitions: (keyOrId: string) =>
      call<{ transitions: JiraTransition[] }>(
        `/rest/api/2/issue/${encodeURIComponent(keyOrId)}/transitions?expand=transitions.fields`,
      ),
    transitionIssue: (
      keyOrId: string,
      args: { transitionId: string; fields?: Record<string, unknown>; comment?: string },
    ) =>
      call<unknown>(`/rest/api/2/issue/${encodeURIComponent(keyOrId)}/transitions`, {
        method: 'POST',
        body: JSON.stringify({
          transition: { id: args.transitionId },
          fields: args.fields,
          ...(args.comment ? { update: { comment: [{ add: { body: args.comment } }] } } : {}),
        }),
      }),

    // ─── Agile API (только при первичной синхронизации) ─────────────────────
    // /rest/agile/1.0 используется ИСКЛЮЧИТЕЛЬНО для board-config, sprint-list
    // и rank-операций. На горячих путях запрещён — см. docs/specs/13-jira-reality.md.
    getBoardsByProject: (projectKeyOrId: string) =>
      call<{ values: JiraBoard[]; isLast?: boolean }>(
        `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(projectKeyOrId)}`,
      ),
    getBoardConfiguration: (boardId: number) =>
      call<JiraBoardConfiguration>(`/rest/agile/1.0/board/${boardId}/configuration`),
    getSprintsForBoard: (
      boardId: number,
      params: { startAt?: number; maxResults?: number; state?: string } = {},
    ) => {
      const q = new URLSearchParams()
      q.set('startAt', String(params.startAt ?? 0))
      q.set('maxResults', String(params.maxResults ?? 50))
      if (params.state) q.set('state', params.state)
      return call<{ values: JiraSprint[]; isLast?: boolean }>(
        `/rest/agile/1.0/board/${boardId}/sprint?${q.toString()}`,
      )
    },
    rankIssues: (args: {
      issues: string[]
      rankBeforeIssue?: string
      rankAfterIssue?: string
      rankCustomFieldId?: number
    }) =>
      call<unknown>('/rest/agile/1.0/issue/rank', {
        method: 'PUT',
        body: JSON.stringify(args),
      }),
  }
}

export type JiraClient = ReturnType<typeof createJiraClient>

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
