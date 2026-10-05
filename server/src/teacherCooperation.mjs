const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validId(value) { return UUID.test(String(value || '')) }
function clean(value, limit = 500) { return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, limit) }
function normalizeStudentId(value) { return clean(value, 200).replace(/^([+-]?\d+)\.0+$/, '$1').toLowerCase() }
function riyadhClock() {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const date = `${values.year}-${values.month}-${values.day}`
  const utcDay = new Date(`${date}T12:00:00Z`).getUTCDay()
  return { date, time: `${values.hour}:${values.minute}:${values.second}`, hm: `${values.hour}:${values.minute}`, weekday: utcDay === 0 ? 1 : utcDay + 1 }
}
function barcodeCandidates(raw) {
  const code = clean(raw, 500)
  if (!code) return []
  const values = [code]
  const match = code.replace(/\\/g, '/').match(/(?:^|\/)student_barcodes\/([^/]+)\.png$/i)
  if (match?.[1]) values.push(match[1])
  return [...new Set(values.map(value => clean(value, 200)).filter(Boolean))]
}

async function cooperationWindow(client, schoolId, clock) {
  const slots = (await client.query(`SELECT period_number AS "periodNumber",to_char(starts_at,'HH24:MI') AS "startTime",to_char(ends_at,'HH24:MI') AS "endTime"
    FROM lesson_time_slots WHERE school_id=$1 AND weekday=$2 AND period_number IN (1,2) ORDER BY period_number`, [schoolId, clock.weekday])).rows
    .map(row => ({ ...row, periodNumber: Number(row.periodNumber) }))
  if (!slots.length) return { configured: false, available: false, activePeriod: null, windowStart: '', windowEnd: '', periods: [] }
  const first = slots[0]
  const last = slots[slots.length - 1]
  const available = clock.hm >= first.startTime && clock.hm < last.endTime
  const firstPeriod = slots.find(slot => slot.periodNumber === 1)
  const activePeriod = available ? (firstPeriod && clock.hm < firstPeriod.endTime ? 1 : slots.some(slot => slot.periodNumber === 2) ? 2 : first.periodNumber) : null
  return { configured: true, available, activePeriod, windowStart: first.startTime, windowEnd: last.endTime, periods: slots }
}

async function todayContributors(client, schoolId, date) {
  return (await client.query(`SELECT teacher_id AS "teacherId",teacher_name AS name,COUNT(*)::int AS count,
      to_char(MIN(recorded_at) AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS "firstTime",
      to_char(MAX(recorded_at) AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS "lastTime"
    FROM teacher_attendance_contributions WHERE school_id=$1 AND attendance_date=$2
    GROUP BY teacher_id,teacher_name ORDER BY MIN(recorded_at),teacher_name`, [schoolId, date])).rows
}

