import { cn } from '@ui/index'
import { ChevronDown, Zap } from 'lucide-react'
import type { ReactNode } from 'react'

// Swimlane — заголовок группы + rollup-полоска + слот для columns.
// Используется когда groupBy != 'status': заголовок — это эпик / assignee /
// priority. При groupBy='status' swimlane не рендерится, колонки идут плоско.

export interface SwimlaneRollupBucket {
  color: string
  value: number
  label: string
}

export interface SwimlaneProps {
  title: string
  keyLabel?: string | null
  hue?: number
  count: number
  doneCount: number
  doneTarget: number
  collapsed: boolean
  onToggle(): void
  rollup?: SwimlaneRollupBucket[]
  children: ReactNode
}

export function Swimlane({
  title,
  keyLabel,
  hue = 220,
  count: _count,
  doneCount,
  doneTarget,
  collapsed,
  onToggle,
  rollup,
  children,
}: SwimlaneProps) {
  const pct = Math.round((doneCount / Math.max(doneTarget, 1)) * 100)
  return (
    <section className="mb-2" data-collapsed={collapsed ? 'true' : 'false'}>
      <header className="sticky top-0 z-[2] flex h-9 items-center gap-2.5 bg-[color:var(--background)] px-1">
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Toggle ${title}`}
          className="grid size-[18px] place-items-center rounded-[3px] text-[color:var(--text-tertiary)] transition-transform"
          style={{ transform: collapsed ? 'rotate(-90deg)' : 'none' }}
        >
          <ChevronDown className="size-3" strokeWidth={1.75} />
        </button>
        <span
          aria-hidden
          className="grid size-3.5 shrink-0 place-items-center rounded-[3px] text-white"
          style={{ background: `oklch(60% 0.16 ${hue})` }}
        >
          <Zap className="size-2.5" strokeWidth={1.75} />
        </span>
        {keyLabel ? (
          <span className="font-mono text-[11px] font-medium text-[color:var(--text-tertiary)]">
            {keyLabel}
          </span>
        ) : null}
        <span className="text-[13.5px] font-semibold text-[color:var(--text-primary)]">{title}</span>
        <span className="ml-1 text-[11.5px] font-medium text-[color:var(--text-tertiary)]">
          {doneCount}/{doneTarget} done
        </span>
        <div className="ml-auto flex items-center gap-2 text-[11px] text-[color:var(--text-tertiary)]">
          <span>{pct}%</span>
          {rollup && rollup.length > 0 ? <RollupBar buckets={rollup} /> : null}
        </div>
      </header>
      <div className={cn('pb-3', collapsed && 'hidden')}>{children}</div>
    </section>
  )
}

function RollupBar({ buckets }: { buckets: SwimlaneRollupBucket[] }) {
  const total = Math.max(
    buckets.reduce((a, b) => a + b.value, 0),
    1,
  )
  return (
    <span className="inline-flex h-1.5 w-[120px] overflow-hidden rounded-[3px] border border-[color:var(--border)] bg-[color:var(--surface)]">
      {buckets.map((b, i) =>
        b.value > 0 ? (
          <span
            key={`${b.label}-${i}`}
            style={{ width: `${(b.value / total) * 100}%`, background: b.color }}
            title={`${b.label}: ${b.value}`}
          />
        ) : null,
      )}
    </span>
  )
}
