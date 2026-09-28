import crypto from 'node:crypto'

const RIYADH_TIME_ZONE = 'Asia/Riyadh'

function encryptionKey() {
  const key = Buffer.from(String(process.env.ALMADAR_ENCRYPTION_KEY || ''), 'base64url')
  return key.length === 32 ? key : null
}

function encrypt(value) {
  const key = encryptionKey()
  if (!key) throw new Error('almadar_encryption_not_configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}

function decrypt(value) {
  const key = encryptionKey()
  if (!key) throw new Error('almadar_encryption_not_configured')
  const packed = Buffer.from(String(value), 'base64url')
  if (packed.length < 29) throw new Error('invalid_encrypted_secret')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12))
  decipher.setAuthTag(packed.subarray(12, 28))
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')
}

function validDate(value) {
  const date = String(value || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(new Date(`${date}T12:00:00Z`).valueOf()) ? date : null
}

function workingDates(from, to) {
  const dates = []
  const cursor = new Date(`${from}T12:00:00Z`)
  const end = new Date(`${to}T12:00:00Z`)
  while (cursor <= end && dates.length <= 366) {
    if (cursor.getUTCDay() <= 4) dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '')
  const phone = digits.startsWith('966') ? digits : `966${digits.replace(/^0+/, '')}`
  return /^9665\d{8}$/.test(phone) ? phone : null
}

function providerError(data, fallback) {
  const detail = data && typeof data === 'object' ? data.message || data.error : ''
  return String(detail || fallback).replace(/[\r\n]+/g, ' ').slice(0, 300)
}

async function requestBalance(apiKey) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch('https://app.mobile.net.sa/api/v1/get-balance', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    if (response.ok) return { ok: true, balance: data?.data?.balance ?? null }
    if (response.status === 401) return { ok: false, error: 'api_key_not_authorized' }
    return { ok: false, error: providerError(data, `provider_http_${response.status}`) }
  } catch {
    return { ok: false, error: 'provider_unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}

async function sendMessage(apiKey, payload) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch('https://app.mobile.net.sa/api/v1/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    const data = await response.json().catch(() => null)
    return response.ok ? { ok: true } : { ok: false, error: providerError(data, `provider_http_${response.status}`) }
  } catch {
    return { ok: false, error: 'provider_unreachable' }
  } finally {
    clearTimeout(timeout)
  }
}

function arabicDay(date) {
  return ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'][new Date(`${date}T12:00:00`).getDay()] || 'هذا اليوم'
}

function automaticText(type, student, schoolName, date, time) {
  if (type === 'late') return `نفيدكم بتأخر الطالب ${student.name} من مدرسة ${schoolName} ليوم ${arabicDay(date)} الموافق ${date}، حيث حضر الساعة ${time}.`
  return `نفيدكم بغياب الطالب ${student.name} من مدرسة ${schoolName} ليوم ${arabicDay(date)} الموافق ${date}.`
}

async function accountForSchool(schoolId, scoped) {
  return scoped(schoolId, async client => (await client.query(`SELECT username_encrypted,password_encrypted,api_key_encrypted,sender_name,last_balance,verified_at,updated_at
    FROM almadar_accounts WHERE school_id=$1`, [schoolId])).rows[0] || null)
}

async function absenceData({ schoolId, from, to, studentId, scoped }) {
  const dates = workingDates(from, to)
  return scoped(schoolId, async client => {
    const students = (await client.query(`SELECT id,name,phone,grade,classroom,to_char(created_at AT TIME ZONE $1,'YYYY-MM-DD') AS "createdDate"
      FROM students WHERE active=true ORDER BY name`, [RIYADH_TIME_ZONE])).rows
    const attendance = (await client.query(`SELECT student_id,to_char(attendance_date,'YYYY-MM-DD') AS date
      FROM attendance_logs WHERE attendance_date BETWEEN $1 AND $2`, [from, to])).rows
    const excuses = (await client.query(`SELECT student_id,category,note,to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate"
      FROM student_excuses WHERE start_date <= $2 AND (end_date IS NULL OR end_date >= $1) ORDER BY start_date DESC`, [from, to])).rows
    const attendanceByStudent = new Map()
    attendance.forEach(row => {
      const values = attendanceByStudent.get(row.student_id) || new Set()
      values.add(row.date)
      attendanceByStudent.set(row.student_id, values)
    })
    const excusesByStudent = new Map()
    excuses.forEach(row => {
      const values = excusesByStudent.get(row.student_id) || []
      values.push(row)
      excusesByStudent.set(row.student_id, values)
    })
    return {
      from,
      to,
      workingDays: dates.length,
      rows: students
        .filter(student => !studentId || student.id === studentId)
        .map(student => {
          const eligibleDates = dates.filter(date => date >= (student.createdDate || from))
          const attended = attendanceByStudent.get(student.id) || new Set()
          const absenceDays = eligibleDates.reduce((total, date) => total + (attended.has(date) ? 0 : 1), 0)
          const studentExcuses = excusesByStudent.get(student.id) || []
          return { ...student, absenceDays, hasExcuse: studentExcuses.length > 0, excuses: studentExcuses }
        }),
    }
  })
}

export async function migrateFeatures(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS almadar_accounts (
      school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
      username_encrypted text NOT NULL,
      password_encrypted text NOT NULL,
      api_key_encrypted text NOT NULL,
      sender_name text NOT NULL,
      last_balance text,
      verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS student_excuses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      category text NOT NULL DEFAULT 'عذر',
      note text NOT NULL DEFAULT '',
      start_date date NOT NULL,
      end_date date,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (end_date IS NULL OR end_date >= start_date),
      FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS message_logs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id text,
      student_name text NOT NULL DEFAULT '',
      recipient text NOT NULL,
      sender_name text NOT NULL,
      message_type text NOT NULL CHECK (message_type IN ('late','absence','general')),
      message_body text NOT NULL,
      status text NOT NULL CHECK (status IN ('sent','failed')),
      error_detail text NOT NULL DEFAULT '',
      sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS student_excuses_school_student ON student_excuses(school_id,student_id,start_date DESC);
    CREATE INDEX IF NOT EXISTS message_logs_school_created ON message_logs(school_id,created_at DESC);
    ALTER TABLE almadar_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE almadar_accounts FORCE ROW LEVEL SECURITY;
    ALTER TABLE student_excuses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_excuses FORCE ROW LEVEL SECURITY;
    ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE message_logs FORCE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='almadar_accounts' AND policyname='almadar_accounts_school_scope') THEN
        CREATE POLICY almadar_accounts_school_scope ON almadar_accounts USING (school_id=current_setting('app.school_id',true)::uuid) WITH CHECK (school_id=current_setting('app.school_id',true)::uuid);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='student_excuses' AND policyname='student_excuses_school_scope') THEN
        CREATE POLICY student_excuses_school_scope ON student_excuses USING (school_id=current_setting('app.school_id',true)::uuid) WITH CHECK (school_id=current_setting('app.school_id',true)::uuid);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='message_logs' AND policyname='message_logs_school_scope') THEN
        CREATE POLICY message_logs_school_scope ON message_logs USING (school_id=current_setting('app.school_id',true)::uuid) WITH CHECK (school_id=current_setting('app.school_id',true)::uuid);
      END IF;
    END $$;
  `)
}

export async function handleFeatureRequest(context) {
  const { req, res, url, user, pool, body, json, scoped, todayRiyadh } = context
  const adminOnly = () => user.role === 'admin'

  if (req.method === 'POST' && url.pathname === '/api/attendance/bulk') {
    const input = await body(req)
    const studentIds = Array.isArray(input.studentIds) ? [...new Set(input.studentIds.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 500) : []
    if (!studentIds.length || !['present', 'late'].includes(input.status)) { json(res, 400, { error: 'invalid_attendance' }); return true }
    const result = await scoped(user.school_id, async client => {
      const active = (await client.query('SELECT id FROM students WHERE active=true AND id=ANY($1::text[])', [studentIds])).rows.map(row => row.id)
      const created = (await client.query(`INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_by,status)
        SELECT $1,value,$2,$3,$4 FROM unnest($5::text[]) AS value
        ON CONFLICT(school_id,student_id,attendance_date) DO NOTHING RETURNING student_id`, [user.school_id, todayRiyadh(), user.user_id, input.status, active])).rows.map(row => row.student_id)
      return { created, duplicates: active.filter(id => !created.includes(id)), missing: studentIds.filter(id => !active.includes(id)) }
    })
    json(res, 200, { ok: true, ...result })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/almadar') {
    const account = await accountForSchool(user.school_id, scoped)
    json(res, 200, { account: account ? { configured: true, senderName: account.sender_name, lastBalance: account.last_balance, verifiedAt: account.verified_at, updatedAt: account.updated_at } : { configured: false } })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/almadar') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const username = String(input.username || '').trim()
    const password = String(input.password || '')
    const apiKey = String(input.apiKey || '').trim()
    const senderName = String(input.senderName || '').trim()
    if (!senderName || senderName.length > 60 || username.length > 160 || password.length > 300 || apiKey.length > 1000) { json(res, 400, { error: 'invalid_almadar_settings' }); return true }
    const existing = await accountForSchool(user.school_id, scoped)
    if (!existing && (!username || !password || !apiKey)) { json(res, 400, { error: 'almadar_credentials_required' }); return true }
    await scoped(user.school_id, async client => client.query(`INSERT INTO almadar_accounts(school_id,username_encrypted,password_encrypted,api_key_encrypted,sender_name,updated_at)
      VALUES($1,$2,$3,$4,$5,now())
      ON CONFLICT(school_id) DO UPDATE SET username_encrypted=EXCLUDED.username_encrypted,password_encrypted=EXCLUDED.password_encrypted,api_key_encrypted=EXCLUDED.api_key_encrypted,sender_name=EXCLUDED.sender_name,updated_at=now()`, [
      user.school_id,
      username ? encrypt(username) : existing.username_encrypted,
      password ? encrypt(password) : existing.password_encrypted,
      apiKey ? encrypt(apiKey) : existing.api_key_encrypted,
      senderName,
    ]))
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/almadar/verify') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const account = await accountForSchool(user.school_id, scoped)
    if (!account) { json(res, 404, { error: 'almadar_not_configured' }); return true }
    const result = await requestBalance(decrypt(account.api_key_encrypted))
    if (!result.ok) { json(res, 400, result); return true }
    await scoped(user.school_id, async client => client.query('UPDATE almadar_accounts SET last_balance=$1,verified_at=now(),updated_at=now() WHERE school_id=$2', [result.balance === null ? null : String(result.balance), user.school_id]))
    json(res, 200, { ok: true, balance: result.balance })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/excuses') {
    const result = await scoped(user.school_id, async client => client.query(`SELECT e.id,e.student_id AS "studentId",s.name,s.grade,s.classroom,e.category,e.note,to_char(e.start_date,'YYYY-MM-DD') AS "startDate",to_char(e.end_date,'YYYY-MM-DD') AS "endDate",e.created_at AS "createdAt"
      FROM student_excuses e JOIN students s ON s.school_id=e.school_id AND s.id=e.student_id ORDER BY e.start_date DESC,s.name`))
    json(res, 200, { excuses: result.rows })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/excuses') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const studentId = String(input.studentId || '').trim()
    const category = String(input.category || 'عذر').trim().slice(0, 80)
    const note = String(input.note || '').trim().slice(0, 1000)
    const startDate = validDate(input.startDate)
    const endDate = input.endDate ? validDate(input.endDate) : null
    if (!studentId || !startDate || (input.endDate && !endDate) || (endDate && endDate < startDate)) { json(res, 400, { error: 'invalid_excuse' }); return true }
    const result = await scoped(user.school_id, async client => client.query(`INSERT INTO student_excuses(school_id,student_id,category,note,start_date,end_date,created_by)
      SELECT $1,id,$2,$3,$4,$5,$6 FROM students WHERE id=$7 AND active=true RETURNING id`, [user.school_id, category || 'عذر', note, startDate, endDate, user.user_id, studentId]))
    if (!result.rowCount) { json(res, 404, { error: 'student_not_found' }); return true }
    json(res, 201, { ok: true, id: result.rows[0].id })
    return true
  }

  if (req.method === 'DELETE' && url.pathname === '/api/excuses') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const id = String(url.searchParams.get('id') || '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) { json(res, 400, { error: 'invalid_excuse' }); return true }
    await scoped(user.school_id, async client => client.query('DELETE FROM student_excuses WHERE id=$1', [id]))
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/reports/absences') {
    const today = todayRiyadh()
    const to = validDate(url.searchParams.get('to')) || today
    const from = validDate(url.searchParams.get('from')) || to
    if (from > to || workingDates(from, to).length > 366) { json(res, 400, { error: 'invalid_report_range' }); return true }
    const report = await absenceData({ schoolId: user.school_id, from, to: to > today ? today : to, studentId: String(url.searchParams.get('studentId') || '').trim(), scoped })
    json(res, 200, report)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/messages') {
    const result = await scoped(user.school_id, async client => client.query(`SELECT id,student_id AS "studentId",student_name AS "studentName",recipient,sender_name AS "senderName",message_type AS type,message_body AS body,status,error_detail AS "errorDetail",created_at AS "createdAt"
      FROM message_logs ORDER BY created_at DESC LIMIT 200`))
    json(res, 200, { messages: result.rows })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/messages/send') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const type = ['late', 'absence', 'general'].includes(input.type) ? input.type : null
    const studentIds = Array.isArray(input.studentIds) ? [...new Set(input.studentIds.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 300) : []
    const message = String(input.message || '').trim().slice(0, 1200)
    if (!type || !studentIds.length || (type === 'general' && !message)) { json(res, 400, { error: 'invalid_message' }); return true }
    const account = await accountForSchool(user.school_id, scoped)
    if (!account) { json(res, 400, { error: 'almadar_not_configured' }); return true }
    const school = await pool.query('SELECT name FROM schools WHERE id=$1', [user.school_id])
    const result = await scoped(user.school_id, async client => {
      const students = (await client.query('SELECT id,name,phone,grade,classroom FROM students WHERE active=true AND id=ANY($1::text[]) ORDER BY name', [studentIds])).rows
      const late = type === 'late' ? (await client.query(`SELECT student_id,to_char(recorded_at AT TIME ZONE $2,'HH24:MI:SS') AS time FROM attendance_logs WHERE attendance_date=$1 AND status='late' AND student_id=ANY($3::text[])`, [todayRiyadh(), RIYADH_TIME_ZONE, studentIds])).rows : []
      const lateTimes = new Map(late.map(row => [row.student_id, row.time]))
      const apiKey = decrypt(account.api_key_encrypted)
      const rows = []
      for (const student of students) {
        const recipient = normalizePhone(student.phone)
        const messageBody = type === 'general' ? message : automaticText(type, student, school.rows[0]?.name || '', todayRiyadh(), lateTimes.get(student.id) || '')
        let outcome
        if (!recipient) outcome = { ok: false, error: 'invalid_recipient_phone' }
        else if (type === 'late' && !lateTimes.has(student.id)) outcome = { ok: false, error: 'student_not_late_today' }
        else outcome = await sendMessage(apiKey, { number: recipient, senderName: account.sender_name, sendAtOption: 'Now', messageBody, allow_duplicate: type !== 'general' })
        await client.query(`INSERT INTO message_logs(school_id,student_id,student_name,recipient,sender_name,message_type,message_body,status,error_detail,sent_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [user.school_id, student.id, student.name, recipient || String(student.phone || ''), account.sender_name, type, messageBody, outcome.ok ? 'sent' : 'failed', outcome.ok ? '' : outcome.error, user.user_id])
        rows.push({ studentId: student.id, ok: outcome.ok })
      }
      return rows
    })
    json(res, 200, { ok: true, sent: result.filter(row => row.ok).length, failed: result.filter(row => !row.ok).length })
    return true
  }

  return false
}