export async function migrateTeacherCooperation(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS teacher_attendance_contributions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE RESTRICT,
      teacher_name text NOT NULL,
      student_id text NOT NULL,
      student_name text NOT NULL,
      attendance_date date NOT NULL,
      period_number smallint NOT NULL CHECK (period_number IN (1,2)),
      attendance_status text NOT NULL CHECK (attendance_status IN ('present','late')),
      attendance_log_id uuid NOT NULL REFERENCES attendance_logs(id) ON DELETE CASCADE,
      recorded_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      recorded_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,student_id,attendance_date),
      UNIQUE (attendance_log_id)
    );
    CREATE INDEX IF NOT EXISTS teacher_cooperation_school_date ON teacher_attendance_contributions(school_id,attendance_date DESC,recorded_at DESC);
    CREATE INDEX IF NOT EXISTS teacher_cooperation_teacher_date ON teacher_attendance_contributions(school_id,teacher_id,attendance_date DESC);
  `)
}

export async function handleTeacherCooperationRequest({ req, res, url, user, body, json, scoped }) {
  if (!url.pathname.startsWith('/api/teacher-cooperation')) return false
  const isTeacher = user.role === 'teacher' && validId(user.teacher_id)
  const isSchool = user.role === 'admin' || user.role === 'staff'

  if (req.method === 'GET' && url.pathname === '/api/teacher-cooperation/status') {
    if (!isTeacher) { json(res, 403, { error: 'forbidden' }); return true }
    const clock = riyadhClock()
    const result = await scoped(user.school_id, async client => {
      const window = await cooperationWindow(client, user.school_id, clock)
      const contributors = await todayContributors(client, user.school_id, clock.date)
      const recent = window.available ? (await client.query(`SELECT c.id,c.student_id AS "studentId",c.student_name AS "studentName",s.grade,s.classroom,
          c.period_number AS "periodNumber",c.attendance_status AS status,to_char(c.recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time
        FROM teacher_attendance_contributions c JOIN students s ON s.school_id=c.school_id AND s.id=c.student_id
        WHERE c.school_id=$1 AND c.teacher_id=$2 AND c.attendance_date=$3 ORDER BY c.recorded_at DESC LIMIT 100`, [user.school_id, user.teacher_id, clock.date])).rows : []
      return { date: clock.date, ...window, contributors, ownCount: contributors.find(item => item.teacherId === user.teacher_id)?.count || 0, recent }
    })
    json(res, 200, result)
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/teacher-cooperation/scan') {
    if (!isTeacher) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const candidates = barcodeCandidates(input.code)
    if (!candidates.length) { json(res, 400, { error: 'invalid_barcode' }); return true }
    const clock = riyadhClock()
    const result = await scoped(user.school_id, async client => {
      const window = await cooperationWindow(client, user.school_id, clock)
      if (!window.available || !window.activePeriod) return { error: 'cooperation_closed', window }
      const wanted = new Set(candidates.map(normalizeStudentId))
      const students = (await client.query('SELECT id,name,grade,classroom FROM students WHERE school_id=$1 AND active=true', [user.school_id])).rows
      const student = students.find(row => wanted.has(normalizeStudentId(row.id)))
      if (!student) return { error: 'student_not_found' }
      const existing = await client.query(`SELECT a.status,to_char(a.recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time
        FROM attendance_logs a WHERE a.school_id=$1 AND a.student_id=$2 AND a.attendance_date=$3`, [user.school_id, student.id, clock.date])
      if (existing.rowCount) return { outcome: 'duplicate', student, attendance: existing.rows[0], periodNumber: window.activePeriod }
      const teacher = await client.query('SELECT full_name AS name FROM lesson_teachers WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, user.teacher_id])
      if (!teacher.rowCount) return { error: 'teacher_account_not_ready' }
      const school = await client.query('SELECT preferences FROM schools WHERE id=$1', [user.school_id])
      const preferences = school.rows[0]?.preferences && typeof school.rows[0].preferences === 'object' ? school.rows[0].preferences : {}
      const mode = ['present', 'late', 'auto'].includes(preferences.attendanceMode) ? preferences.attendanceMode : 'auto'
      const cutoff = /^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.cutoffTime || '') ? preferences.cutoffTime : '07:30'
      const status = mode === 'late' ? 'late' : mode === 'present' ? 'present' : clock.hm > cutoff ? 'late' : 'present'
      const inserted = await client.query(`INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_by,status)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,student_id,attendance_date) DO NOTHING
        RETURNING id,status,to_char(recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time`, [user.school_id, student.id, clock.date, user.user_id, status])
      if (!inserted.rowCount) {
        const race = await client.query(`SELECT status,to_char(recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time
          FROM attendance_logs WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3`, [user.school_id, student.id, clock.date])
        return { outcome: 'duplicate', student, attendance: race.rows[0], periodNumber: window.activePeriod }
      }
      await client.query('DELETE FROM absence_records WHERE school_id=$1 AND student_id=$2 AND absence_date=$3', [user.school_id, student.id, clock.date])
      await client.query(`INSERT INTO teacher_attendance_contributions(school_id,teacher_id,teacher_name,student_id,student_name,attendance_date,period_number,attendance_status,attendance_log_id,recorded_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [user.school_id, user.teacher_id, teacher.rows[0].name, student.id, student.name, clock.date, window.activePeriod, status, inserted.rows[0].id, user.user_id])
      return { outcome: 'created', student, attendance: inserted.rows[0], periodNumber: window.activePeriod }
    })
    if (result.error) {
      const status = result.error === 'student_not_found' ? 404 : result.error === 'cooperation_closed' ? 409 : 400
      json(res, status, result)
      return true
    }
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/teacher-cooperation/report') {
    if (!isSchool) { json(res, 403, { error: 'forbidden' }); return true }
    const clock = riyadhClock()
    const from = DATE.test(url.searchParams.get('from') || '') ? url.searchParams.get('from') : clock.date
    const to = DATE.test(url.searchParams.get('to') || '') ? url.searchParams.get('to') : clock.date
    const teacherId = validId(url.searchParams.get('teacherId')) ? url.searchParams.get('teacherId') : ''
    const periodNumber = [1, 2].includes(Number(url.searchParams.get('periodNumber'))) ? Number(url.searchParams.get('periodNumber')) : 0
    const result = await scoped(user.school_id, async client => {
      const values = [user.school_id, from, to]
      const where = ['c.school_id=$1', 'c.attendance_date BETWEEN $2 AND $3']
      if (teacherId) { values.push(teacherId); where.push(`c.teacher_id=$${values.length}`) }
      if (periodNumber) { values.push(periodNumber); where.push(`c.period_number=$${values.length}`) }
      const school = await client.query('SELECT name,principal_name AS "principalName" FROM schools WHERE id=$1', [user.school_id])
      const entries = (await client.query(`SELECT c.id,c.teacher_id AS "teacherId",c.teacher_name AS "teacherName",c.student_id AS "studentId",c.student_name AS "studentName",
          s.grade,s.classroom,to_char(c.attendance_date,'YYYY-MM-DD') AS date,c.period_number AS "periodNumber",c.attendance_status AS status,
          to_char(c.recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time
        FROM teacher_attendance_contributions c JOIN students s ON s.school_id=c.school_id AND s.id=c.student_id
        WHERE ${where.join(' AND ')} ORDER BY c.attendance_date DESC,c.recorded_at DESC LIMIT 10000`, values)).rows
      const teachers = (await client.query(`SELECT DISTINCT teacher_id AS "teacherId",teacher_name AS name FROM teacher_attendance_contributions
        WHERE school_id=$1 ORDER BY teacher_name`, [user.school_id])).rows
      return { schoolName: school.rows[0]?.name || '', principalName: school.rows[0]?.principalName || '', entries, teachers }
    })
    json(res, 200, result)
    return true
  }

  json(res, 404, { error: 'not_found' })
  return true
}
