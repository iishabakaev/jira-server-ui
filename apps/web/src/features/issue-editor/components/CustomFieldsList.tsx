import type { FieldDef, IssueFieldSchema } from '../types'

// Read-only рендер custom-field'ов из field_schemas-кеша. M6 MVP:
// показываем значения, которые refresh-metadata уже синхронизировал.
// Редактирование — в следующей итерации (зависит от editor-схем Jira:
// option/multi-select/user-picker нуждаются в собственных UI-контролах).

export interface CustomFieldsListProps {
  schema: IssueFieldSchema | null
  values: Record<string, unknown>
}

// Только custom-field'ы (`customfield_*`), помеченные для editor-поверхности.
// system-поля (assignee, priority, etc.) уже рендерятся в PropertiesGrid —
// дублировать их здесь не нужно.
function isEditorCustomField(def: FieldDef): boolean {
  if (def.hidden) return false
  if (!def.key.startsWith('customfield_')) return false
  // Если surface не задан — для совместимости считаем, что поле editor'ное.
  // refresh-metadata будущих версий выставит явный surface; до тех пор
  // отсутствие списка лучше трактовать как "показать", чем как "скрыть".
  if (def.surface && !def.surface.includes('editor')) return false
  return true
}

function sortByOrder(a: FieldDef, b: FieldDef): number {
  const oa = a.order ?? Number.POSITIVE_INFINITY
  const ob = b.order ?? Number.POSITIVE_INFINITY
  if (oa !== ob) return oa - ob
  // Фиксируем locale 'en', чтобы результат сортировки не плыл между
  // окружениями (Node intl vs браузер); финальный tiebreaker — key,
  // он у custom-field'ов уникален.
  const byName = a.name.localeCompare(b.name, 'en')
  if (byName !== 0) return byName
  return a.key.localeCompare(b.key, 'en')
}

// Лимит для fallback-JSON: не даём пользователю случайно отрисовать
// мегабайт payload'а — компонента всё равно read-only, превью достаточно.
const JSON_FALLBACK_LIMIT = 4096

function jsonFallback(raw: unknown): string {
  const s = JSON.stringify(raw)
  if (s === undefined) return ''
  return s.length > JSON_FALLBACK_LIMIT ? `${s.slice(0, JSON_FALLBACK_LIMIT)}… [truncated]` : s
}

// Распознаём ADF-документ ({type:'doc', version, content[]}) до общего
// object-бренча — иначе пользователь видел бы сырой JSON вместо контента.
// MVP читает только plain-text узлы; полноценный рендер делегируем
// DescriptionView в будущей итерации.
function adfPlainText(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  if (obj.type !== 'doc' || !Array.isArray(obj.content)) return null
  const parts: string[] = []
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (typeof n.text === 'string') parts.push(n.text)
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(raw)
  return parts.join(' ').trim() || null
}

// Базовый renderer значения по schema.type. Покрывает большинство случаев
// Jira-полей; неизвестные типы рисуем как JSON-строку — лучше показать
// сырой payload, чем подавить поле молча.
function renderValue(def: FieldDef, raw: unknown): React.ReactNode {
  if (raw === null || raw === undefined) {
    return <em className="text-muted-foreground">—</em>
  }

  const t = def.schema.type
  // ADF-документ (multi-line text custom-field) — отдельная ветка ДО общего
  // object-fallback'а, иначе пользователь видел бы сырой JSON.
  const adfText = adfPlainText(raw)
  if (adfText !== null) return adfText

  // option/user/version приходят как объекты со стандартным shape.
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    const label = obj.displayName ?? obj.name ?? obj.value ?? obj.key ?? obj.id
    if (typeof label === 'string' || typeof label === 'number') {
      return String(label)
    }
    return <code className="text-xs">{jsonFallback(raw)}</code>
  }

  if (Array.isArray(raw)) {
    if (raw.length === 0) return <em className="text-muted-foreground">—</em>
    const parts = raw.map((item, i) => {
      if (typeof item === 'string' || typeof item === 'number') return String(item)
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>
        const label = obj.displayName ?? obj.name ?? obj.value ?? obj.key ?? obj.id
        if (typeof label === 'string' || typeof label === 'number') return String(label)
      }
      // Стабильный fallback — индекс, потому что внутри payload нет своего id.
      return `#${i}`
    })
    return parts.join(', ')
  }

  if ((t === 'date' || t === 'datetime') && typeof raw === 'string') {
    // ISO-строка от Jira; date-only выводим без времени. Если parse падает —
    // возвращаем raw, чтобы не показать "Invalid Date" вместо данных.
    const ts = Date.parse(raw)
    if (!Number.isFinite(ts)) return raw
    return t === 'date' ? raw.slice(0, 10) : new Date(ts).toLocaleString()
  }

  if (typeof raw === 'boolean') return raw ? 'Yes' : 'No'
  if (typeof raw === 'number') return String(raw)
  if (typeof raw === 'string') return raw

  return <code className="text-xs">{jsonFallback(raw)}</code>
}

export function CustomFieldsList({ schema, values }: CustomFieldsListProps) {
  if (!schema) return null
  const editorFields = schema.fields.filter(isEditorCustomField).slice().sort(sortByOrder)
  if (editorFields.length === 0) return null

  return (
    <section aria-label="Custom fields" className="flex flex-col gap-3">
      <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Custom fields
      </h4>
      <dl className="flex flex-col gap-1 text-sm">
        {editorFields.map((def) => (
          <div key={def.key} className="grid grid-cols-[160px_1fr] items-start gap-x-3 gap-y-1">
            <dt className="pt-0.5 text-xs uppercase tracking-wide text-muted-foreground">
              {def.name}
              {def.required ? <span className="ml-0.5 text-destructive">*</span> : null}
            </dt>
            <dd className="min-w-0 break-words">{renderValue(def, values[def.key])}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
