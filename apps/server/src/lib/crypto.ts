import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '../env'

// AES-256-GCM envelope-шифрование. JIRA_PAT_KEK — мастер-ключ (KEK, 32 байта в base64),
// он шифрует одноразовый DEK на каждый PAT. На запись/чтение DEK генерируется/восстанавливается;
// сам PAT никогда не покидает память воркера.
//
// Формат хранения в БД:
//   ciphertext = AES-GCM(DEK, IV1, plaintext)              — собственно PAT
//   wrappedDek = AES-GCM(KEK, IV2, DEK)                    — обёрнутый DEK
//   iv         = IV1 || IV2 (12 + 12 = 24 байт)             — оба IV конкатенированы
//   tag        = tag1 || wrappedDek || tag2                — GCM-теги + обёртка DEK
//
// Такой компактный конверт умещается в три bytea-поля схемы jira_credentials
// (ciphertext, iv, tag) без отдельной DEK-таблицы. KEK-ротация поддерживается
// через kekKid; на чтении выбираем нужный мастер-ключ.

const KEY_LEN = 32
const IV_LEN = 12
const TAG_LEN = 16

let cachedKekBytes: Uint8Array | null = null

function decodeKek(): Uint8Array {
  if (cachedKekBytes) return cachedKekBytes
  const buf = Buffer.from(env.JIRA_PAT_KEK, 'base64')
  if (buf.length !== KEY_LEN) {
    throw new Error(`JIRA_PAT_KEK must decode to ${KEY_LEN} bytes, got ${buf.length}`)
  }
  cachedKekBytes = new Uint8Array(buf)
  return cachedKekBytes
}

export interface EncryptedEnvelope {
  ciphertext: Uint8Array
  iv: Uint8Array
  tag: Uint8Array
  kekKid: string
}

// Активный идентификатор KEK. Поддерживает будущую ротацию: в БД лежит kid,
// при чтении выбирается соответствующая байтовая последовательность KEK.
export const ACTIVE_KEK_KID = 'kek1'

export function encryptSecret(plaintext: string): EncryptedEnvelope {
  const kek = decodeKek()
  const dek = randomBytes(KEY_LEN)
  const iv1 = randomBytes(IV_LEN)
  const iv2 = randomBytes(IV_LEN)

  const cipher1 = createCipheriv('aes-256-gcm', dek, iv1)
  const ct = Buffer.concat([cipher1.update(plaintext, 'utf8'), cipher1.final()])
  const tag1 = cipher1.getAuthTag()

  const cipher2 = createCipheriv('aes-256-gcm', kek, iv2)
  const wrappedDek = Buffer.concat([cipher2.update(dek), cipher2.final()])
  const tag2 = cipher2.getAuthTag()

  return {
    ciphertext: new Uint8Array(ct),
    iv: new Uint8Array(Buffer.concat([iv1, iv2])),
    tag: new Uint8Array(Buffer.concat([tag1, wrappedDek, tag2])),
    kekKid: ACTIVE_KEK_KID,
  }
}

export function decryptSecret(envelope: EncryptedEnvelope): string {
  if (envelope.kekKid !== ACTIVE_KEK_KID) {
    throw new Error(`Unknown KEK kid: ${envelope.kekKid}`)
  }
  const kek = decodeKek()
  const ivBuf = Buffer.from(envelope.iv)
  const tagBuf = Buffer.from(envelope.tag)
  if (ivBuf.length !== IV_LEN * 2) throw new Error('Bad IV length')
  if (tagBuf.length !== TAG_LEN + KEY_LEN + TAG_LEN) throw new Error('Bad tag length')

  const iv1 = ivBuf.subarray(0, IV_LEN)
  const iv2 = ivBuf.subarray(IV_LEN)
  const tag1 = tagBuf.subarray(0, TAG_LEN)
  const wrappedDek = tagBuf.subarray(TAG_LEN, TAG_LEN + KEY_LEN)
  const tag2 = tagBuf.subarray(TAG_LEN + KEY_LEN)

  const decipher2 = createDecipheriv('aes-256-gcm', kek, iv2)
  decipher2.setAuthTag(tag2)
  const dek = Buffer.concat([decipher2.update(wrappedDek), decipher2.final()])

  const decipher1 = createDecipheriv('aes-256-gcm', dek, iv1)
  decipher1.setAuthTag(tag1)
  const plaintext = Buffer.concat([decipher1.update(Buffer.from(envelope.ciphertext)), decipher1.final()])
  return plaintext.toString('utf8')
}

// Криптостойкий случайный session id. 32 байта → 256 бит энтропии, base64url.
export function newSessionId(): string {
  return randomBytes(32).toString('base64url')
}

// Константное сравнение строк одинаковой длины. Для разной длины — false
// без раннего выхода (length-индикатор не атакабелен).
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}
