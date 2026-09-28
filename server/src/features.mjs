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
  const parsed = new Date(`${date}T12:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null
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

const ABSENCE_STATUSES = new Set(['unexcused', 'excused', 'special'])
const ATTENDANCE_STATUSES = new Set(['present', 'late'])

function absenceStatus(value) {
  const status = String(value || '').trim()
  return ABSENCE_STATUSES.has(status) ? status : null
}

function attendanceStatus(value) {
  const status = String(value || 'present').trim()
  return ATTENDANCE_STATUSES.has(status) ? status : null
}

function validTime(value) {
  const time = String(value || '')
  return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time) ? time : null
}

function absenceSummaryStatus(row) {
  const presentStatuses = ['unexcused', 'excused', 'special'].filter(status => Number(row[`${status}Days`] || 0) > 0)
  return presentStatuses.length === 1 ? presentStatuses[0] : 'mixed'
}

function reportRange(url, todayRiyadh) {
  const today = todayRiyadh()
  const requestedTo = validDate(url.searchParams.get('to')) || today
  const requestedFrom = validDate(url.searchParams.get('from')) || requestedTo
  const to = requestedTo > today ? today : requestedTo
  if (requestedFrom > to || workingDates(requestedFrom, to).length > 366) return null
  return { from: requestedFrom, to }
}

function absenceRange(input, todayRiyadh) {
  const date = validDate(input.date)
  const from = validDate(input.from) || date
  const to = validDate(input.to) || date
  const today = todayRiyadh()
  if (!from || !to || from > to || to > today || workingDates(from, to).length > 366) return null
  return { from, to }
}

function selectedStudentIds(input) {
  const source = Array.isArray(input.studentIds) ? input.studentIds : input.studentId === undefined ? [] : [input.studentId]
  const ids = [...new Set(source.map(value => String(value || '').trim()).filter(Boolean))]
  return ids.length && ids.length <= 500 ? ids : null
}

function selectedAbsenceDates(input, range) {
  if (input.dates === undefined && input.date === undefined) return { dates: null }
  const source = input.dates === undefined ? [input.date] : input.dates
  if (!Array.isArray(source) || !source.length || source.length > 366) return { invalid: true }
  const parsed = source.map(validDate)
  if (parsed.some(date => !date || date < range.from || date > range.to)) return { invalid: true }
  const dates = [...new Set(parsed)]
  return { dates }
}

async function absenceData({ schoolId, from, to, studentId, scoped }) {
  return scoped(schoolId, async client => {
    const parameters = [schoolId, from, to]
    const studentFilter = studentId ? ` AND a.student_id=$4` : ''
    if (studentId) parameters.push(studentId)
    const result = await client.query(`SELECT
        a.student_id AS "studentId", s.name,s.phone,s.grade,s.classroom,
        COUNT(*)::int AS "absenceDays",
        COUNT(*) FILTER (WHERE a.status='unexcused')::int AS "unexcusedDays",
        COUNT(*) FILTER (WHERE a.status='excused')::int AS "excusedDays",
        COUNT(*) FILTER (WHERE a.status='special')::int AS "specialDays"
      FROM absence_records a
      JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id
      WHERE a.school_id=$1 AND a.absence_date BETWEEN $2 AND $3${studentFilter}
      GROUP BY a.student_id,s.name,s.phone,s.grade,s.classroom
      ORDER BY "absenceDays" DESC,s.name`, parameters)
    const rows = result.rows.map(row => ({
      ...row,
      status: absenceSummaryStatus(row),
      statusCounts: {
        unexcused: Number(row.unexcusedDays || 0),
        excused: Number(row.excusedDays || 0),
        special: Number(row.specialDays || 0),
      },
      // Retained temporarily for callers still reading the old report contract.
      hasExcuse: Number(row.excusedDays || 0) + Number(row.specialDays || 0) > 0,
      excuses: [],
    }))
    const summary = rows.reduce((totals, row) => ({
      absenceDays: totals.absenceDays + Number(row.absenceDays || 0),
      students: totals.students + 1,
      unexcusedDays: totals.unexcusedDays + Number(row.unexcusedDays || 0),
      excusedDays: totals.excusedDays + Number(row.excusedDays || 0),
      specialDays: totals.specialDays + Number(row.specialDays || 0),
    }), { absenceDays: 0, students: 0, unexcusedDays: 0, excusedDays: 0, specialDays: 0 })
    return { from, to, rows, summary, confirmedDays: summary.absenceDays, workingDays: 0 }
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
      message_type text NOT NULL CHECK (message_type IN ('late','absence','general','test')),
      message_body text NOT NULL,
      status text NOT NULL CHECK (status IN ('sent','failed')),
      error_detail text NOT NULL DEFAULT '',
      sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS absence_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      absence_date date NOT NULL,
      status text NOT NULL DEFAULT 'unexcused' CHECK (status IN ('unexcused','excused','special')),
      note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
      calculated_at timestamptz NOT NULL DEFAULT now(),
      calculated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE (school_id,student_id,absence_date),
      FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS absence_corrections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      absence_date date NOT NULL,
      prior_status text NOT NULL CHECK (prior_status IN ('unexcused','excused','special')),
      prior_note text NOT NULL DEFAULT '',
      attendance_status text NOT NULL CHECK (attendance_status IN ('present','late')),
      attendance_time time NOT NULL,
      correction_scope text NOT NULL CHECK (correction_scope IN ('single','bulk')),
      corrected_by uuid REFERENCES users(id) ON DELETE SET NULL,
      corrected_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
    );
    CREATE TABLE IF NOT EXISTS application_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE attendance_logs ADD COLUMN IF NOT EXISTS excuse_status text NOT NULL DEFAULT 'unexcused';
    ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_excuse_status_check;
    ALTER TABLE attendance_logs ADD CONSTRAINT attendance_logs_excuse_status_check CHECK (excuse_status IN ('unexcused','excused'));
    ALTER TABLE message_logs DROP CONSTRAINT IF EXISTS message_logs_message_type_check;
    ALTER TABLE message_logs ADD CONSTRAINT message_logs_message_type_check CHECK (message_type IN ('late','absence','general','test'));
    CREATE INDEX IF NOT EXISTS student_excuses_school_student ON student_excuses(school_id,student_id,start_date DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS student_excuses_unique_period ON student_excuses(school_id,student_id,start_date,COALESCE(end_date,'infinity'::date));
    CREATE INDEX IF NOT EXISTS message_logs_school_created ON message_logs(school_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS absence_records_school_day ON absence_records(school_id,absence_date DESC);
    CREATE INDEX IF NOT EXISTS absence_records_school_student ON absence_records(school_id,student_id,absence_date DESC);
    CREATE INDEX IF NOT EXISTS absence_corrections_school_student ON absence_corrections(school_id,student_id,absence_date DESC);
    CREATE INDEX IF NOT EXISTS attendance_logs_late_history ON attendance_logs(school_id,student_id,attendance_date DESC) WHERE status='late';
    ALTER TABLE almadar_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE almadar_accounts FORCE ROW LEVEL SECURITY;
    ALTER TABLE student_excuses ENABLE ROW LEVEL SECURITY;
    ALTER TABLE student_excuses FORCE ROW LEVEL SECURITY;
    ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
    ALTER TABLE message_logs FORCE ROW LEVEL SECURITY;
    ALTER TABLE absence_records ENABLE ROW LEVEL SECURITY;
    ALTER TABLE absence_records FORCE ROW LEVEL SECURITY;
    ALTER TABLE absence_corrections ENABLE ROW LEVEL SECURITY;
    ALTER TABLE absence_corrections FORCE ROW LEVEL SECURITY;
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
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='absence_records' AND policyname='absence_records_school_scope') THEN
        CREATE POLICY absence_records_school_scope ON absence_records USING (school_id=current_setting('app.school_id',true)::uuid) WITH CHECK (school_id=current_setting('app.school_id',true)::uuid);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='absence_corrections' AND policyname='absence_corrections_school_scope') THEN
        CREATE POLICY absence_corrections_school_scope ON absence_corrections USING (school_id=current_setting('app.school_id',true)::uuid) WITH CHECK (school_id=current_setting('app.school_id',true)::uuid);
      END IF;
    END $$;
  `)

  // The previous report inferred absence from every weekday without attendance.
  // Its only saved per-day records were student_excuses entries. Import their
  // recorded start dates once as explicit, unexcused absence days. The source
  // rows remain intact for audit and no dates are invented during conversion.
  await pool.query(`WITH migration AS (
      INSERT INTO application_migrations(name)
      VALUES ('confirmed_absences_from_legacy_excuses_v1')
      ON CONFLICT (name) DO NOTHING
      RETURNING name
    ), legacy_days AS (
      SELECT DISTINCT ON (e.school_id,e.student_id,e.start_date)
        e.school_id,e.student_id,e.start_date,e.created_at,e.created_by
      FROM student_excuses e
      ORDER BY e.school_id,e.student_id,e.start_date,e.created_at,e.id
    )
    INSERT INTO absence_records(
      school_id,student_id,absence_date,status,note,calculated_at,calculated_by,updated_at,updated_by
    )
    SELECT school_id,student_id,start_date,'unexcused','',created_at,created_by,now(),created_by
    FROM legacy_days
    WHERE EXISTS (SELECT 1 FROM migration)
    ON CONFLICT (school_id,student_id,absence_date) DO NOTHING`)
}

