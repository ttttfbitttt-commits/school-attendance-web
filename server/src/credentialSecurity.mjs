import crypto from 'node:crypto'

// كلمات المرور المؤقتة لا تخزن كنص صريح. نحتاجها مشفرة فقط لأن مدير المدرسة
// طلب إمكانية الرجوع إليها حتى يغير صاحب الحساب كلمة مروره بنفسه.
function encryptionKey() {
  const raw = process.env.TEACHER_CREDENTIAL_ENCRYPTION_KEY || process.env.ALMADAR_ENCRYPTION_KEY || ''
  const key = Buffer.from(String(raw), 'base64url')
  return key.length === 32 ? key : null
}

export function newTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'
  return Array.from(crypto.randomBytes(14), byte => alphabet[byte % alphabet.length]).join('')
}

export function encryptTemporaryPassword(value) {
  const key = encryptionKey()
  if (!key) throw new Error('credential_encryption_not_configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

export function decryptTemporaryPassword(value) {
  const key = encryptionKey()
  if (!key || !value) return ''
  try {
    const packed = Buffer.from(String(value), 'base64url')
    if (packed.length < 29) return ''
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12))
    decipher.setAuthTag(packed.subarray(12, 28))
    return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')
  } catch { return '' }
}
