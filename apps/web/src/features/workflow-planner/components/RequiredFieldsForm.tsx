import { cn } from '@ui/index'
import type { TransitionFieldReq } from '../types'

// Форма обязательных полей для одного шага транзишена. Поддерживает три
// варианта рендера: option-select (если есть allowedValues), number (для
// schemaType === 'number') и text (по умолчанию). Расширим под Atlassian
// schema-варианты по мере появления реальных данных в metadata.

function fieldLabel(f: TransitionFieldReq): string {
  const star = f.required ? ' *' : ''
  return `${f.name}${star}`
}

function inputId(stepSeq: number, fieldKey: string): string {
  return `wf-step-${stepSeq}-${fieldKey}`
}

export interface RequiredFieldsFormProps {
  stepSeq: number
  fields: TransitionFieldReq[]
  values: Record<string, unknown>
  onChange: (next: Record<string, unknown>) => void
  disabled?: boolean
}

export function RequiredFieldsForm({
  stepSeq,
  fields,
  values,
  onChange,
  disabled,
}: RequiredFieldsFormProps) {
  if (fields.length === 0) return null

  const update = (key: string, value: unknown) => onChange({ ...values, [key]: value })

  return (
    <div className="flex flex-col gap-2">
      {fields.map((f) => {
        const id = inputId(stepSeq, f.field)
        const current = values[f.field]

        if (f.allowedValues && f.allowedValues.length > 0) {
          return (
            <div key={f.field} className="grid grid-cols-[120px_1fr] items-center gap-2">
              <label htmlFor={id} className="text-xs text-muted-foreground">
                {fieldLabel(f)}
              </label>
              <select
                id={id}
                disabled={disabled}
                value={typeof current === 'string' ? current : ''}
                onChange={(e) => update(f.field, e.target.value || null)}
                className={cn(
                  'h-8 rounded border border-border bg-background px-2 text-sm',
                  disabled && 'opacity-50',
                )}
              >
                <option value="">— select —</option>
                {f.allowedValues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name ?? v.value ?? v.id}
                  </option>
                ))}
              </select>
            </div>
          )
        }

        if (f.schemaType === 'number') {
          return (
            <div key={f.field} className="grid grid-cols-[120px_1fr] items-center gap-2">
              <label htmlFor={id} className="text-xs text-muted-foreground">
                {fieldLabel(f)}
              </label>
              <input
                id={id}
                type="number"
                disabled={disabled}
                value={typeof current === 'number' ? current : ''}
                onChange={(e) => {
                  const raw = e.target.value
                  update(f.field, raw === '' ? null : Number(raw))
                }}
                className={cn(
                  'h-8 rounded border border-border bg-background px-2 text-sm',
                  disabled && 'opacity-50',
                )}
              />
            </div>
          )
        }

        return (
          <div key={f.field} className="grid grid-cols-[120px_1fr] items-start gap-2">
            <label htmlFor={id} className="pt-1 text-xs text-muted-foreground">
              {fieldLabel(f)}
            </label>
            <textarea
              id={id}
              disabled={disabled}
              value={typeof current === 'string' ? current : ''}
              onChange={(e) => update(f.field, e.target.value)}
              rows={2}
              className={cn(
                'w-full resize-y rounded border border-border bg-background px-2 py-1 text-sm',
                disabled && 'opacity-50',
              )}
            />
          </div>
        )
      })}
    </div>
  )
}