export async function handleFeatureRequest(context) {
  const { req, res, url, user, pool, body, json, scoped, todayRiyadh } = context
  const adminOnly = () => user.role === 'admin'

  if (req.method === 'POST' && url.pathname === '/api/absences/calculate') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const today = todayRiyadh()
    const date = input.date === undefined || input.date === '' ? today : validDate(input.date)
    const day = date ? new Date(`${date}T12:00:00Z`).getUTCDay() : -1
    if (!date || date > today) { json(res, 400, { error: 'invalid_absence_date' }); return true }
    if (day === 5 || day === 6) { json(res, 400, { error: 'not_school_day' }); return true }
    const result = await scoped(user.school_id, async client => {
      // A later present/late mark always wins over a previously confirmed absence.
      const removedForAttendance = await client.query(`DELETE FROM absence_records absence
        USING attendance_logs attendance
        WHERE absence.school_id=attendance.school_id
          AND absence.student_id=attendance.student_id
          AND absence.absence_date=attendance.attendance_date
          AND absence.absence_date=$1
          AND attendance.status IN ('present','late')`, [date])
      const totalActive = await client.query('SELECT COUNT(*)::int AS count FROM students WHERE active=true')
      const attended = await client.query(`SELECT COUNT(DISTINCT attendance.student_id)::int AS count
        FROM attendance_logs attendance JOIN students student ON student.school_id=attendance.school_id AND student.id=attendance.student_id
        WHERE student.active=true AND attendance.attendance_date=$1 AND attendance.status IN ('present','late')`, [date])
      const created = await client.query(`INSERT INTO absence_records(school_id,student_id,absence_date,status,calculated_by,updated_by)
        SELECT $1,student.id,$2,'unexcused',$3,$3
        FROM students student
        WHERE student.active=true
          AND NOT EXISTS (
            SELECT 1 FROM attendance_logs attendance
            WHERE attendance.school_id=student.school_id
              AND attendance.student_id=student.id
              AND attendance.attendance_date=$2
              AND attendance.status IN ('present','late')
          )
        ON CONFLICT(school_id,student_id,absence_date) DO NOTHING
        RETURNING student_id`, [user.school_id, date, user.user_id])
      const confirmed = await client.query('SELECT COUNT(*)::int AS count FROM absence_records WHERE absence_date=$1', [date])
      return {
        totalActive: totalActive.rows[0].count,
        attended: attended.rows[0].count,
        created: created.rowCount,
        alreadyConfirmed: Math.max(0, confirmed.rows[0].count - created.rowCount),
        confirmed: confirmed.rows[0].count,
        removedForAttendance: removedForAttendance.rowCount,
      }
    })
    json(res, 200, { ok: true, date, ...result })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/reports/missing-attendance') {
    const date = validDate(url.searchParams.get('date')) || todayRiyadh()
    if (date !== todayRiyadh()) { json(res, 400, { error: 'missing_attendance_is_today_only' }); return true }
    const rows = await scoped(user.school_id, async client => (await client.query(`SELECT
        s.id AS "studentId",s.name,s.grade,s.classroom,s.phone
      FROM students s
      WHERE s.school_id=$1 AND s.active=true
        AND NOT EXISTS (SELECT 1 FROM attendance_logs a WHERE a.school_id=s.school_id AND a.student_id=s.id AND a.attendance_date=$2)
        AND NOT EXISTS (SELECT 1 FROM absence_records r WHERE r.school_id=s.school_id AND r.student_id=s.id AND r.absence_date=$2)
      ORDER BY s.name`, [user.school_id, date])).rows)
    json(res, 200, { date, rows })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/reports/daily-absences') {
    const date = validDate(url.searchParams.get('date')) || todayRiyadh()
    if (date > todayRiyadh()) { json(res, 400, { error: 'invalid_report_date' }); return true }
    const rows = await scoped(user.school_id, async client => (await client.query(`SELECT
        r.id,r.student_id AS "studentId",s.name,s.grade,s.classroom,s.phone,r.status,r.note,
        to_char(r.absence_date,'YYYY-MM-DD') AS date
      FROM absence_records r JOIN students s ON s.school_id=r.school_id AND s.id=r.student_id
      WHERE r.school_id=$1 AND r.absence_date=$2
      ORDER BY s.name`, [user.school_id, date])).rows)
    json(res, 200, { date, rows })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/reports/daily-lates') {
    const date = validDate(url.searchParams.get('date')) || todayRiyadh()
    if (date > todayRiyadh()) { json(res, 400, { error: 'invalid_report_date' }); return true }
    const rows = await scoped(user.school_id, async client => (await client.query(`SELECT
        a.id,a.student_id AS "studentId",s.name,s.grade,s.classroom,s.phone,a.excuse_status AS status,
        to_char(a.attendance_date,'YYYY-MM-DD') AS date,to_char(a.recorded_at AT TIME ZONE $3,'HH24:MI') AS time
      FROM attendance_logs a JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id
      WHERE a.school_id=$1 AND a.attendance_date=$2 AND a.status='late'
      ORDER BY a.recorded_at,s.name`, [user.school_id, date, RIYADH_TIME_ZONE])).rows)
    json(res, 200, { date, rows })
    return true
  }

  if (req.method === 'PATCH' && url.pathname === '/api/reports/daily-lates/status') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const date = validDate(input.date)
    const studentIds = selectedStudentIds(input)
    const status = ['unexcused', 'excused'].includes(String(input.status)) ? String(input.status) : null
    if (!date || date > todayRiyadh() || !studentIds || !status) { json(res, 400, { error: 'invalid_late_status_update' }); return true }
    const updated = await scoped(user.school_id, async client => (await client.query(`UPDATE attendance_logs
      SET excuse_status=$1
      WHERE school_id=$2 AND attendance_date=$3 AND status='late' AND student_id=ANY($4::text[])
      RETURNING student_id`, [status, user.school_id, date, studentIds])).rowCount)
    json(res, 200, { ok: true, updated })
    return true
  }

  if (req.method === 'GET' && ['/api/reports/absence-summary', '/api/reports/late-summary'].includes(url.pathname)) {
    const isLate = url.pathname.endsWith('late-summary')
    const rawIds = String(url.searchParams.get('studentIds') || '').split(',').map(value => value.trim()).filter(Boolean)
    const studentIds = [...new Set(rawIds)].slice(0, 100)
    const rows = await scoped(user.school_id, async client => (await client.query(`SELECT
        a.student_id AS "studentId",s.name,s.grade,s.classroom,s.phone,
        COUNT(*)::int AS "days",
        COUNT(*) FILTER (WHERE ${isLate ? 'a.excuse_status' : 'a.status'}='excused')::int AS "excusedDays",
        COUNT(*) FILTER (WHERE ${isLate ? 'a.excuse_status' : 'a.status'}='unexcused')::int AS "unexcusedDays"
      FROM ${isLate ? 'attendance_logs' : 'absence_records'} a
      JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id
      WHERE a.school_id=$1 ${isLate ? "AND a.status='late'" : ''} ${studentIds.length ? 'AND a.student_id=ANY($2::text[])' : ''}
      GROUP BY a.student_id,s.name,s.grade,s.classroom,s.phone
      ORDER BY "days" DESC,s.name`, studentIds.length ? [user.school_id, studentIds] : [user.school_id])).rows)
    json(res, 200, { type: isLate ? 'late' : 'absence', rows })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/reports/student-history') {
    const type = url.searchParams.get('type') === 'late' ? 'late' : url.searchParams.get('type') === 'absence' ? 'absence' : null
    const studentId = String(url.searchParams.get('studentId') || '').trim()
    if (!type || !studentId) { json(res, 400, { error: 'invalid_student_history' }); return true }
    const result = await scoped(user.school_id, async client => {
      const student = await client.query('SELECT id AS "studentId",name,grade,classroom,phone FROM students WHERE school_id=$1 AND id=$2', [user.school_id, studentId])
      if (!student.rowCount) return null
      const source = type === 'late' ? `SELECT to_char(attendance_date,'YYYY-MM-DD') AS date,excuse_status AS status,to_char(recorded_at AT TIME ZONE $3,'HH24:MI') AS time FROM attendance_logs WHERE school_id=$1 AND student_id=$2 AND status='late' ORDER BY attendance_date DESC` : `SELECT to_char(absence_date,'YYYY-MM-DD') AS date,status,''::text AS time FROM absence_records WHERE school_id=$1 AND student_id=$2 ORDER BY absence_date DESC`
      const params = type === 'late' ? [user.school_id, studentId, RIYADH_TIME_ZONE] : [user.school_id, studentId]
      const days = await client.query(source, params)
      return { student: student.rows[0], type, days: days.rows }
    })
    if (!result) { json(res, 404, { error: 'student_not_found' }); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/absences/details') {
    const range = reportRange(url, todayRiyadh)
    const studentId = String(url.searchParams.get('studentId') || '').trim()
    if (!range) { json(res, 400, { error: 'invalid_report_range' }); return true }
    if (!studentId) { json(res, 400, { error: 'student_required' }); return true }
    const result = await scoped(user.school_id, async client => {
      const student = await client.query(`SELECT id AS "studentId",name,phone,grade,classroom
        FROM students WHERE school_id=$1 AND id=$2`, [user.school_id, studentId])
      if (!student.rowCount) return null
      const days = await client.query(`SELECT to_char(absence_date,'YYYY-MM-DD') AS date,status,note,
          calculated_at AS "calculatedAt",updated_at AS "updatedAt"
        FROM absence_records WHERE school_id=$1 AND student_id=$2 AND absence_date BETWEEN $3 AND $4
        ORDER BY absence_date DESC`, [user.school_id, studentId, range.from, range.to])
      const statusCounts = days.rows.reduce((counts, row) => ({ ...counts, [row.status]: counts[row.status] + 1 }), { unexcused: 0, excused: 0, special: 0 })
      return { student: student.rows[0], days: days.rows, statusCounts }
    })
    if (!result) { json(res, 404, { error: 'student_not_found' }); return true }
    json(res, 200, { from: range.from, to: range.to, ...result })
    return true
  }

  if (req.method === 'PATCH' && ['/api/absences/status', '/api/absences/status/bulk'].includes(url.pathname)) {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const range = absenceRange(input, todayRiyadh)
    const studentIds = selectedStudentIds(input)
    const status = absenceStatus(input.status)
    const hasNote = Object.prototype.hasOwnProperty.call(input, 'note')
    const note = hasNote ? String(input.note || '').trim().slice(0, 1000) : null
    if (!range || !studentIds || !status || (hasNote && String(input.note || '').trim().length > 1000)) { json(res, 400, { error: 'invalid_absence_status_update' }); return true }
    const result = await scoped(user.school_id, async client => {
      const updated = await client.query(`UPDATE absence_records
        SET status=$1,
            note=CASE WHEN $1='unexcused' THEN '' WHEN $2::text IS NULL THEN note ELSE $2 END,
            updated_at=now(),updated_by=$3
        WHERE school_id=$4 AND student_id=ANY($5::text[]) AND absence_date BETWEEN $6 AND $7
        RETURNING student_id`, [status, note, user.user_id, user.school_id, studentIds, range.from, range.to])
      return { updatedDays: updated.rowCount, affectedStudents: new Set(updated.rows.map(row => row.student_id)).size }
    })
    if (!result.updatedDays) { json(res, 404, { error: 'absence_records_not_found' }); return true }
    json(res, 200, { ok: true, studentIds, from: range.from, to: range.to, status, ...result })
    return true
  }

  if (req.method === 'POST' && ['/api/absences/correct-present', '/api/absences/correct-present/bulk'].includes(url.pathname)) {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const range = absenceRange(input, todayRiyadh)
    const studentIds = selectedStudentIds(input)
    const dateSelection = range ? selectedAbsenceDates(input, range) : { invalid: true }
    const time = validTime(input.time)
    const status = attendanceStatus(input.attendanceStatus || input.status || 'present')
    if (!range || !studentIds || dateSelection.invalid || !time || !status) { json(res, 400, { error: 'invalid_absence_correction' }); return true }
    const correctionScope = studentIds.length === 1 && range.from === range.to && (!dateSelection.dates || dateSelection.dates.length === 1) ? 'single' : 'bulk'
    const result = await scoped(user.school_id, async client => {
      const corrected = await client.query(`WITH removed AS (
          DELETE FROM absence_records
          WHERE school_id=$1 AND absence_date BETWEEN $2 AND $3
            AND student_id=ANY($4::text[])
            AND ($5::date[] IS NULL OR absence_date=ANY($5::date[]))
          RETURNING school_id,student_id,absence_date,status,note
        ), attendance AS (
          INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_at,recorded_by,status)
          SELECT school_id,student_id,absence_date,((absence_date + $6::time) AT TIME ZONE $7),$8,$9
          FROM removed
          ON CONFLICT(school_id,student_id,attendance_date) DO UPDATE
            SET recorded_at=EXCLUDED.recorded_at,recorded_by=EXCLUDED.recorded_by,status=EXCLUDED.status
        ), audit AS (
          INSERT INTO absence_corrections(school_id,student_id,absence_date,prior_status,prior_note,attendance_status,attendance_time,correction_scope,corrected_by)
          SELECT school_id,student_id,absence_date,status,note,$9,$6::time,$10,$8 FROM removed
        )
        SELECT COUNT(*)::int AS "correctedDays",COUNT(DISTINCT student_id)::int AS "affectedStudents" FROM removed`,
      [user.school_id, range.from, range.to, studentIds, dateSelection.dates, time, RIYADH_TIME_ZONE, user.user_id, status, correctionScope])
      return corrected.rows[0]
    })
    if (!result.correctedDays) { json(res, 404, { error: 'absence_records_not_found' }); return true }
    json(res, 200, { ok: true, studentIds, from: range.from, to: range.to, dates: dateSelection.dates, correctionScope, attendance: { status, time }, ...result })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/attendance/bulk') {
    const input = await body(req)
    const studentIds = Array.isArray(input.studentIds) ? [...new Set(input.studentIds.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 500) : []
    if (!studentIds.length || !['present', 'late'].includes(input.status)) { json(res, 400, { error: 'invalid_attendance' }); return true }
    const attendanceDate = todayRiyadh()
    const result = await scoped(user.school_id, async client => {
      const active = (await client.query('SELECT id FROM students WHERE active=true AND id=ANY($1::text[])', [studentIds])).rows.map(row => row.id)
      const removedAbsences = active.length
        ? await client.query(`DELETE FROM absence_records WHERE school_id=$1 AND absence_date=$2 AND student_id=ANY($3::text[])`, [user.school_id, attendanceDate, active])
        : { rowCount: 0 }
      const created = (await client.query(`INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_by,status)
        SELECT $1,value,$2,$3,$4 FROM unnest($5::text[]) AS value
        ON CONFLICT(school_id,student_id,attendance_date) DO NOTHING RETURNING student_id`, [user.school_id, attendanceDate, user.user_id, input.status, active])).rows.map(row => row.student_id)
      return { created, duplicates: active.filter(id => !created.includes(id)), missing: studentIds.filter(id => !active.includes(id)), removedAbsences: removedAbsences.rowCount }
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

  if (req.method === 'POST' && url.pathname === '/api/almadar/test-send') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const recipient = normalizePhone(input.phone)
    if (!recipient) { json(res, 400, { error: 'invalid_test_phone' }); return true }
    const account = await accountForSchool(user.school_id, scoped)
    if (!account) { json(res, 400, { error: 'almadar_not_configured' }); return true }
    const messageBody = 'مرحبا بك في نظام حصر الطلاب'
    const outcome = await sendMessage(decrypt(account.api_key_encrypted), {
      number: recipient,
      senderName: account.sender_name,
      sendAtOption: 'Now',
      messageBody,
      allow_duplicate: true,
    })
    const error = outcome.ok ? '' : outcome.error
    await scoped(user.school_id, async client => client.query(`INSERT INTO message_logs(school_id,student_id,student_name,recipient,sender_name,message_type,message_body,status,error_detail,sent_by)
      VALUES($1,NULL,$2,$3,$4,'test',$5,$6,$7,$8)`, [
      user.school_id,
      'اختبار إعداد حساب المدار',
      recipient,
      account.sender_name,
      messageBody,
      outcome.ok ? 'sent' : 'failed',
      error,
      user.user_id,
    ]))
    if (!outcome.ok) {
      const normalizedError = error.toLowerCase()
      const code = /sender|اسم المرسل/.test(normalizedError)
        ? 'almadar_sender_name_rejected'
        : /balance|رصيد/.test(normalizedError)
          ? 'almadar_insufficient_balance'
          : /unauthor|api key|مفتاح api|مفتاح غير صحيح/.test(normalizedError)
            ? 'api_key_not_authorized'
            : 'almadar_test_send_failed'
      json(res, 400, { error: code })
      return true
    }
    json(res, 200, { ok: true, recipientSuffix: recipient.slice(-4) })
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
    const category = String(input.category || '').trim().slice(0, 80)
    const note = String(input.note || '').trim().slice(0, 1000)
    const startDate = validDate(input.startDate)
    const endDate = input.endDate ? validDate(input.endDate) : null
    if (!studentId || !category || !startDate || (input.endDate && !endDate) || (endDate && endDate < startDate)) { json(res, 400, { error: 'invalid_excuse' }); return true }
    const result = await scoped(user.school_id, async client => {
      const student = await client.query('SELECT 1 FROM students WHERE id=$1 AND active=true', [studentId])
      if (!student.rowCount) return { missing: true }
      const overlap = await client.query(`SELECT id FROM student_excuses
        WHERE student_id=$1 AND start_date <= COALESCE($3::date,'infinity'::date)
          AND COALESCE(end_date,'infinity'::date) >= $2::date LIMIT 1`, [studentId, startDate, endDate])
      if (overlap.rowCount) return { duplicate: true }
      const inserted = await client.query(`INSERT INTO student_excuses(school_id,student_id,category,note,start_date,end_date,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [user.school_id, studentId, category, note, startDate, endDate, user.user_id])
      return { id: inserted.rows[0].id }
    })
    if (result.missing) { json(res, 404, { error: 'student_not_found' }); return true }
    if (result.duplicate) { json(res, 409, { error: 'excuse_period_exists' }); return true }
    json(res, 201, { ok: true, id: result.id })
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
    const range = reportRange(url, todayRiyadh)
    if (!range) { json(res, 400, { error: 'invalid_report_range' }); return true }
    const report = await absenceData({ schoolId: user.school_id, from: range.from, to: range.to, studentId: String(url.searchParams.get('studentId') || '').trim(), scoped })
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
