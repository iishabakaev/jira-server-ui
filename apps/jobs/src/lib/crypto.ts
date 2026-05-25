import { createDecipheriv } from 'node:crypto'

// AES-256-GCM envelope-расшифровка. Зеркало apps/server/src/lib/crypto.ts;
// в воркерной среде нам нужен только decrypt (зашифровать PAT можно только
// в server-процессе, который держит /api/auth/jira-pat).
//
// Формат хранения — см. комментарий в server/lib/crypto.ts.

const KEY_LEN = 32
const IV_LEN = 12
const TAG_LEN = 16

let cachedKekBytes: Uint8Array | null = null

function decodeKek(kek: string): Uint8Array {
  if (cachedKekBytes) return cachedKekBytes
  const buf = Buffer.from(kek, 'base64')
  if (buf.length !== KEY_LEN) {
    throw new Error(`JIRA_PAT_KEK must decode to ${KEY_LEN} bytes, got ${buf.length}`)
  }
  cachedKekBytes = new Uint8Array(buf)
  return cachedKekBytes
}

export const ACTIVE_KEK_KID = 'kek1'

export interface EncryptedEnvelope {
  ciphertext: Uint8Array
  iv: Uint8Array
  tag: Uint8Array
  kekKid: string
}

export function decryptSecret(envelope: EncryptedEnvelope, kekBase64: string): string {
  if (envelope.kekKid !== ACTIVE_KEK_KID) {
    throw new Error(`Unknown KEK kid: ${envelope.kekKid}`)
  }
  const kek = decodeKek(kekBase64)
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
  const plaintext = Buffer.concat([
    decipher1.update(Buffer.from(envelope.ciphertext)),
    decipher1.final(),
  ])
  return plaintext.toString('utf8')
}
