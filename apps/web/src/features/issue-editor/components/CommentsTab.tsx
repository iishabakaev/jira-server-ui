import { Button, cn } from '@ui/index'
import { useState } from 'react'
import { useAddComment, useDeleteComment, useEditComment } from '../hooks'
import type { IssueComment, SyncState } from '../types'

// Минимальный read+write для комментариев. ADF-рендер ограничен plain-text:
// собираем поле `text` из верхнего уровня doc.content[].content[].text.
// Полный TipTap-редактор приедет позже (см. spec §11).

function adfToPlainText(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const root = body as { content?: unknown }
  if (!Array.isArray(root.content)) return ''
  const lines: string[] = []
  for (const block of root.content) {
    if (!block || typeof block !== 'object') continue
    const b = block as { content?: unknown }
    if (!Array.isArray(b.content)) {
      lines.push('')
      continue
    }
    const parts: string[] = []
    for (const inline of b.content) {
      if (inline && typeof inline === 'object' && 'text' in inline) {
        const t = (inline as { text?: unknown }).text
        if (typeof t === 'string') parts.push(t)
      }
    }
    lines.push(parts.join(''))
  }
  return lines.join('\n\n').trim()
}

const SYNC_DOT: Record<SyncState, string | null> = {
  synced: null,
  pending: 'bg-amber-500',
  pushing: 'bg-blue-500 animate-pulse',
  error: 'bg-red-500',
  conflict: 'bg-purple-500',
}

function CommentRow({
  comment,
  issueKey,
  currentUserId,
}: {
  comment: IssueComment
  issueKey: string
  currentUserId: string | null
}) {
  const editMut = useEditComment(issueKey)
  const delMut = useDeleteComment(issueKey)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => adfToPlainText(comment.body))
  const dot = SYNC_DOT[comment.syncState]
  const canMutate = currentUserId !== null && comment.authorId === currentUserId

  const onSave = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    editMut.mutate({ commentId: comment.id, text: trimmed }, { onSuccess: () => setEditing(false) })
  }

  return (
    <li className="flex flex-col gap-1 rounded border border-border bg-background p-2">
      <header className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">{comment.authorId}</span>
        <span>· {new Date(comment.createdAt).toLocaleString()}</span>
        {dot ? <span className={cn('size-1.5 rounded-full', dot)} aria-hidden /> : null}
        {canMutate && !editing ? (
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => delMut.mutate(comment.id)}
              disabled={delMut.isPending}
            >
              Delete
            </Button>
          </span>
        ) : null}
      </header>
      {editing ? (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full rounded border border-border bg-background p-2 text-sm focus:border-ring focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={onSave} disabled={editMut.isPending}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false)
                setDraft(adfToPlainText(comment.body))
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm">
          {adfToPlainText(comment.body) || <em className="text-muted-foreground">empty</em>}
        </p>
      )}
    </li>
  )
}

export interface CommentsTabProps {
  issueKey: string
  comments: IssueComment[]
  currentUserId: string | null
}

export function CommentsTab({ issueKey, comments, currentUserId }: CommentsTabProps) {
  const addMut = useAddComment(issueKey)
  const [text, setText] = useState('')

  const onAdd = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    addMut.mutate(trimmed, {
      onSuccess: () => setText(''),
    })
  }

  return (
    <section aria-label="Comments" className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {comments.length === 0 ? (
          <li className="text-sm italic text-muted-foreground">No comments yet.</li>
        ) : (
          comments.map((c) => (
            <CommentRow key={c.id} comment={c} issueKey={issueKey} currentUserId={currentUserId} />
          ))
        )}
      </ul>
      <div className="flex flex-col gap-2 rounded border border-border bg-muted/40 p-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Leave a comment…"
          rows={3}
          className="w-full rounded border border-border bg-background p-2 text-sm focus:border-ring focus:outline-none"
        />
        <div className="flex items-center justify-end gap-2">
          {addMut.error ? (
            <span role="alert" className="mr-auto text-xs text-destructive">
              {(addMut.error as Error).message}
            </span>
          ) : null}
          <Button onClick={onAdd} disabled={!text.trim() || addMut.isPending} size="sm">
            {addMut.isPending ? 'Posting…' : 'Comment'}
          </Button>
        </div>
      </div>
    </section>
  )
}

export const __test = { adfToPlainText }
