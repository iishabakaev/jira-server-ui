import { describe, expect, it } from 'bun:test'
import { __test } from './mutations'

// Юнит-тесты для чистых хелперов мутаций. БД не трогаем — это покрывают
// интеграционные тесты в milestones 5/6 (заведённые отдельно).

describe('adfFromPlainText', () => {
  it('wraps a single paragraph', () => {
    const doc = __test.adfFromPlainText('hello world')
    expect(doc.type).toBe('doc')
    expect(doc.version).toBe(1)
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'hello world' }] },
    ])
  })

  it('splits paragraphs on blank lines', () => {
    const doc = __test.adfFromPlainText('first\n\nsecond')
    expect(doc.content).toHaveLength(2)
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'first' }],
    })
    expect(doc.content[1]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'second' }],
    })
  })

  it('keeps single linebreaks inside one paragraph', () => {
    // Внутри абзаца перенос строки сохраняем как часть `text` — иначе
    // короткий `\n` дробил бы каждую строку в отдельный абзац.
    const doc = __test.adfFromPlainText('line1\nline2')
    expect(doc.content).toHaveLength(1)
    const para = doc.content[0] as { type: string; content: Array<{ text: string }> }
    expect(para.content[0]!.text).toBe('line1\nline2')
  })

  it('renders an empty doc as an empty paragraph (never empty content array)', () => {
    const doc = __test.adfFromPlainText('')
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0]).toEqual({ type: 'paragraph', content: [] })
  })
})

describe('commentBody', () => {
  it('prefers explicit body over text', () => {
    const explicit: { type: 'doc'; version: 1; content: unknown[] } = {
      type: 'doc',
      version: 1,
      content: [],
    }
    expect(__test.commentBody({ body: explicit, text: 'ignored' })).toBe(explicit)
  })

  it('wraps text into ADF when only text is given', () => {
    const result = __test.commentBody({ text: 'note' }) as {
      type: string
      content: Array<{ content: Array<{ text: string }> }>
    }
    expect(result.type).toBe('doc')
    expect(result.content[0]!.content[0]!.text).toBe('note')
  })

  it('throws when neither text nor body is provided', () => {
    expect(() => __test.commentBody({})).toThrow()
  })
})

describe('idempotency bucket', () => {
  it('produces the same bucket within the window and a different one across it', () => {
    const now = 1_700_000_000_000
    const b1 = __test.bucket(now)
    const b2 = __test.bucket(now + __test.IDEMPOTENCY_WINDOW_MS - 1)
    const b3 = __test.bucket(now + __test.IDEMPOTENCY_WINDOW_MS + 1)
    expect(b1).toBe(b2)
    expect(b1).not.toBe(b3)
  })
})

describe('hash', () => {
  it('is deterministic for equivalent inputs', () => {
    const a = __test.hash({ a: 1, b: 'x' })
    const b = __test.hash({ a: 1, b: 'x' })
    expect(a).toBe(b)
    expect(a.length).toBe(16)
  })

  it('differs across different payloads', () => {
    expect(__test.hash({ a: 1 })).not.toBe(__test.hash({ a: 2 }))
  })
})
