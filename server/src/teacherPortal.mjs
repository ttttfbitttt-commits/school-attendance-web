import crypto from 'node:crypto'

const NOTE_OPTIONS = new Set(['هروب من الحصة', 'نائم أثناء الدرس', 'لم يحل الواجب', 'عدم التفاعل والمشاركة', 'مشارك فعال', 'لم يحضر الكتاب أو أوراق العمل', 'استخدام الجوال أثناء الحصة', 'الحديث مع زملائه أثناء الدرس'])
const ATTENDANCE_OPTIONS = new Set(['present', 'absent'])
const SHEET_TYPES = new Set(['followup', 'homework', 'tests'])
const SHEET_OPEN_TYPES = new Set([...SHEET_TYPES, 'combined'])
const SHEET_FIELD_TYPES = new Set(['score', 'text', 'choice', 'boolean'])

function clean(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function validId(value) { return /^[0-9a-f-]{36}$/i.test(String(value || '')) }
function validDate(value) {
  const date = String(value || '')
  const parsed = new Date(`${date}T12:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null
}
function weekdayForDate(value) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay()
  return day === 0 ? 1 : day + 1
}
function validPeriod(value) {
  const period = Number(value)
  return Number.isInteger(period) && period >= 1 && period <= 12 ? period : null
}
function cleanSheetColumns(value) {
  if (!Array.isArray(value) || value.length > 30) return null
  const columns = value.map((column, index) => {
    const label = clean(column?.label, 120)
    const type = String(column?.type || '')
    const maxScore = column?.maxScore === null || column?.maxScore === undefined || column?.maxScore === '' ? null : Number(column.maxScore)
    const choices = Array.isArray(column?.choices) ? column.choices.map(choice => clean(choice, 80)).filter(Boolean).slice(0, 20) : []
    if (!label || !SHEET_FIELD_TYPES.has(type) || (maxScore !== null && (!Number.isFinite(maxScore) || maxScore < 0 || maxScore > 1000))) return null
    return { id: clean(column?.id, 80) || `column-${index + 1}`, label, type, maxScore, choices }
  })
  return columns.every(Boolean) ? columns : null
}
function cleanSheetValues(columns, value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return Object.fromEntries(columns.map(column => {
    const raw = source[column.id]
    if (column.type === 'score') {
      const score = raw === '' || raw === null || raw === undefined ? '' : Number(raw)
      return [column.id, score === '' || !Number.isFinite(score) ? '' : Math.max(0, Math.min(column.maxScore ?? 1000, score))]
    }
    if (column.type === 'boolean') return [column.id, raw === undefined ? true : raw === true]
    if (column.type === 'choice') return [column.id, column.choices.includes(String(raw || '')) ? String(raw) : '']
    return [column.id, clean(raw, 1000)]
  }))
}
function validSheetType(value) { return SHEET_TYPES.has(String(value || '')) ? String(value) : null }
function validOpenSheetType(value) { return SHEET_OPEN_TYPES.has(String(value || '')) ? String(value) : null }
function classKey(value) {
  return clean(value, 200)
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/(^|\s)(الصف|الفصل|الشعبه|شعبه|الثانوي|المتوسط|الابتدائي)(?=\s|$)/g, '$1')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
}
function temporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(10)
  return Array.from(bytes, byte => alphabet[byte % alphabet.length]).join('')
}

function credentialEncryptionKey() {
  const raw = process.env.TEACHER_CREDENTIAL_ENCRYPTION_KEY || process.env.ALMADAR_ENCRYPTION_KEY || ''
  const key = Buffer.from(String(raw), 'base64url')
  return key.length === 32 ? key : null
}
function encryptTemporaryPassword(value) {
  const key = credentialEncryptionKey()
  if (!key) throw new Error('teacher_credential_encryption_not_configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')
}
function decryptTemporaryPassword(value) {
  const key = credentialEncryptionKey()
  if (!key) throw new Error('teacher_credential_encryption_not_configured')
  const packed = Buffer.from(String(value || ''), 'base64url')
  if (packed.length < 29) return null
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12))
  decipher.setAuthTag(packed.subarray(12, 28))
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8')
}

async function activeImport(client, schoolId) {
  return (await client.query('SELECT id FROM lesson_schedule_imports WHERE school_id=$1 AND is_active=true LIMIT 1', [schoolId])).rows[0] || null
}

async function classroomMapping(client, schoolId, classroomId) {
  const stored = await client.query(`SELECT grade_value AS grade,classroom_value AS classroom,mapping_source AS "mappingSource"
    FROM teacher_classroom_student_maps WHERE school_id=$1 AND classroom_id=$2`, [schoolId, classroomId])
  if (stored.rowCount) return stored.rows[0]

  const classroom = await client.query('SELECT name FROM lesson_classrooms WHERE school_id=$1 AND id=$2 AND active=true', [schoolId, classroomId])
  if (!classroom.rowCount) return null
  const wanted = classKey(classroom.rows[0].name)
  const candidates = (await client.query(`SELECT grade,classroom,COUNT(*)::int AS count FROM students
    WHERE school_id=$1 AND active=true GROUP BY grade,classroom ORDER BY grade,classroom`, [schoolId])).rows
    .map(row => ({ ...row, key: classKey(`${row.grade} ${row.classroom}`) }))
    .filter(row => row.key === wanted)
  if (candidates.length !== 1) return null
  const candidate = candidates[0]
  await client.query(`INSERT INTO teacher_classroom_student_maps(school_id,classroom_id,grade_value,classroom_value,mapping_source)
    VALUES($1,$2,$3,$4,'automatic') ON CONFLICT(school_id,classroom_id) DO NOTHING`, [schoolId, classroomId, candidate.grade, candidate.classroom])
  return { grade: candidate.grade, classroom: candidate.classroom, mappingSource: 'automatic' }
}

async function rosterForClassroom(client, schoolId, classroomId) {
  const mapping = await classroomMapping(client, schoolId, classroomId)
  if (!mapping) return { mapping: null, students: [] }
  const students = (await client.query(`SELECT id,name,phone,grade,classroom FROM students
    WHERE school_id=$1 AND active=true AND grade=$2 AND classroom=$3 ORDER BY name`, [schoolId, mapping.grade, mapping.classroom])).rows
  return { mapping, students }
}

async function reportRows(client, schoolId, filters = {}, teacherId = null) {
  const clauses = ['s.school_id=$1']
  const values = [schoolId]
  const add = value => { values.push(value); return `$${values.length}` }
  if (teacherId) clauses.push(`s.teacher_id=${add(teacherId)}`)
  if (filters.teacherId && validId(filters.teacherId)) clauses.push(`s.teacher_id=${add(filters.teacherId)}`)
  if (filters.date && validDate(filters.date)) clauses.push(`s.session_date=${add(filters.date)}::date`)
  if (filters.from && validDate(filters.from)) clauses.push(`s.session_date>=${add(filters.from)}::date`)
  if (filters.to && validDate(filters.to)) clauses.push(`s.session_date<=${add(filters.to)}::date`)
  if (filters.studentId) clauses.push(`EXISTS (SELECT 1 FROM teacher_lesson_student_records student_filter WHERE student_filter.lesson_session_id=s.id AND student_filter.student_id=${add(filters.studentId)})`)
  if (filters.classroomId && validId(filters.classroomId)) clauses.push(`s.classroom_id=${add(filters.classroomId)}`)
  if (filters.note && NOTE_OPTIONS.has(filters.note)) clauses.push(`EXISTS (SELECT 1 FROM teacher_lesson_student_records filter_record WHERE filter_record.lesson_session_id=s.id AND filter_record.note=${add(filters.note)})`)
  const sessions = (await client.query(`SELECT s.id,to_char(s.session_date,'YYYY-MM-DD') AS date,s.weekday,
      s.period_number AS "periodNumber",s.teacher_id AS "teacherId",s.teacher_name AS "teacherName",s.classroom_name AS classroom,
      s.subject_name AS subject,s.grade_value AS grade,s.classroom_value AS "classroomValue",s.saved_at AS "savedAt",
      COUNT(r.student_id)::int AS "studentsCount",
      COUNT(r.student_id) FILTER (WHERE r.attendance_status='present')::int AS "presentCount",
      COUNT(r.student_id) FILTER (WHERE r.attendance_status='absent')::int AS "absentCount"
    FROM teacher_lesson_sessions s LEFT JOIN teacher_lesson_student_records r ON r.lesson_session_id=s.id
    WHERE ${clauses.join(' AND ')}
    GROUP BY s.id ORDER BY s.session_date DESC,s.period_number DESC,s.saved_at DESC LIMIT 500`, values)).rows
  if (!sessions.length) return []
  const ids = sessions.map(row => row.id)
  const records = (await client.query(`SELECT lesson_session_id AS "sessionId",student_id AS "studentId",student_name AS name,
      grade_value AS grade,classroom_value AS classroom,attendance_status AS status,note
      FROM teacher_lesson_student_records WHERE school_id=$1 AND lesson_session_id=ANY($2::uuid[]) ORDER BY student_name`, [schoolId, ids])).rows
  const requestedStudentId = String(filters.studentId || '')
  const grouped = new Map()
  for (const row of records) {
    if (requestedStudentId && row.studentId !== requestedStudentId) continue
    grouped.set(row.sessionId, [...(grouped.get(row.sessionId) || []), row])
  }
  return sessions.map(row => {
    const sessionRecords = grouped.get(row.id) || []
    return { ...row, weekday: Number(row.weekday), periodNumber: Number(row.periodNumber), studentsCount: requestedStudentId ? sessionRecords.length : Number(row.studentsCount), presentCount: requestedStudentId ? sessionRecords.filter(record => record.status === 'present').length : Number(row.presentCount), absentCount: requestedStudentId ? sessionRecords.filter(record => record.status === 'absent').length : Number(row.absentCount), records: sessionRecords }
  })
}

function teacherAccountSummary(row) {
  return {
    teacherId: row.teacherId,
    name: row.name,
    identityNumber: row.identityNumber,
    assignments: Number(row.assignments || 0),
    accountActive: Boolean(row.accountActive),
    accountCreated: Boolean(row.userId),
    mustChangePassword: Boolean(row.mustChangePassword),
    credentialsAvailable: Boolean(row.credentialsAvailable),
  }
}

export async function migrateTeacherPortal(adminPool) {
  await adminPool.query(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin','staff','teacher'));

    CREATE TABLE IF NOT EXISTS teacher_login_accounts (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identity_number text NOT NULL,
      password_hash text NOT NULL,
      temporary_password_encrypted text,
      active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,teacher_id),
      UNIQUE (school_id,identity_number),
      UNIQUE (school_id,user_id)
    );
    ALTER TABLE teacher_login_accounts ADD COLUMN IF NOT EXISTS temporary_password_encrypted text;
    CREATE INDEX IF NOT EXISTS teacher_login_accounts_identity ON teacher_login_accounts(identity_number) WHERE active=true;

    CREATE TABLE IF NOT EXISTS teacher_classroom_student_maps (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      classroom_id uuid NOT NULL REFERENCES lesson_classrooms(id) ON DELETE CASCADE,
      grade_value text NOT NULL,
      classroom_value text NOT NULL,
      mapping_source text NOT NULL DEFAULT 'automatic' CHECK (mapping_source IN ('automatic','manual')),
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,classroom_id)
    );

    CREATE TABLE IF NOT EXISTS teacher_lesson_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE RESTRICT,
      assignment_id uuid NOT NULL REFERENCES lesson_schedule_assignments(id) ON DELETE RESTRICT,
      classroom_id uuid NOT NULL REFERENCES lesson_classrooms(id) ON DELETE RESTRICT,
      session_date date NOT NULL,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 12),
      teacher_name text NOT NULL,
      classroom_name text NOT NULL,
      subject_name text NOT NULL DEFAULT '',
      grade_value text NOT NULL DEFAULT '',
      classroom_value text NOT NULL DEFAULT '',
      saved_by uuid REFERENCES users(id) ON DELETE SET NULL,
      saved_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,teacher_id,classroom_id,session_date,period_number)
    );
    CREATE INDEX IF NOT EXISTS teacher_lesson_sessions_school_date ON teacher_lesson_sessions(school_id,session_date DESC,teacher_id);

    CREATE TABLE IF NOT EXISTS teacher_lesson_student_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      lesson_session_id uuid NOT NULL REFERENCES teacher_lesson_sessions(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      student_name text NOT NULL,
      grade_value text NOT NULL DEFAULT '',
      classroom_value text NOT NULL DEFAULT '',
      attendance_status text NOT NULL CHECK (attendance_status IN ('present','absent')),
      note text NOT NULL DEFAULT '',
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (lesson_session_id,student_id),
      FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS teacher_lesson_student_records_school_note ON teacher_lesson_student_records(school_id,note) WHERE note <> '';
    CREATE INDEX IF NOT EXISTS teacher_lesson_student_records_school_student ON teacher_lesson_student_records(school_id,student_id,lesson_session_id);

    CREATE TABLE IF NOT EXISTS teacher_sheet_configs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE CASCADE,
      subject_name text NOT NULL,
      version integer NOT NULL CHECK (version > 0),
      columns jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id, teacher_id, subject_name, version)
    );
    ALTER TABLE teacher_sheet_configs ADD COLUMN IF NOT EXISTS sheet_type text NOT NULL DEFAULT 'followup';
    ALTER TABLE teacher_sheet_configs ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
    UPDATE teacher_sheet_configs SET sheet_type='followup' WHERE sheet_type IS NULL OR sheet_type='custom';
    ALTER TABLE teacher_sheet_configs DROP CONSTRAINT IF EXISTS teacher_sheet_configs_school_id_teacher_id_subject_name_version_key;
    ALTER TABLE teacher_sheet_configs DROP CONSTRAINT IF EXISTS teacher_sheet_configs_school_id_teacher_id_subject_name_ver_key;
    CREATE UNIQUE INDEX IF NOT EXISTS teacher_sheet_configs_subject_type_version ON teacher_sheet_configs(school_id,teacher_id,subject_name,sheet_type,version);
    CREATE INDEX IF NOT EXISTS teacher_sheet_configs_current ON teacher_sheet_configs(school_id,teacher_id,subject_name,version DESC);

    CREATE TABLE IF NOT EXISTS teacher_sheet_entries (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      config_id uuid NOT NULL REFERENCES teacher_sheet_configs(id) ON DELETE RESTRICT,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE CASCADE,
      assignment_id uuid NOT NULL REFERENCES lesson_schedule_assignments(id) ON DELETE RESTRICT,
      classroom_id uuid NOT NULL REFERENCES lesson_classrooms(id) ON DELETE RESTRICT,
      entry_date date NOT NULL,
      student_id text NOT NULL,
      values jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,config_id,assignment_id,entry_date,student_id)
    );
    CREATE INDEX IF NOT EXISTS teacher_sheet_entries_lookup ON teacher_sheet_entries(school_id,teacher_id,assignment_id,entry_date);
  `)
  await adminPool.query('ALTER TABLE teacher_lesson_student_records DROP CONSTRAINT IF EXISTS teacher_lesson_student_records_note_check')
  await adminPool.query('ALTER TABLE teacher_lesson_student_records DROP CONSTRAINT IF EXISTS teacher_lesson_student_records_note_check_v2')
  await adminPool.query(`UPDATE teacher_lesson_student_records SET note=CASE note
    WHEN 'هرب' THEN 'هروب من الحصة'
    WHEN 'نائم' THEN 'نائم أثناء الدرس'
    WHEN 'لم يشارك' THEN 'عدم التفاعل والمشاركة'
    WHEN 'لم يحضر الكتاب أو المذكرة' THEN 'لم يحضر الكتاب أو أوراق العمل'
    ELSE note END
    WHERE note IN ('هرب','نائم','لم يشارك','لم يحضر الكتاب أو المذكرة')`)
  await adminPool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='teacher_lesson_student_records'::regclass AND conname='teacher_lesson_student_records_note_check_v3') THEN
      ALTER TABLE teacher_lesson_student_records ADD CONSTRAINT teacher_lesson_student_records_note_check_v3
        CHECK (note IN ('','هروب من الحصة','نائم أثناء الدرس','لم يحل الواجب','عدم التفاعل والمشاركة','مشارك فعال','لم يحضر الكتاب أو أوراق العمل','استخدام الجوال أثناء الحصة','الحديث مع زملائه أثناء الدرس'));
    END IF;
  END $$`)
}

export async function handleTeacherPortalRequest(context) {
  const { req, res, url, user, body, json, scoped, authPool, passwordHash } = context
  if (!url.pathname.startsWith('/api/teacher-portal')) return false

  const adminOnly = () => user.role === 'admin'
  const teacherOnly = () => user.role === 'teacher' && validId(user.teacher_id)

  if (req.method === 'POST' && url.pathname === '/api/teacher-portal/teacher/password') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const password = String(input.password || '')
    if (password.length < 8 || password.length > 200) { json(res, 400, { error: 'invalid_teacher_password' }); return true }
    const hash = passwordHash(password)
    await authPool.query(`UPDATE teacher_login_accounts SET password_hash=$1,must_change_password=false,temporary_password_encrypted=NULL,updated_at=now()
      WHERE school_id=$2 AND teacher_id=$3 AND user_id=$4 AND active=true`, [hash, user.school_id, user.teacher_id, user.user_id])
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.user_id])
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/teacher/sheets') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const sheets = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return []
      const subjects = (await client.query(`SELECT DISTINCT subject_name AS subject
        FROM lesson_schedule_assignments WHERE school_id=$1 AND import_id=$2 AND teacher_id=$3
        AND subject_name IS NOT NULL AND btrim(subject_name) <> '' ORDER BY subject_name`, [user.school_id, active.id, user.teacher_id])).rows
      const configs = (await client.query(`SELECT DISTINCT ON (subject_name,sheet_type) id,subject_name AS subject,sheet_type AS "sheetType",version,columns,created_at AS "createdAt"
        FROM teacher_sheet_configs WHERE school_id=$1 AND teacher_id=$2 AND active=true ORDER BY subject_name,sheet_type,version DESC`, [user.school_id, user.teacher_id])).rows
      const bySubject = new Map()
      for (const config of configs) bySubject.set(config.subject, [...(bySubject.get(config.subject) || []), { ...config, version: Number(config.version) }])
      return subjects.map(subject => ({ subject: subject.subject, configs: bySubject.get(subject.subject) || [] }))
    })
    json(res, 200, { sheets })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/teacher-portal/teacher/sheets/config') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const subject = clean(input.subjectName, 200)
    const sheetType = validSheetType(input.sheetType)
    const columns = cleanSheetColumns(input.columns)
    if (!subject || !sheetType || !columns) { json(res, 400, { error: 'invalid_sheet_config' }); return true }
    const result = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return { error: 'schedule_not_imported' }
      const assigned = await client.query(`SELECT 1 FROM lesson_schedule_assignments
        WHERE school_id=$1 AND import_id=$2 AND teacher_id=$3 AND subject_name=$4 LIMIT 1`, [user.school_id, active.id, user.teacher_id, subject])
      if (!assigned.rowCount) return { error: 'subject_not_assigned' }
      const version = Number((await client.query(`SELECT COALESCE(MAX(version),0)::int AS version FROM teacher_sheet_configs
        WHERE school_id=$1 AND teacher_id=$2 AND subject_name=$3 AND sheet_type=$4`, [user.school_id, user.teacher_id, subject, sheetType])).rows[0].version) + 1
      const config = (await client.query(`INSERT INTO teacher_sheet_configs(school_id,teacher_id,subject_name,sheet_type,version,columns)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id,subject_name AS subject,sheet_type AS "sheetType",version,columns,created_at AS "createdAt"`, [user.school_id, user.teacher_id, subject, sheetType, version, JSON.stringify(columns)])).rows[0]
      return { config: { ...config, version: Number(config.version) } }
    })
    if (result.error) { json(res, result.error === 'subject_not_assigned' ? 403 : 409, result); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'DELETE' && url.pathname === '/api/teacher-portal/teacher/sheets/config') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const subject = clean(url.searchParams.get('subjectName'), 200)
    const sheetType = validSheetType(url.searchParams.get('sheetType'))
    if (!subject || !sheetType) { json(res, 400, { error: 'invalid_sheet_config' }); return true }
    await scoped(user.school_id, client => client.query(`UPDATE teacher_sheet_configs SET active=false
      WHERE school_id=$1 AND teacher_id=$2 AND subject_name=$3 AND sheet_type=$4 AND active=true`, [user.school_id, user.teacher_id, subject, sheetType]))
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/teacher/sheet-report') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const subject = clean(url.searchParams.get('subjectName'), 200)
    const classroomId = String(url.searchParams.get('classroomId') || '')
    const sheetType = validOpenSheetType(url.searchParams.get('sheetType'))
    const from = validDate(url.searchParams.get('from'))
    const to = validDate(url.searchParams.get('to'))
    if (!subject || !validId(classroomId) || !sheetType || (from && to && from > to)) { json(res, 400, { error: 'invalid_sheet_report' }); return true }
    const result = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return { error: 'schedule_not_imported' }
      const assignments = (await client.query(`SELECT a.id FROM lesson_schedule_assignments a
        WHERE a.school_id=$1 AND a.import_id=$2 AND a.teacher_id=$3 AND a.subject_name=$4 AND a.classroom_id=$5`, [user.school_id, active.id, user.teacher_id, subject, classroomId])).rows
      if (!assignments.length) return { error: 'lesson_not_assigned' }
      const requestedTypes = sheetType === 'combined' ? [...SHEET_TYPES] : [sheetType]
      const configs = (await client.query(`SELECT DISTINCT ON (sheet_type) id,sheet_type AS "sheetType",version,columns
        FROM teacher_sheet_configs WHERE school_id=$1 AND teacher_id=$2 AND subject_name=$3 AND sheet_type=ANY($4::text[]) AND active=true
        ORDER BY sheet_type,version DESC`, [user.school_id, user.teacher_id, subject, requestedTypes])).rows
        .sort((left, right) => requestedTypes.indexOf(left.sheetType) - requestedTypes.indexOf(right.sheetType))
      if (!configs.length) return { error: 'sheet_not_configured' }
      const roster = await rosterForClassroom(client, user.school_id, classroomId)
      const entries = (await client.query(`SELECT e.config_id AS "configId",e.student_id AS "studentId",e.values
        FROM teacher_sheet_entries e WHERE e.school_id=$1 AND e.config_id=ANY($2::uuid[]) AND e.assignment_id=ANY($3::uuid[])
        AND ($4::date IS NULL OR e.entry_date >= $4::date) AND ($5::date IS NULL OR e.entry_date <= $5::date)
        ORDER BY e.updated_at DESC`, [user.school_id, configs.map(config => config.id), assignments.map(row => row.id), from, to])).rows
      const typeById = new Map(configs.map(config => [config.id, config.sheetType]))
      const values = new Map()
      for (const entry of entries) {
        const current = values.get(entry.studentId) || {}
        for (const [key, value] of Object.entries(entry.values || {})) { const namespaced = `${typeById.get(entry.configId)}:${key}`; if (!(namespaced in current)) current[namespaced] = value }
        values.set(entry.studentId, current)
      }
      return { subject, sheetType, sections: configs.map(config => ({ sheetType: config.sheetType, version: Number(config.version), columns: config.columns })), classroomId, classroom: roster.mapping?.classroom || '', grade: roster.mapping?.grade || '', students: roster.students.map(student => ({ ...student, values: values.get(student.id) || {} })) }
    })
    if (result.error) { json(res, result.error === 'sheet_not_configured' ? 404 : 409, result); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/teacher/dashboard') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const date = validDate(url.searchParams.get('date')) || new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date())
    const weekday = weekdayForDate(date)
    const result = await scoped(user.school_id, async client => {
      const teacher = await client.query('SELECT full_name AS name,identity_number AS "identityNumber" FROM lesson_teachers WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, user.teacher_id])
      const school = await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])
      const active = await activeImport(client, user.school_id)
      if (!teacher.rowCount || !school.rowCount) return { missing: true }
      const schedule = active ? (await client.query(`SELECT a.id AS "assignmentId",a.classroom_id AS "classroomId",c.name AS classroom,
          a.weekday,a.period_number AS "periodNumber",a.subject_name AS subject,to_char(t.starts_at,'HH24:MI') AS "startTime",to_char(t.ends_at,'HH24:MI') AS "endTime"
        FROM lesson_schedule_assignments a JOIN lesson_classrooms c ON c.id=a.classroom_id AND c.school_id=a.school_id
          LEFT JOIN lesson_time_slots t ON t.school_id=a.school_id AND t.weekday=a.weekday AND t.period_number=a.period_number
        WHERE a.school_id=$1 AND a.import_id=$2 AND a.teacher_id=$3
        ORDER BY a.weekday,a.period_number,c.name`, [user.school_id, active.id, user.teacher_id])).rows : []
      const weekSchedule = schedule.map(row => ({ ...row, weekday: Number(row.weekday), periodNumber: Number(row.periodNumber) }))
      return { schoolName: school.rows[0].name, teacher: teacher.rows[0], date, weekday, schedule: weekSchedule.filter(row => row.weekday === weekday), weekSchedule }
    })
    if (result.missing) { json(res, 404, { error: 'teacher_account_not_ready' }); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/teacher/lesson') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const classroomId = String(url.searchParams.get('classroomId') || '')
    const date = validDate(url.searchParams.get('date'))
    const periodNumber = validPeriod(url.searchParams.get('periodNumber'))
    const sheetType = validOpenSheetType(url.searchParams.get('sheetType')) || 'followup'
    if (!validId(classroomId) || !date || !periodNumber) { json(res, 400, { error: 'invalid_lesson_request' }); return true }
    const weekday = weekdayForDate(date)
    const result = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return { error: 'schedule_not_imported' }
      const assignment = await client.query(`SELECT a.id AS "assignmentId",a.classroom_id AS "classroomId",c.name AS classroom,a.subject_name AS subject
        FROM lesson_schedule_assignments a JOIN lesson_classrooms c ON c.id=a.classroom_id AND c.school_id=a.school_id
        WHERE a.school_id=$1 AND a.import_id=$2 AND a.teacher_id=$3 AND a.classroom_id=$4 AND a.weekday=$5 AND a.period_number=$6`, [user.school_id, active.id, user.teacher_id, classroomId, weekday, periodNumber])
      if (!assignment.rowCount) return { error: 'lesson_not_assigned' }
      const roster = await rosterForClassroom(client, user.school_id, classroomId)
      if (!roster.mapping) {
        const groups = (await client.query(`SELECT grade,classroom,COUNT(*)::int AS count FROM students WHERE school_id=$1 AND active=true GROUP BY grade,classroom ORDER BY grade,classroom`, [user.school_id])).rows
        return { error: 'classroom_student_mapping_needed', classroom: assignment.rows[0].classroom, candidateGroups: groups }
      }
      const requestedTypes = sheetType === 'combined' ? [...SHEET_TYPES] : [sheetType]
      const configResult = await client.query(`SELECT DISTINCT ON (sheet_type) id,subject_name AS subject,sheet_type AS "sheetType",version,columns,created_at AS "createdAt"
        FROM teacher_sheet_configs WHERE school_id=$1 AND teacher_id=$2 AND subject_name=$3 AND sheet_type=ANY($4::text[]) AND active=true ORDER BY sheet_type,version DESC`, [user.school_id, user.teacher_id, assignment.rows[0].subject || '', requestedTypes])
      const sheetConfigs = configResult.rows.map(config => ({ ...config, version: Number(config.version) })).sort((left, right) => requestedTypes.indexOf(left.sheetType) - requestedTypes.indexOf(right.sheetType))
      const sheetConfig = sheetConfigs[0] || null
      const saved = await client.query(`SELECT r.student_id AS "studentId",r.attendance_status AS status,r.note FROM teacher_lesson_sessions s
        JOIN teacher_lesson_student_records r ON r.lesson_session_id=s.id
        WHERE s.school_id=$1 AND s.teacher_id=$2 AND s.classroom_id=$3 AND s.session_date=$4 AND s.period_number=$5`, [user.school_id, user.teacher_id, classroomId, date, periodNumber])
      const states = new Map(saved.rows.map(row => [row.studentId, row]))
      const entries = sheetConfigs.length ? (await client.query(`SELECT config_id AS "configId",student_id AS "studentId",values FROM teacher_sheet_entries
        WHERE school_id=$1 AND config_id=ANY($2::uuid[]) AND assignment_id=$3 AND entry_date=$4`, [user.school_id, sheetConfigs.map(config => config.id), assignment.rows[0].assignmentId, date])).rows : []
      const typeById = new Map(sheetConfigs.map(config => [config.id, config.sheetType]))
      const valuesByStudent = new Map()
      for (const entry of entries) valuesByStudent.set(entry.studentId, { ...(valuesByStudent.get(entry.studentId) || {}), ...Object.fromEntries(Object.entries(entry.values || {}).map(([key, value]) => [`${typeById.get(entry.configId)}:${key}`, value])) })
      return { assignment: assignment.rows[0], date, periodNumber, mapping: roster.mapping, sheetConfig, sheetConfigs, students: roster.students.map(student => ({ ...student, status: states.get(student.id)?.status || 'present', note: states.get(student.id)?.note || '', sheetValues: valuesByStudent.get(student.id) || {} })) }
    })
    if (result.error) { json(res, result.error === 'classroom_student_mapping_needed' ? 409 : 404, result); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/teacher-portal/teacher/lesson') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const classroomId = String(input.classroomId || '')
    const date = validDate(input.date)
    const periodNumber = validPeriod(input.periodNumber)
    const sheetType = validOpenSheetType(input.sheetType) || 'followup'
    const submitted = Array.isArray(input.students) ? input.students : []
    if (!validId(classroomId) || !date || !periodNumber || submitted.length > 1500) { json(res, 400, { error: 'invalid_lesson_save' }); return true }
    const weekday = weekdayForDate(date)
    const result = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return { error: 'schedule_not_imported' }
      const [teacher, assignment] = await Promise.all([
        client.query('SELECT full_name AS name FROM lesson_teachers WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, user.teacher_id]),
        client.query(`SELECT a.id,c.name AS classroom,a.subject_name AS subject FROM lesson_schedule_assignments a
          JOIN lesson_classrooms c ON c.id=a.classroom_id AND c.school_id=a.school_id
          WHERE a.school_id=$1 AND a.import_id=$2 AND a.teacher_id=$3 AND a.classroom_id=$4 AND a.weekday=$5 AND a.period_number=$6`, [user.school_id, active.id, user.teacher_id, classroomId, weekday, periodNumber]),
      ])
      if (!teacher.rowCount || !assignment.rowCount) return { error: 'lesson_not_assigned' }
      const roster = await rosterForClassroom(client, user.school_id, classroomId)
      if (!roster.mapping) return { error: 'classroom_student_mapping_needed' }
      const requestedTypes = sheetType === 'combined' ? [...SHEET_TYPES] : [sheetType]
      const configResult = await client.query(`SELECT id,sheet_type AS "sheetType",columns FROM teacher_sheet_configs
        WHERE school_id=$1 AND teacher_id=$2 AND subject_name=$3 AND sheet_type=ANY($4::text[]) AND active=true ORDER BY version DESC`, [user.school_id, user.teacher_id, assignment.rows[0].subject || '', requestedTypes])
      const sheetConfigs = []
      for (const config of configResult.rows) if (!sheetConfigs.some(item => item.sheetType === config.sheetType)) sheetConfigs.push(config)
      const sheetConfig = sheetConfigs[0] || null
      const allowed = new Map(roster.students.map(student => [student.id, student]))
      const payload = new Map()
      for (const row of submitted) {
        const studentId = String(row?.studentId || '')
        if (!allowed.has(studentId) || payload.has(studentId)) continue
        const status = ATTENDANCE_OPTIONS.has(row?.status) ? row.status : 'present'
        const note = NOTE_OPTIONS.has(row?.note) ? row.note : ''
        payload.set(studentId, { status, note: status === 'present' ? (note || 'مشارك فعال') : '', sheetValues: row?.sheetValues && typeof row.sheetValues === 'object' ? row.sheetValues : {} })
      }
      for (const student of roster.students) if (!payload.has(student.id)) payload.set(student.id, { status: 'present', note: 'مشارك فعال', sheetValues: {} })
      const session = await client.query(`INSERT INTO teacher_lesson_sessions(
          school_id,teacher_id,assignment_id,classroom_id,session_date,weekday,period_number,teacher_name,classroom_name,subject_name,grade_value,classroom_value,saved_by,saved_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())
        ON CONFLICT(school_id,teacher_id,classroom_id,session_date,period_number) DO UPDATE SET
          assignment_id=EXCLUDED.assignment_id,teacher_name=EXCLUDED.teacher_name,classroom_name=EXCLUDED.classroom_name,subject_name=EXCLUDED.subject_name,
          grade_value=EXCLUDED.grade_value,classroom_value=EXCLUDED.classroom_value,saved_by=EXCLUDED.saved_by,saved_at=now()
        RETURNING id`, [user.school_id, user.teacher_id, assignment.rows[0].id, classroomId, date, weekday, periodNumber,
        teacher.rows[0].name, assignment.rows[0].classroom, assignment.rows[0].subject || '', roster.mapping.grade, roster.mapping.classroom, user.user_id])
      for (const [studentId, value] of payload) {
        const student = allowed.get(studentId)
        await client.query(`INSERT INTO teacher_lesson_student_records(
            school_id,lesson_session_id,student_id,student_name,grade_value,classroom_value,attendance_status,note,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
          ON CONFLICT(lesson_session_id,student_id) DO UPDATE SET attendance_status=EXCLUDED.attendance_status,note=EXCLUDED.note,updated_at=now()`,
          [user.school_id, session.rows[0].id, student.id, student.name, student.grade, student.classroom, value.status, value.note])
        for (const config of sheetConfigs) {
          const prefix = `${config.sheetType}:`
          const prefixedValues = Object.fromEntries(Object.entries(value.sheetValues).filter(([key]) => key.startsWith(prefix)).map(([key, entryValue]) => [key.slice(prefix.length), entryValue]))
          const sourceValues = Object.keys(prefixedValues).length || sheetConfigs.length > 1 ? prefixedValues : value.sheetValues
          const cleanValues = cleanSheetValues(config.columns, sourceValues)
          await client.query(`INSERT INTO teacher_sheet_entries(school_id,config_id,teacher_id,assignment_id,classroom_id,entry_date,student_id,values,updated_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
            ON CONFLICT(school_id,config_id,assignment_id,entry_date,student_id) DO UPDATE SET values=EXCLUDED.values,updated_at=now()`,
            [user.school_id, config.id, user.teacher_id, assignment.rows[0].id, classroomId, date, student.id, JSON.stringify(cleanValues)])
        }
      }
      await client.query('DELETE FROM teacher_lesson_student_records WHERE school_id=$1 AND lesson_session_id=$2 AND student_id <> ALL($3::text[])', [user.school_id, session.rows[0].id, [...payload.keys()]])
      return { saved: payload.size }
    })
    if (result.error) { json(res, 409, result); return true }
    json(res, 200, { ok: true, ...result })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/teacher/reports') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const result = await scoped(user.school_id, client => reportRows(client, user.school_id, Object.fromEntries(url.searchParams), user.teacher_id))
    json(res, 200, { reports: result })
    return true
  }

  if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/admin/overview') {
    const teachers = await scoped(user.school_id, async client => (await client.query(`SELECT t.id AS "teacherId",t.full_name AS name,t.identity_number AS "identityNumber",
      COUNT(DISTINCT a.id)::int AS assignments FROM lesson_teachers t LEFT JOIN lesson_schedule_assignments a
        ON a.school_id=t.school_id AND a.teacher_id=t.id AND a.import_id=(SELECT id FROM lesson_schedule_imports WHERE school_id=t.school_id AND is_active=true LIMIT 1)
      WHERE t.school_id=$1 AND t.active=true GROUP BY t.id,t.full_name,t.identity_number ORDER BY t.full_name`, [user.school_id])).rows)
    const accountRows = (await authPool.query(`SELECT teacher_id AS "teacherId",user_id AS "userId",active AS "accountActive",
      must_change_password AS "mustChangePassword",(temporary_password_encrypted IS NOT NULL) AS "credentialsAvailable"
      FROM teacher_login_accounts WHERE school_id=$1`, [user.school_id])).rows
    const accounts = new Map(accountRows.map(row => [row.teacherId, row]))
    const mappings = await scoped(user.school_id, async client => {
      const classrooms = (await client.query('SELECT id FROM lesson_classrooms WHERE school_id=$1 AND active=true', [user.school_id])).rows
      for (const classroom of classrooms) await classroomMapping(client, user.school_id, classroom.id)
      return (await client.query(`SELECT c.id AS "classroomId",c.name AS classroom,
        m.grade_value AS grade,m.classroom_value AS "classroomValue",m.mapping_source AS "mappingSource"
        FROM lesson_classrooms c LEFT JOIN teacher_classroom_student_maps m ON m.school_id=c.school_id AND m.classroom_id=c.id
        WHERE c.school_id=$1 AND c.active=true ORDER BY c.name`, [user.school_id])).rows
    })
    json(res, 200, { teachers: teachers.map(row => teacherAccountSummary({ ...row, ...(accounts.get(row.teacherId) || {}) })), classroomMappings: mappings })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/admin/credentials') {
    const accountRows = (await authPool.query(`SELECT teacher_id AS "teacherId",identity_number AS "identityNumber",temporary_password_encrypted AS encrypted
      FROM teacher_login_accounts WHERE school_id=$1 AND active=true AND temporary_password_encrypted IS NOT NULL`, [user.school_id])).rows
    const teacherRows = await scoped(user.school_id, async client => (await client.query(`SELECT id,full_name AS name
      FROM lesson_teachers WHERE school_id=$1 AND active=true`, [user.school_id])).rows)
    const names = new Map(teacherRows.map(row => [row.id, row.name]))
    const credentials = accountRows.flatMap(row => {
      const password = decryptTemporaryPassword(row.encrypted)
      return password && names.has(row.teacherId) ? [{ teacherId: row.teacherId, name: names.get(row.teacherId), identityNumber: row.identityNumber, temporaryPassword: password }] : []
    }).sort((first, second) => first.name.localeCompare(second.name, 'ar'))
    json(res, 200, { credentials })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/admin/mapping-options') {
    const options = await scoped(user.school_id, async client => (await client.query(`SELECT grade,classroom,COUNT(*)::int AS count FROM students
      WHERE school_id=$1 AND active=true GROUP BY grade,classroom ORDER BY grade,classroom`, [user.school_id])).rows)
    json(res, 200, { options })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/teacher-portal/admin/classroom-mapping') {
    const input = await body(req)
    const classroomId = String(input.classroomId || '')
    const grade = clean(input.grade, 160)
    const classroom = clean(input.classroom, 160)
    if (!validId(classroomId) || !grade || !classroom) { json(res, 400, { error: 'invalid_classroom_mapping' }); return true }
    const result = await scoped(user.school_id, async client => {
      const exists = await client.query('SELECT 1 FROM lesson_classrooms WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, classroomId])
      const students = await client.query('SELECT COUNT(*)::int AS count FROM students WHERE school_id=$1 AND active=true AND grade=$2 AND classroom=$3', [user.school_id, grade, classroom])
      if (!exists.rowCount || !students.rows[0].count) return false
      await client.query(`INSERT INTO teacher_classroom_student_maps(school_id,classroom_id,grade_value,classroom_value,mapping_source,updated_by,updated_at)
        VALUES($1,$2,$3,$4,'manual',$5,now()) ON CONFLICT(school_id,classroom_id) DO UPDATE SET grade_value=EXCLUDED.grade_value,
          classroom_value=EXCLUDED.classroom_value,mapping_source='manual',updated_by=EXCLUDED.updated_by,updated_at=now()`, [user.school_id, classroomId, grade, classroom, user.user_id])
      return true
    })
    if (!result) { json(res, 404, { error: 'classroom_or_students_not_found' }); return true }
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher-portal/admin/accounts/generate') {
    const input = await body(req)
    const requestedIds = Array.isArray(input.teacherIds) ? input.teacherIds.filter(validId) : []
    const teachers = await scoped(user.school_id, async client => (await client.query(`SELECT t.id AS "teacherId",t.full_name AS name,t.identity_number AS "identityNumber"
      FROM lesson_teachers t WHERE t.school_id=$1 AND t.active=true ${requestedIds.length ? 'AND t.id=ANY($2::uuid[])' : ''}
      ORDER BY t.full_name`, requestedIds.length ? [user.school_id, requestedIds] : [user.school_id])).rows)
    const credentials = []
    for (const teacher of teachers) {
      const existing = await authPool.query('SELECT 1 FROM teacher_login_accounts WHERE school_id=$1 AND teacher_id=$2', [user.school_id, teacher.teacherId])
      if (existing.rowCount) continue
      const password = temporaryPassword()
      const hash = passwordHash(password)
      const encryptedPassword = encryptTemporaryPassword(password)
      const email = `teacher-${user.school_id}-${teacher.teacherId}@local.invalid`
      const savedUser = await authPool.query(`INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3)
        ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name RETURNING id`, [email, hash, teacher.name])
      await authPool.query(`INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,'teacher')
        ON CONFLICT(school_id,user_id) DO UPDATE SET role='teacher'`, [user.school_id, savedUser.rows[0].id])
      await authPool.query(`INSERT INTO teacher_login_accounts(school_id,teacher_id,user_id,identity_number,password_hash,temporary_password_encrypted,active,must_change_password)
        VALUES($1,$2,$3,$4,$5,$6,true,true)`, [user.school_id, teacher.teacherId, savedUser.rows[0].id, teacher.identityNumber, hash, encryptedPassword])
      credentials.push({ teacherId: teacher.teacherId, name: teacher.name, identityNumber: teacher.identityNumber, temporaryPassword: password })
    }
    json(res, 200, { ok: true, credentials, created: credentials.length })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher-portal/admin/accounts/reset') {
    const input = await body(req)
    const teacherId = String(input.teacherId || '')
    if (!validId(teacherId)) { json(res, 400, { error: 'invalid_teacher' }); return true }
    const password = temporaryPassword()
    const hash = passwordHash(password)
    const encryptedPassword = encryptTemporaryPassword(password)
    const changed = await authPool.query(`UPDATE teacher_login_accounts SET password_hash=$1,temporary_password_encrypted=$2,must_change_password=true,active=true,updated_at=now()
      WHERE school_id=$3 AND teacher_id=$4 RETURNING user_id`, [hash, encryptedPassword, user.school_id, teacherId])
    if (!changed.rowCount) { json(res, 404, { error: 'teacher_account_not_found' }); return true }
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, changed.rows[0].user_id])
    await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true, temporaryPassword: password })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher-portal/admin/accounts/bulk-reset') {
    const input = await body(req)
    const teacherIds = Array.isArray(input.teacherIds) ? [...new Set(input.teacherIds.filter(validId))] : []
    if (!teacherIds.length || teacherIds.length > 2000) { json(res, 400, { error: 'invalid_teacher_list' }); return true }
    const teachers = await scoped(user.school_id, async client => (await client.query(`SELECT id AS "teacherId",full_name AS name,identity_number AS "identityNumber"
      FROM lesson_teachers WHERE school_id=$1 AND active=true AND id=ANY($2::uuid[])`, [user.school_id, teacherIds])).rows)
    const credentials = []
    for (const teacher of teachers) {
      const password = temporaryPassword()
      const hash = passwordHash(password)
      const encryptedPassword = encryptTemporaryPassword(password)
      const changed = await authPool.query(`UPDATE teacher_login_accounts SET password_hash=$1,temporary_password_encrypted=$2,must_change_password=true,active=true,updated_at=now()
        WHERE school_id=$3 AND teacher_id=$4 RETURNING user_id`, [hash, encryptedPassword, user.school_id, teacher.teacherId])
      if (!changed.rowCount) continue
      await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, changed.rows[0].user_id])
      await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
      credentials.push({ teacherId: teacher.teacherId, name: teacher.name, identityNumber: teacher.identityNumber, temporaryPassword: password })
    }
    json(res, 200, { ok: true, credentials, reset: credentials.length })
    return true
  }

  if (req.method === 'PATCH' && url.pathname === '/api/teacher-portal/admin/accounts/status') {
    const input = await body(req)
    const teacherId = String(input.teacherId || '')
    if (!validId(teacherId) || typeof input.active !== 'boolean') { json(res, 400, { error: 'invalid_teacher_account_status' }); return true }
    const result = await authPool.query(`UPDATE teacher_login_accounts SET active=$1,updated_at=now()
      WHERE school_id=$2 AND teacher_id=$3 RETURNING user_id`, [input.active, user.school_id, teacherId])
    if (!result.rowCount) { json(res, 404, { error: 'teacher_account_not_found' }); return true }
    if (!input.active) await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [result.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-portal/admin/reports') {
    const filters = Object.fromEntries(url.searchParams)
    const reports = await scoped(user.school_id, client => reportRows(client, user.school_id, filters))
    json(res, 200, { reports })
    return true
  }

  return false
}
