import crypto from 'node:crypto'
import zlib from 'node:zlib'

const ARCHIVE_FORMAT = '7asr2030-school-backup'
const ARCHIVE_VERSION = 1
const KDF_ITERATIONS = 310_000
const MAX_ARCHIVE_BYTES = 42 * 1024 * 1024
const MAX_PLAIN_BYTES = 120 * 1024 * 1024
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('invalid_backup_schema')
  return `"${value}"`
}

function safeString(value, max = 500) {
  return typeof value === 'string' && value.length <= max ? value : ''
}

function validUuid(value) { return ID_PATTERN.test(String(value || '')) }

function backupPassword(value) {
  const password = String(value || '')
  if (password.length < 12 || password.length > 200) throw new Error('backup_password_requirements')
  return password
}

function base64url(value) { return Buffer.from(value).toString('base64url') }

function decodeBase64url(value, maximum, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value) || value.length > maximum) throw new Error(`invalid_backup_${field}`)
  return Buffer.from(value, 'base64url')
}

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, KDF_ITERATIONS, 32, 'sha256')
}

function encryptArchive(payload, password) {
  const plain = Buffer.from(JSON.stringify(payload), 'utf8')
  const compressed = zlib.gzipSync(plain, { level: 9 })
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(password, salt), iv)
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()])
  return Buffer.from(JSON.stringify({
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    encryption: 'aes-256-gcm',
    kdf: { name: 'pbkdf2-sha256', iterations: KDF_ITERATIONS },
    compression: 'gzip',
    salt: base64url(salt),
    iv: base64url(iv),
    tag: base64url(cipher.getAuthTag()),
    ciphertext: base64url(ciphertext),
  }), 'utf8')
}

function decryptArchive(source, password) {
  if (typeof source !== 'string' || Buffer.byteLength(source, 'utf8') > MAX_ARCHIVE_BYTES) throw new Error('backup_file_too_large')
  let envelope
  try { envelope = JSON.parse(source) } catch { throw new Error('invalid_backup_file') }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.format !== ARCHIVE_FORMAT || envelope.version !== ARCHIVE_VERSION ||
    envelope.encryption !== 'aes-256-gcm' || envelope.compression !== 'gzip' || envelope.kdf?.name !== 'pbkdf2-sha256' || Number(envelope.kdf?.iterations) !== KDF_ITERATIONS) {
    throw new Error('unsupported_backup_file')
  }
  const salt = decodeBase64url(envelope.salt, 64, 'salt')
  const iv = decodeBase64url(envelope.iv, 32, 'iv')
  const tag = decodeBase64url(envelope.tag, 32, 'tag')
  const ciphertext = decodeBase64url(envelope.ciphertext, MAX_ARCHIVE_BYTES * 2, 'ciphertext')
  if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error('invalid_backup_file')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(password, salt), iv)
    decipher.setAuthTag(tag)
    const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    const plain = zlib.gunzipSync(compressed, { maxOutputLength: MAX_PLAIN_BYTES })
    return JSON.parse(plain.toString('utf8'))
  } catch (error) {
    if (error?.code === 'ERR_BUFFER_TOO_LARGE') throw new Error('backup_content_too_large')
    throw new Error('invalid_backup_password_or_file')
  }
}

async function schoolTables(client) {
  const result = await client.query(`SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema='public' AND column_name='school_id'
      AND table_name NOT IN ('sessions','school_backup_audit')
    ORDER BY table_name`)
  return result.rows.map(row => row.table_name).filter(table => /^[a-z_][a-z0-9_]*$/i.test(table))
}

async function tableColumns(client, table) {
  const result = await client.query(`SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND is_generated='NEVER'
    ORDER BY ordinal_position`, [table])
  return result.rows.map(row => row.column_name).filter(column => /^[a-z_][a-z0-9_]*$/i.test(column))
}

async function rowsForSchool(client, table, schoolId) {
  const identifier = quoteIdentifier(table)
  const result = await client.query(`SELECT COALESCE(json_agg(row_to_json(source)), '[]'::json) AS rows
    FROM public.${identifier} AS source WHERE school_id=$1`, [schoolId])
  return Array.isArray(result.rows[0]?.rows) ? result.rows[0].rows : []
}

async function snapshotForSchool(backupPool, schoolId) {
  const client = await backupPool.connect()
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const school = (await client.query('SELECT row_to_json(source) AS row FROM public.schools AS source WHERE id=$1', [schoolId])).rows[0]?.row
    if (!school) throw new Error('school_not_found')
    const tables = await schoolTables(client)
    const entries = []
    for (const table of tables) entries.push([table, await rowsForSchool(client, table, schoolId)])
    const users = (await client.query(`SELECT account.*
      FROM public.users AS account JOIN public.memberships AS membership ON membership.user_id=account.id
      WHERE membership.school_id=$1`, [schoolId])).rows
    await client.query('COMMIT')
    return {
      format: '7asr2030-school-snapshot',
      version: ARCHIVE_VERSION,
      createdAt: new Date().toISOString(),
      schoolId,
      schoolName: safeString(school.name, 200),
      school,
      users,
      tables: Object.fromEntries(entries),
    }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* transaction was not started */ }
    throw error
  } finally { client.release() }
}

