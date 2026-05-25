import { db, users, jiraCredentials, auditLog } from '@db'
import { eq, and } from 'drizzle-orm'
import { encryptSecret, decryptSecret, ACTIVE_KEK_KID } from '../../lib/crypto'
import { env } from '../../env'
import { appError } from '../../plugins/error'
import { createJiraClient } from '@jira/index'
import { json } from 'drizzle-orm/pg-core'

// PAT attach: валидируем токен против Jira `myself`, затем шифруем через
// AES-GCM envelope и кладём в jira_credentials. Открытый текст не попадает
// ни в логи, ни в SSE.

export type AttachPatResult = {
  jiraDisplayName: string
  jiraAccountId: string | null
  jiraUserKey: string
}

export async function attachPat(userId: string, token: string): Promise<AttachPatResult> {
  if (!env.JIRA_BASE_URL) {
    throw appError('internal', 'JIRA_BASE_URL is not configured')
  }
  const cleaned = token.trim()
  if (cleaned.length < 8 || cleaned.length > 1024) {
    throw appError('validation_failed', 'PAT must be 8..1024 chars')
  }

  // 1) Валидация через /rest/api/2/myself.
  let myself: { name: string; key: string; emailAddress?: string; displayName: string; accountId?: string }
  try {
    const jira = createJiraClient({ baseUrl: env.JIRA_BASE_URL, bearer: cleaned, timeoutMs: 10_000 })
    myself = await jira.myself()
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401 || status === 403) {
      throw appError('unauthenticated', 'Jira rejected the PAT')
    }
    throw appError('jira_unavailable', `Cannot reach Jira for PAT validation ${JSON.stringify(err)}`)
  }

  // 2) Шифруем PAT.
  const envelope = encryptSecret(cleaned)

  // 3) Записываем строку и обновляем users — в одной транзакции.
  await db.transaction(async (tx) => {
    await tx
      .insert(jiraCredentials)
      .values({
        userId,
        kind: 'pat',
        ciphertext: envelope.ciphertext,
        iv: envelope.iv,
        tag: envelope.tag,
        kekKid: envelope.kekKid,
        jiraDisplayName: myself.displayName,
        needsReattach: null,
        lastUsedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [jiraCredentials.userId, jiraCredentials.kind],
        set: {
          ciphertext: envelope.ciphertext,
          iv: envelope.iv,
          tag: envelope.tag,
          kekKid: envelope.kekKid,
          jiraDisplayName: myself.displayName,
          needsReattach: null,
          lastUsedAt: new Date(),
        },
      })

    await tx
      .update(users)
      .set({
        jiraAccountId: myself.accountId ?? null,
        jiraUserKey: myself.key,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))

    await tx.insert(auditLog).values({
      userId,
      action: 'auth.jira_pat.attached',
      targetKind: 'user',
      targetId: userId,
      payload: { jiraDisplayName: myself.displayName, accountId: myself.accountId, userKey: myself.key },
    })
  })

  return {
    jiraDisplayName: myself.displayName,
    jiraAccountId: myself.accountId ?? null,
    jiraUserKey: myself.key,
  }
}

export async function removePat(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(jiraCredentials)
      .where(and(eq(jiraCredentials.userId, userId), eq(jiraCredentials.kind, 'pat')))
    await tx
      .update(users)
      .set({ jiraAccountId: null, jiraUserKey: null, updatedAt: new Date() })
      .where(eq(users.id, userId))
    await tx.insert(auditLog).values({
      userId,
      action: 'auth.jira_pat.removed',
      targetKind: 'user',
      targetId: userId,
      payload: null,
    })
  })
}

export type PatStatus = {
  attached: boolean
  jiraDisplayName: string | null
  needsReattach: boolean
  lastUsedAt: string | null
}

export async function getPatStatus(userId: string): Promise<PatStatus> {
  const rows = await db
    .select({
      jiraDisplayName: jiraCredentials.jiraDisplayName,
      needsReattach: jiraCredentials.needsReattach,
      lastUsedAt: jiraCredentials.lastUsedAt,
    })
    .from(jiraCredentials)
    .where(and(eq(jiraCredentials.userId, userId), eq(jiraCredentials.kind, 'pat')))
    .limit(1)
  const row = rows[0]
  if (!row) return { attached: false, jiraDisplayName: null, needsReattach: false, lastUsedAt: null }
  return {
    attached: true,
    jiraDisplayName: row.jiraDisplayName,
    needsReattach: row.needsReattach === 'true',
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  }
}

// Тестовый round-trip к Jira. Используется и UI ("проверить") и фоновыми
// задачами при первичной выдаче bearer'а воркеру.
export async function testPat(userId: string): Promise<{ ok: boolean; jiraDisplayName: string | null }> {
  if (!env.JIRA_BASE_URL) throw appError('internal', 'JIRA_BASE_URL is not configured')
  const rows = await db
    .select({
      ciphertext: jiraCredentials.ciphertext,
      iv: jiraCredentials.iv,
      tag: jiraCredentials.tag,
      kekKid: jiraCredentials.kekKid,
    })
    .from(jiraCredentials)
    .where(and(eq(jiraCredentials.userId, userId), eq(jiraCredentials.kind, 'pat')))
    .limit(1)
  const row = rows[0]
  if (!row) throw appError('not_found', 'No PAT attached')

  let bearer: string
  try {
    bearer = decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
      kekKid: row.kekKid,
    })
  } catch {
    throw appError('internal', 'Failed to decrypt PAT')
  }

  try {
    const jira = createJiraClient({ baseUrl: env.JIRA_BASE_URL, bearer, timeoutMs: 10_000 })
    const me = await jira.myself()
    await db
      .update(jiraCredentials)
      .set({ lastUsedAt: new Date(), needsReattach: null, jiraDisplayName: me.displayName })
      .where(and(eq(jiraCredentials.userId, userId), eq(jiraCredentials.kind, 'pat')))
    return { ok: true, jiraDisplayName: me.displayName }
  } catch (err) {
    const status = (err as { status?: number }).status
    if (status === 401 || status === 403) {
      await db
        .update(jiraCredentials)
        .set({ needsReattach: 'true' })
        .where(and(eq(jiraCredentials.userId, userId), eq(jiraCredentials.kind, 'pat')))
      await db.insert(auditLog).values({
        userId,
        action: 'auth.jira_pat.validation_failed',
        targetKind: 'user',
        targetId: userId,
        payload: { status },
      })
      return { ok: false, jiraDisplayName: null }
    }
    throw appError('jira_unavailable', 'Cannot reach Jira')
  }
}

// Используется воркерами: достать дешифрованный bearer на короткое окно
// выполнения задачи. Plaintext не сохраняется.
export async function getBearerForUser(userId: string): Promise<string | null> {
  const rows = await db
    .select({
      ciphertext: jiraCredentials.ciphertext,
      iv: jiraCredentials.iv,
      tag: jiraCredentials.tag,
      kekKid: jiraCredentials.kekKid,
    })
    .from(jiraCredentials)
    .where(and(eq(jiraCredentials.userId, userId), eq(jiraCredentials.kind, 'pat')))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  if (row.kekKid !== ACTIVE_KEK_KID) return null
  try {
    return decryptSecret({
      ciphertext: row.ciphertext,
      iv: row.iv,
      tag: row.tag,
      kekKid: row.kekKid,
    })
  } catch {
    return null
  }
}
