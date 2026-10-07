import crypto from 'node:crypto'

function clean(value, max = 240) { return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) }
function validId(value) { return /^[0-9a-f-]{36}$/i.test(String(value || '')) }
function validDate(value) { const date = String(value || ''); return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T12:00:00Z`).valueOf()) ? date : null }
function identity(value) { return String(value ?? '').replace(/\D/g, '').slice(0, 32) }
function nameKey(value) {
  return clean(value, 180).normalize('NFKC').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}
function temporaryPassword() { const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from(crypto.randomBytes(10), byte => alphabet[byte % alphabet.length]).join('') }
function passwordMatches(password, saved) {
  const [salt, hash] = String(saved || '').split(':')
  if (!salt || !hash) return false
  const actual = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(actual, 'hex'))
}
function encryptionKey() {
  const key = Buffer.from(String(process.env.TEACHER_CREDENTIAL_ENCRYPTION_KEY || process.env.ALMADAR_ENCRYPTION_KEY || ''), 'base64url')
  return key.length === 32 ? key : null
}
function encryptTemporaryPassword(value) {
  const key = encryptionKey(); if (!key) throw new Error('teacher_credential_encryption_not_configured')
  const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}
function decryptTemporaryPassword(value) {
  const key = encryptionKey(); if (!key) throw new Error('teacher_credential_encryption_not_configured')
  const packed = Buffer.from(String(value || ''), 'base64url'); if (packed.length < 29) return null
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12)); decipher.setAuthTag(packed.subarray(12, 28))
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')
}

export async function migrateAdministratorPortal(adminPool) {
  await adminPool.query(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin','staff','teacher','administrator'));

    CREATE TABLE IF NOT EXISTS administrative_staff (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      full_name text NOT NULL,
      identity_number text NOT NULL,
      phone text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(school_id,identity_number)
    );
    CREATE INDEX IF NOT EXISTS administrative_staff_school_name ON administrative_staff(school_id,full_name) WHERE active=true;

    CREATE TABLE IF NOT EXISTS administrative_login_accounts (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      administrator_id uuid NOT NULL REFERENCES administrative_staff(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identity_number text NOT NULL,
      password_hash text NOT NULL,
      temporary_password_encrypted text,
      active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(school_id,administrator_id),
      UNIQUE(school_id,identity_number),
      UNIQUE(school_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS administrative_login_accounts_identity ON administrative_login_accounts(identity_number) WHERE active=true;
  `)
}

function administratorOnly(user) { return user.role === 'administrator' && validId(user.administrator_id) }
function adminOnly(user) { return user.role === 'admin' }

async function attendanceRows(client, schoolId, date) {
  return (await client.query(`SELECT a.student_id AS "studentId",to_char(a.attendance_date,'YYYY-MM-DD') AS date,
    to_char(a.recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time,a.status,s.name,s.grade,s.classroom,s.phone,
    NULL::text AS "recordedBy"
    FROM attendance_logs a JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id
    WHERE a.school_id=$1 AND a.attendance_date=$2::date ORDER BY a.recorded_at DESC`, [schoolId, date])).rows
}