function summaryFor(snapshot) {
  const count = table => Array.isArray(snapshot.tables?.[table]) ? snapshot.tables[table].length : 0
  const tableCounts = Object.fromEntries(Object.entries(snapshot.tables || {}).map(([table, rows]) => [table, Array.isArray(rows) ? rows.length : 0]))
  return {
    createdAt: snapshot.createdAt,
    schoolName: snapshot.schoolName,
    schoolId: snapshot.schoolId,
    totalRows: Object.values(tableCounts).reduce((total, value) => total + Number(value || 0), 0) + (Array.isArray(snapshot.users) ? snapshot.users.length : 0) + 1,
    students: count('students'),
    attendance: count('attendance_logs'),
    teachers: count('lesson_teachers'),
    administrators: count('administrative_staff'),
    lessonRecords: count('teacher_lesson_student_records'),
    sheets: count('teacher_sheet_entries'),
    behavior: count('behavior_student_records'),
    referrals: count('student_referrals'),
    tableCounts,
  }
}

async function validateSnapshot(client, snapshot, schoolId) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.format !== '7asr2030-school-snapshot' || snapshot.version !== ARCHIVE_VERSION ||
    snapshot.schoolId !== schoolId || !snapshot.school || typeof snapshot.school !== 'object' || snapshot.school.id !== schoolId ||
    !snapshot.tables || typeof snapshot.tables !== 'object' || Array.isArray(snapshot.tables) || !Array.isArray(snapshot.users)) {
    throw new Error('backup_school_mismatch')
  }
  if (!validUuid(schoolId) || snapshot.users.length > 10_000) throw new Error('invalid_backup_content')
  if (Number.isNaN(new Date(snapshot.createdAt).valueOf())) throw new Error('invalid_backup_content')
  const allowed = new Set(await schoolTables(client))
  for (const [table, rows] of Object.entries(snapshot.tables)) {
    if (!allowed.has(table) || !Array.isArray(rows) || rows.length > 500_000) throw new Error('invalid_backup_content')
    for (const row of rows) {
      if (!row || typeof row !== 'object' || Array.isArray(row) || row.school_id !== schoolId) throw new Error('invalid_backup_content')
    }
  }
  for (const user of snapshot.users) {
    if (!user || typeof user !== 'object' || !validUuid(user.id) || !safeString(user.email, 320)) throw new Error('invalid_backup_content')
  }
  return [...allowed]
}

async function insertRows(client, table, rows) {
  if (!rows.length) return
  const allowed = new Set(await tableColumns(client, table))
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))].filter(column => allowed.has(column))
  if (!columns.length) throw new Error('invalid_backup_content')
  const tableName = quoteIdentifier(table)
  const list = columns.map(quoteIdentifier).join(',')
  await client.query(`INSERT INTO public.${tableName} (${list})
    SELECT ${list} FROM json_populate_recordset(NULL::public.${tableName}, $1::json)`, [JSON.stringify(rows)])
}

async function insertUsers(client, users) {
  if (!users.length) return
  const allowed = new Set(await tableColumns(client, 'users'))
  const columns = [...new Set(users.flatMap(row => Object.keys(row)))].filter(column => allowed.has(column))
  if (!columns.includes('id') || !columns.includes('email')) throw new Error('invalid_backup_content')
  const list = columns.map(quoteIdentifier).join(',')
  const updates = columns.filter(column => !['id', 'password_hash', 'created_at'].includes(column)).map(column => `${quoteIdentifier(column)}=EXCLUDED.${quoteIdentifier(column)}`)
  await client.query(`INSERT INTO public.users (${list})
    SELECT ${list} FROM json_populate_recordset(NULL::public.users, $1::json)
    ON CONFLICT (id) DO UPDATE SET ${updates.length ? updates.join(',') : 'id=EXCLUDED.id'}`, [JSON.stringify(users)])
}

