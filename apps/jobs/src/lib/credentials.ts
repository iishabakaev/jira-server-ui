import { db, jiraCredentials } from '@db'
import { and, eq, isNull } from 'drizzle-orm'
import { ACTIVE_KEK_KID, decryptSecret } from './crypto'
import { env } from '../env'

// Загрузчик PAT-bearer'а для воркеров. Plaintext возвращается на время
// одной outbox-операции; ничего не кешируется в памяти.
export async function getBearerForUser(userId: string): Promise<string | null> {
  if (!env.JIRA_PAT_KEK) return null
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
    return decryptSecret(
      {
        ciphertext: row.ciphertext,
        iv: row.iv,
        tag: row.tag,
        kekKid: row.kekKid,
      },
      env.JIRA_PAT_KEK,
    )
  } catch {
    return null
  }
}

// При 401/403 от Jira помечаем учётку как needs_reattach — UI попросит
// пользователя переподключить PAT через /settings/jira.
export async function markNeedsReattach(userId: string): Promise<void> {
  await db
    .update(jiraCredentials)
    .set({ needsReattach: 'true' })
    .where(and(eq(jiraCredentials.userId, userId), eq(jiraCredentials.kind, 'pat')))
}

// Подбирает любую исправную PAT-учётку для scheduled-задач (refresh-metadata,
// incremental-sync, refresh-workflow), у которых нет явного userId. Стратегия
// сознательно простая: первая по времени запись `kind=pat` без флага
// needs_reattach. Это подходит для on-prem-сценария с админ-учёткой;
// многопользовательскую балансировку (или выделенную service-учётку) добавим,
// когда появится несколько активных PAT.
//
// Возвращаемый userId логируется вызывающим — security-review требует, чтобы
// scheduled-обращения к Jira всегда были отслеживаемы до конкретной учётки.
export async function pickAnyBearer(): Promise<{ userId: string; bearer: string } | null> {
  if (!env.JIRA_PAT_KEK) {
    console.warn(JSON.stringify({ msg: 'credentials.no_kek' }))
    return null
  }
  const rows = await db
    .select({
      userId: jiraCredentials.userId,
      ciphertext: jiraCredentials.ciphertext,
      iv: jiraCredentials.iv,
      tag: jiraCredentials.tag,
      kekKid: jiraCredentials.kekKid,
    })
    .from(jiraCredentials)
    .where(and(eq(jiraCredentials.kind, 'pat'), isNull(jiraCredentials.needsReattach)))
    .limit(10)
  let skipped = 0
  for (const row of rows) {
    if (row.kekKid !== ACTIVE_KEK_KID) {
      skipped += 1
      continue
    }
    try {
      const bearer = decryptSecret(
        { ciphertext: row.ciphertext, iv: row.iv, tag: row.tag, kekKid: row.kekKid },
        env.JIRA_PAT_KEK,
      )
      console.log(
        JSON.stringify({ msg: 'credentials.pick_any', userId: row.userId, source: 'pat' }),
      )
      return { userId: row.userId, bearer }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn(
        JSON.stringify({ msg: 'credentials.decrypt_failed', userId: row.userId, error: message }),
      )
    }
  }
  console.warn(JSON.stringify({ msg: 'credentials.none_usable', skipped, examined: rows.length }))
  return null
}