export async function handleAdministratorPortalRequest({ req, res, url, user, body, json, scoped, todayRiyadh, authPool, passwordHash }) {
  if (!url.pathname.startsWith('/api/administrator-portal/')) return false

  if (url.pathname.startsWith('/api/administrator-portal/admin/')) {
    if (!adminOnly(user)) { json(res, 403, { error: 'forbidden' }); return true }
    if (req.method === 'GET' && url.pathname === '/api/administrator-portal/admin/overview') {
      const staffRows = await scoped(user.school_id, async client => (await client.query(`SELECT id AS "administratorId",full_name AS name,identity_number AS "identityNumber",phone,active
        FROM administrative_staff WHERE school_id=$1 ORDER BY active DESC,full_name`, [user.school_id])).rows)
      const accountRows = (await authPool.query(`SELECT administrator_id AS "administratorId",user_id AS "userId",active AS "accountActive",
        must_change_password AS "mustChangePassword",(temporary_password_encrypted IS NOT NULL) AS "credentialsAvailable"
        FROM administrative_login_accounts WHERE school_id=$1`, [user.school_id])).rows
      const accounts = new Map(accountRows.map(row => [row.administratorId, row]))
      const staff = staffRows.map(row => ({ ...row, accountCreated: Boolean(accounts.get(row.administratorId)?.userId), accountActive: Boolean(accounts.get(row.administratorId)?.accountActive), mustChangePassword: Boolean(accounts.get(row.administratorId)?.mustChangePassword), credentialsAvailable: Boolean(accounts.get(row.administratorId)?.credentialsAvailable) }))
      return json(res, 200, { staff })
    }
    if (req.method === 'POST' && url.pathname === '/api/administrator-portal/admin/import') {
      const input = await body(req); const source = Array.isArray(input.staff) ? input.staff.slice(0, 5000) : []
      const incoming = source.map(row => ({ name: clean(row?.name, 180), identityNumber: identity(row?.identityNumber), phone: clean(row?.phone, 48) })).filter(row => row.name && row.identityNumber)
      if (!incoming.length) { json(res, 400, { error: 'no_valid_administrators' }); return true }
      const result = await scoped(user.school_id, async client => {
        const old = (await client.query('SELECT full_name,identity_number FROM administrative_staff WHERE school_id=$1', [user.school_id])).rows
        const existingNames = new Set(old.map(row => nameKey(row.full_name)))
        const existingIdentity = new Set(old.map(row => row.identity_number))
        const seenNames = new Set(); const seenIdentity = new Set(); let added = 0; let skipped = 0; let conflicts = 0; let invalid = source.length - incoming.length
        for (const row of incoming) {
          const key = nameKey(row.name)
          if (!key || seenNames.has(key) || existingNames.has(key)) { skipped++; continue }
          if (seenIdentity.has(row.identityNumber) || existingIdentity.has(row.identityNumber)) { conflicts++; continue }
          await client.query(`INSERT INTO administrative_staff(school_id,full_name,identity_number,phone) VALUES($1,$2,$3,$4)`, [user.school_id, row.name, row.identityNumber, row.phone])
          seenNames.add(key); seenIdentity.add(row.identityNumber); existingNames.add(key); existingIdentity.add(row.identityNumber); added++
        }
        return { added, skipped, conflicts, invalid }
      })
      return json(res, 200, { ok: true, ...result })
    }
    if (req.method === 'GET' && url.pathname === '/api/administrator-portal/admin/credentials') {
      const accounts = (await authPool.query(`SELECT administrator_id AS "administratorId",identity_number AS "identityNumber",temporary_password_encrypted AS encrypted
        FROM administrative_login_accounts WHERE school_id=$1 AND active=true AND temporary_password_encrypted IS NOT NULL`, [user.school_id])).rows
      const staffRows = await scoped(user.school_id, async client => (await client.query('SELECT id,full_name AS name FROM administrative_staff WHERE school_id=$1 AND active=true', [user.school_id])).rows)
      const names = new Map(staffRows.map(row => [row.id, row.name]))
      const credentials = accounts.flatMap(row => { const password = decryptTemporaryPassword(row.encrypted); return password && names.has(row.administratorId) ? [{ administratorId: row.administratorId, name: names.get(row.administratorId), identityNumber: row.identityNumber, temporaryPassword: password }] : [] }).sort((a, b) => a.name.localeCompare(b.name, 'ar'))
      return json(res, 200, { credentials })
    }
    if (req.method === 'POST' && url.pathname === '/api/administrator-portal/admin/accounts/generate') {
      const input = await body(req); const requested = Array.isArray(input.administratorIds) ? [...new Set(input.administratorIds.filter(validId))] : []
      const staff = await scoped(user.school_id, async client => (await client.query(`SELECT id AS "administratorId",full_name AS name,identity_number AS "identityNumber"
        FROM administrative_staff WHERE school_id=$1 AND active=true ${requested.length ? 'AND id=ANY($2::uuid[])' : ''} ORDER BY full_name`, requested.length ? [user.school_id, requested] : [user.school_id])).rows)
      const credentials = []
      for (const administrator of staff) {
        const exists = await authPool.query('SELECT 1 FROM administrative_login_accounts WHERE school_id=$1 AND administrator_id=$2', [user.school_id, administrator.administratorId])
        if (exists.rowCount) continue
        const password = temporaryPassword(); const hash = passwordHash(password); const encrypted = encryptTemporaryPassword(password)
        const email = `administrator-${user.school_id}-${administrator.administratorId}@local.invalid`
        const savedUser = await authPool.query(`INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3)
          ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name RETURNING id`, [email, hash, administrator.name])
        await authPool.query(`INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,'administrator') ON CONFLICT(school_id,user_id) DO UPDATE SET role='administrator'`, [user.school_id, savedUser.rows[0].id])
        await authPool.query(`INSERT INTO administrative_login_accounts(school_id,administrator_id,user_id,identity_number,password_hash,temporary_password_encrypted,active,must_change_password)
          VALUES($1,$2,$3,$4,$5,$6,true,true)`, [user.school_id, administrator.administratorId, savedUser.rows[0].id, administrator.identityNumber, hash, encrypted])
        credentials.push({ administratorId: administrator.administratorId, name: administrator.name, identityNumber: administrator.identityNumber, temporaryPassword: password })
      }
      return json(res, 200, { ok: true, created: credentials.length, credentials })
    }
    if (req.method === 'POST' && url.pathname === '/api/administrator-portal/admin/accounts/reset') {
      const input = await body(req); const administratorId = String(input.administratorId || '')
      if (!validId(administratorId)) { json(res, 400, { error: 'invalid_administrator' }); return true }
      const password = temporaryPassword(); const hash = passwordHash(password); const encrypted = encryptTemporaryPassword(password)
      const changed = await authPool.query(`UPDATE administrative_login_accounts SET password_hash=$1,temporary_password_encrypted=$2,must_change_password=true,active=true,updated_at=now()
        WHERE school_id=$3 AND administrator_id=$4 RETURNING user_id`, [hash, encrypted, user.school_id, administratorId])
      if (!changed.rowCount) { json(res, 404, { error: 'administrator_account_not_found' }); return true }
      await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, changed.rows[0].user_id]); await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
      return json(res, 200, { ok: true, temporaryPassword: password })
    }
    if (req.method === 'PATCH' && url.pathname === '/api/administrator-portal/admin/accounts/status') {
      const input = await body(req); const administratorId = String(input.administratorId || '')
      if (!validId(administratorId) || typeof input.active !== 'boolean') { json(res, 400, { error: 'invalid_administrator_account_status' }); return true }
      const result = await authPool.query(`UPDATE administrative_login_accounts SET active=$1,updated_at=now() WHERE school_id=$2 AND administrator_id=$3 RETURNING user_id`, [input.active, user.school_id, administratorId])
      if (!result.rowCount) { json(res, 404, { error: 'administrator_account_not_found' }); return true }
      if (!input.active) await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [result.rows[0].user_id, user.school_id])
      return json(res, 200, { ok: true })
    }
    return false
  }

  if (!administratorOnly(user)) { json(res, 403, { error: 'administrator_portal_only' }); return true }
  if (req.method === 'GET' && url.pathname === '/api/administrator-portal/attendance') {
    const date = validDate(url.searchParams.get('date')) || todayRiyadh()
    const result = await scoped(user.school_id, async client => {
      const [school, students, records] = await Promise.all([
        client.query('SELECT name FROM schools WHERE id=$1', [user.school_id]),
        client.query('SELECT id,name,phone,grade,classroom FROM students WHERE school_id=$1 AND active=true ORDER BY name', [user.school_id]),
        attendanceRows(client, user.school_id, date),
      ])
      return { schoolName: school.rows[0]?.name || '', students: students.rows, records }
    })
    return json(res, 200, { date, ...result })
  }
  if (req.method === 'POST' && url.pathname === '/api/administrator-portal/attendance') {
    const input = await body(req); const studentId = clean(input.studentId, 160); const status = String(input.status || '')
    if (!studentId || !['present', 'late'].includes(status)) { json(res, 400, { error: 'invalid_attendance' }); return true }
    const date = todayRiyadh()
    const result = await scoped(user.school_id, async client => {
      const student = await client.query('SELECT name,grade,classroom,phone FROM students WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, studentId])
      if (!student.rowCount) return null
      await client.query('DELETE FROM absence_records WHERE school_id=$1 AND student_id=$2 AND absence_date=$3::date', [user.school_id, studentId, date])
      const saved = await client.query(`INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_by,status) VALUES($1,$2,$3::date,$4,$5)
        ON CONFLICT(school_id,student_id,attendance_date) DO NOTHING RETURNING to_char(recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time`, [user.school_id, studentId, date, user.user_id, status])
      return { duplicate: !saved.rowCount, student: student.rows[0], time: saved.rows[0]?.time || '' }
    })
    if (!result) { json(res, 404, { error: 'student_not_found' }); return true }
    return json(res, result.duplicate ? 200 : 201, { ok: !result.duplicate, date, status, ...result })
  }
  if (req.method === 'GET' && url.pathname === '/api/administrator-portal/reports') {
    const date = validDate(url.searchParams.get('date')) || todayRiyadh()
    const records = await scoped(user.school_id, client => attendanceRows(client, user.school_id, date))
    return json(res, 200, { date, records })
  }
  if (req.method === 'POST' && url.pathname === '/api/administrator-portal/password') {
    const input = await body(req); const currentPassword = String(input.currentPassword || ''); const newPassword = String(input.newPassword || '')
    if (newPassword.length < 8 || newPassword.length > 200) { json(res, 400, { error: 'invalid_administrator_password' }); return true }
    const saved = await authPool.query('SELECT password_hash FROM administrative_login_accounts WHERE school_id=$1 AND administrator_id=$2 AND user_id=$3 AND active=true', [user.school_id, user.administrator_id, user.user_id])
    if (!saved.rowCount || !passwordMatches(currentPassword, saved.rows[0].password_hash)) { json(res, 401, { error: 'current_password_invalid' }); return true }
    const hash = passwordHash(newPassword)
    await authPool.query('UPDATE administrative_login_accounts SET password_hash=$1,temporary_password_encrypted=NULL,must_change_password=false,updated_at=now() WHERE school_id=$2 AND administrator_id=$3', [hash, user.school_id, user.administrator_id])
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.user_id])
    return json(res, 200, { ok: true })
  }
  return false
}