async function restoreSnapshot(backupPool, snapshot, schoolId, actorId) {
  const client = await backupPool.connect()
  try {
    await client.query('BEGIN')
    const allowedTables = await validateSnapshot(client, snapshot, schoolId)
    await client.query('DELETE FROM public.schools WHERE id=$1', [schoolId])
    await client.query("SET LOCAL session_replication_role='replica'")
    await insertRows(client, 'schools', [snapshot.school])
    await insertUsers(client, snapshot.users)
    const preferredOrder = ['memberships', 'administrative_staff', 'lesson_teachers']
    const tables = [...preferredOrder.filter(table => allowedTables.includes(table)), ...allowedTables.filter(table => !preferredOrder.includes(table))]
    for (const table of tables) await insertRows(client, table, Array.isArray(snapshot.tables[table]) ? snapshot.tables[table] : [])
    await client.query("SET LOCAL session_replication_role='origin'")
    const verify = await client.query('SELECT 1 FROM public.schools WHERE id=$1', [schoolId])
    if (!verify.rowCount) throw new Error('restore_verification_failed')
    await client.query(`INSERT INTO public.school_backup_audit(school_id,actor_id,action,backup_created_at,details)
      VALUES($1,$2,'restore',$3::timestamptz,$4::jsonb)`, [schoolId, actorId, snapshot.createdAt, JSON.stringify(summaryFor(snapshot))])
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* transaction already closed */ }
    throw error
  } finally { client.release() }
}

async function verifyCurrentPassword(authPool, user, value, passwordMatches) {
  const password = String(value || '')
  if (!password || password.length > 200) throw new Error('invalid_current_password')
  const saved = await authPool.query('SELECT password_hash FROM public.users WHERE id=$1', [user.user_id])
  if (!saved.rowCount || !passwordMatches(password, saved.rows[0].password_hash)) throw new Error('invalid_current_password')
}

function sendArchive(res, archive, createdAt) {
  const stamp = String(createdAt || new Date().toISOString()).slice(0, 10)
  res.writeHead(200, {
    'content-type': 'application/vnd.7asr2030.backup+json',
    'content-disposition': `attachment; filename="school-backup-${stamp}.7asrbackup"`,
    'content-length': String(archive.length),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(archive)
}

function errorCode(error) {
  const code = String(error?.message || '')
  return /^[a-z_]+$/.test(code) ? code : 'backup_operation_failed'
}

export async function migrateBackupRestore(adminPool) {
  await adminPool.query(`CREATE TABLE IF NOT EXISTS school_backup_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL,
    actor_id uuid,
    action text NOT NULL CHECK (action IN ('export','restore')),
    backup_created_at timestamptz,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS school_backup_audit_school_created ON school_backup_audit(school_id,created_at DESC);`)
}

export async function handleBackupRestoreRequest({ req, res, url, user, body, json, backupPool, authPool, passwordMatches }) {
  if (!url.pathname.startsWith('/api/school-backup/')) return false
  if (user.role !== 'admin') { json(res, 403, { error: 'forbidden' }); return true }
  try {
    if (req.method === 'POST' && url.pathname === '/api/school-backup/export') {
      const input = await body(req)
      await verifyCurrentPassword(authPool, user, input.currentPassword, passwordMatches)
      const password = backupPassword(input.backupPassword)
      const snapshot = await snapshotForSchool(backupPool, user.school_id)
      const archive = encryptArchive(snapshot, password)
      await backupPool.query(`INSERT INTO public.school_backup_audit(school_id,actor_id,action,backup_created_at,details)
        VALUES($1,$2,'export',$3::timestamptz,$4::jsonb)`, [user.school_id, user.user_id, snapshot.createdAt, JSON.stringify(summaryFor(snapshot))])
      sendArchive(res, archive, snapshot.createdAt)
      return true
    }
    if (req.method === 'POST' && url.pathname === '/api/school-backup/preview') {
      const input = await body(req, 50 * 1024 * 1024)
      await verifyCurrentPassword(authPool, user, input.currentPassword, passwordMatches)
      const snapshot = decryptArchive(input.archive, backupPassword(input.backupPassword))
      await validateSnapshot(backupPool, snapshot, user.school_id)
      json(res, 200, { snapshot: summaryFor(snapshot) })
      return true
    }
    if (req.method === 'POST' && url.pathname === '/api/school-backup/restore') {
      const input = await body(req, 50 * 1024 * 1024)
      await verifyCurrentPassword(authPool, user, input.currentPassword, passwordMatches)
      const snapshot = decryptArchive(input.archive, backupPassword(input.backupPassword))
      if (String(input.confirmSchoolName || '').trim() !== safeString(snapshot.schoolName, 200)) throw new Error('restore_confirmation_mismatch')
      await restoreSnapshot(backupPool, snapshot, user.school_id, user.user_id)
      json(res, 200, { ok: true, snapshot: summaryFor(snapshot), reloginRequired: true })
      return true
    }
    json(res, 404, { error: 'not_found' })
    return true
  } catch (error) {
    json(res, errorCode(error) === 'invalid_current_password' ? 401 : 400, { error: errorCode(error) })
    return true
  }
}
