import crypto from 'node:crypto'
import { gradeScope, studentWellbeingGrades } from './counselorScope.mjs'

const REASONS = {
  health_condition: 'ظرف صحي',
  family_condition: 'ظرف عائلي',
  medical_appointment: 'موعد صحي',
  government_appointment: 'موعد حكومي',
  exam: 'اختبار',
  job_interview: 'مقابلة عمل',
  national_mission: 'مهمة وطنية',
}

const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''))
const clean = (value, maximum = 240) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex')
const publicBaseUrl = () => String(process.env.PUBLIC_APP_URL || 'https://7asr2030.com').replace(/\/$/, '')

function allowed(user) { return ['admin', 'vice_principal', 'counselor'].includes(user?.role) }

function asDate(value) {
  const date = String(value || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ''
}

function reasonLabel(value) { return REASONS[value] || '' }

function requestRow(row, includeSignature = true) {
  return {
    id: row.id,
    studentId: row.studentId,
    studentName: row.studentName,
    guardianPhone: row.guardianPhone,
    grade: row.grade,
    classroom: row.classroom,
    reason: row.reason,
    reasonLabel: reasonLabel(row.reason),
    requestDate: row.requestDate,
    status: row.status,
    createdByName: row.createdByName || '',
    sentByName: row.sentByName || '',
    sentAt: row.sentAt || null,
    createdAt: row.createdAt || null,
    respondedAt: row.respondedAt || null,
    parentDecision: row.parentDecision || null,
    signatureData: includeSignature ? (row.signatureData || '') : undefined,
  }
}

const requestColumns = `r.id,r.student_id AS "studentId",r.student_name AS "studentName",r.guardian_phone AS "guardianPhone",
  r.grade_value AS grade,r.classroom_value AS classroom,r.reason,to_char(r.request_date,'YYYY-MM-DD') AS "requestDate",r.status,
  r.created_by_name AS "createdByName",r.sent_by_name AS "sentByName",
  to_char(r.sent_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "sentAt",
  to_char(r.created_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "createdAt",
  to_char(r.responded_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "respondedAt",
  r.parent_decision AS "parentDecision",r.parent_signature_data AS "signatureData"`
const returningColumns = requestColumns.replaceAll('r.', '')

export async function migrateStudentExcuses(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS student_leave_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      student_name text NOT NULL,
      guardian_phone text NOT NULL DEFAULT '',
      grade_value text NOT NULL DEFAULT '',
      classroom_value text NOT NULL DEFAULT '',
      reason text NOT NULL CHECK (reason IN ('health_condition','family_condition','medical_appointment','government_appointment','exam','job_interview','national_mission')),
      request_date date NOT NULL,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
      access_token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by_name text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
      sent_by_name text NOT NULL DEFAULT '',
      sent_at timestamptz,
      responded_at timestamptz,
      parent_decision text CHECK (parent_decision IN ('approved','rejected')),
      parent_signature_data text NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS student_leave_requests_school_date_idx ON student_leave_requests(school_id,request_date DESC,created_at DESC);
    CREATE INDEX IF NOT EXISTS student_leave_requests_student_idx ON student_leave_requests(school_id,student_id,request_date DESC);
  `)
}

export async function handleStudentExcuseRequest({ req, res, url, user, body, json, scoped, todayRiyadh }) {
  if (!url.pathname.startsWith('/api/student-excuses')) return false
  if (!allowed(user)) { json(res, 403, { error: 'forbidden' }); return true }

  if (req.method === 'GET' && url.pathname === '/api/student-excuses/students') {
    const q = clean(url.searchParams.get('q'), 160)
    if (q.length < 2) { json(res, 200, { students: [] }); return true }
    const result = await scoped(user.school_id, async client => {
      const grades = await studentWellbeingGrades(client, user)
      const tokens = q.split(' ').filter(Boolean).slice(0, 5)
      const values = [user.school_id]
      const search = tokens.map(token => { values.push(`%${token}%`); return `name ILIKE $${values.length}` }).join(' AND ')
      const scopedGrades = gradeScope(values, grades, 'grade')
      return client.query(`SELECT id,name,phone,grade,classroom FROM students
        WHERE school_id=$1 AND active=true AND ${search}${scopedGrades}
        ORDER BY name LIMIT 15`, values)
    })
    json(res, 200, { students: result.rows.map(row => ({ id: row.id, name: row.name, phone: row.phone || '', grade: row.grade, classroom: row.classroom })) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-excuses') {
    const result = await scoped(user.school_id, async client => {
      const grades = await studentWellbeingGrades(client, user)
      const values = [user.school_id]
      const scopedGrades = gradeScope(values, grades, 'r.grade_value')
      return client.query(`SELECT ${requestColumns} FROM student_leave_requests r
        WHERE r.school_id=$1${scopedGrades} ORDER BY r.request_date DESC,r.created_at DESC LIMIT 1000`, values)
    })
    json(res, 200, { requests: result.rows.map(row => requestRow(row)) })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-excuses') {
    const input = await body(req)
    const studentId = clean(input.studentId, 120)
    const reason = clean(input.reason, 64)
    const requestDate = asDate(input.requestDate) || todayRiyadh()
    if (!studentId || !reasonLabel(reason) || !requestDate) { json(res, 400, { error: 'invalid_student_excuse' }); return true }
    const created = await scoped(user.school_id, async client => {
      const grades = await studentWellbeingGrades(client, user)
      const values = [user.school_id, studentId]
      const scopedGrades = gradeScope(values, grades, 'grade')
      const student = await client.query(`SELECT id,name,phone,grade,classroom FROM students
        WHERE school_id=$1 AND id=$2 AND active=true${scopedGrades}`, values)
      if (!student.rowCount) return { error: 'student_not_found' }
      const row = student.rows[0]
      if (!clean(row.phone, 40)) return { error: 'guardian_phone_missing' }
      const token = crypto.randomBytes(32).toString('base64url')
      const saved = await client.query(`INSERT INTO student_leave_requests(
        school_id,student_id,student_name,guardian_phone,grade_value,classroom_value,reason,request_date,access_token_hash,created_by,created_by_name)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING ${returningColumns}`,
      [user.school_id, row.id, row.name, row.phone || '', row.grade, row.classroom, reason, requestDate, tokenHash(token), user.user_id, clean(user.display_name, 160)])
      return { row: saved.rows[0], token }
    })
    if (created.error) { json(res, created.error === 'guardian_phone_missing' ? 422 : 404, { error: created.error }); return true }
    json(res, 201, { request: requestRow(created.row), link: `${publicBaseUrl()}/parent-excuse.html?token=${encodeURIComponent(created.token)}` })
    return true
  }

  const sentMatch = /^\/api\/student-excuses\/([0-9a-f-]{36})\/sent$/i.exec(url.pathname)
  if (req.method === 'POST' && sentMatch) {
    const result = await scoped(user.school_id, async client => {
      const grades = await studentWellbeingGrades(client, user)
      const values = [user.school_id, sentMatch[1], user.user_id, clean(user.display_name, 160)]
      const scopedGrades = gradeScope(values, grades, 'grade_value')
      return client.query(`UPDATE student_leave_requests SET sent_by=$3,sent_by_name=$4,sent_at=now()
        WHERE school_id=$1 AND id=$2${scopedGrades} RETURNING ${returningColumns}`, values)
    })
    if (!result.rowCount) { json(res, 404, { error: 'student_excuse_not_found' }); return true }
    json(res, 200, { request: requestRow(result.rows[0]) })
    return true
  }

  json(res, 404, { error: 'not_found' })
  return true
}

export async function handleStudentExcusePublicRequest({ req, res, url, body, json, publicPool }) {
  if (!url.pathname.startsWith('/api/student-excuses/public')) return false
  const token = clean(url.searchParams.get('token'), 200)
  const hash = token ? tokenHash(token) : ''
  if (!hash) { json(res, 400, { error: 'invalid_link' }); return true }

  if (req.method === 'GET' && url.pathname === '/api/student-excuses/public') {
    const result = await publicPool.query(`SELECT r.id,r.student_name AS "studentName",r.grade_value AS grade,r.classroom_value AS classroom,r.reason,
        to_char(r.request_date,'YYYY-MM-DD') AS "requestDate",r.status,r.parent_decision AS "parentDecision",s.name AS "schoolName"
      FROM student_leave_requests r JOIN schools s ON s.id=r.school_id
      WHERE r.access_token_hash=$1 AND r.expires_at > now()`, [hash])
    if (!result.rowCount) { json(res, 404, { error: 'link_not_found' }); return true }
    const row = result.rows[0]
    const day = new Date(`${row.requestDate}T12:00:00Z`).getUTCDay()
    json(res, 200, { request: { studentName: row.studentName, grade: row.grade, classroom: row.classroom, reason: row.reason, reasonLabel: reasonLabel(row.reason), requestDate: row.requestDate, weekday: WEEKDAYS[day] || '', schoolName: row.schoolName, status: row.status, parentDecision: row.parentDecision || null } })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-excuses/public/respond') {
    const input = await body(req, 1_800_000)
    const decision = clean(input.decision, 16)
    const signatureData = String(input.signatureData || '')
    if (!['approved', 'rejected'].includes(decision) || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureData) || signatureData.length > 1_600_000) {
      json(res, 400, { error: 'invalid_response' }); return true
    }
    const result = await publicPool.query(`UPDATE student_leave_requests SET status=$2,parent_decision=$2,parent_signature_data=$3,responded_at=now()
      WHERE access_token_hash=$1 AND status='pending' AND expires_at > now()
      RETURNING id`, [hash, decision, signatureData])
    if (!result.rowCount) { json(res, 409, { error: 'request_already_completed' }); return true }
    json(res, 200, { ok: true, status: decision })
    return true
  }

  json(res, 405, { error: 'method_not_allowed' })
  return true
}
