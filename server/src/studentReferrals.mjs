import crypto from 'node:crypto'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const REASONS = new Set(['homework', 'disruption', 'late', 'academic_weakness', 'other'])
const STATUSES = new Set(['submitted', 'viewed', 'under_review', 'referred_to_counselor', 'completed', 'cancelled'])

const clean = (value, limit = 2000) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit)
const validId = value => UUID.test(String(value || ''))
const referenceNumber = () => `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()).replaceAll('-', '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
const rowReferral = row => ({
  ...row,
  periodNumber: Number(row.periodNumber),
  referredToCounselor: Boolean(row.referredToCounselor),
  events: Array.isArray(row.events) ? row.events : [],
})

async function addEvent(client, schoolId, referralId, user, eventType, note = '') {
  await client.query(`INSERT INTO student_referral_events(school_id,referral_id,actor_id,actor_role,event_type,note)
    VALUES($1,$2,$3,$4,$5,$6)`, [schoolId, referralId, user.user_id, user.role, eventType, clean(note, 1000)])
}

export async function migrateStudentReferrals(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS student_referrals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      reference_number text NOT NULL,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE RESTRICT,
      teacher_name text NOT NULL,
      student_id text NOT NULL,
      student_name text NOT NULL,
      grade_value text NOT NULL DEFAULT '',
      classroom_value text NOT NULL DEFAULT '',
      classroom_id uuid NOT NULL REFERENCES lesson_classrooms(id) ON DELETE RESTRICT,
      classroom_name text NOT NULL,
      assignment_id uuid NOT NULL REFERENCES lesson_schedule_assignments(id) ON DELETE RESTRICT,
      subject_name text NOT NULL DEFAULT '',
      referral_date date NOT NULL,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 12),
      reason text NOT NULL CHECK (reason IN ('homework','disruption','late','academic_weakness','other')),
      other_reason text NOT NULL DEFAULT '',
      problem_description text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','viewed','under_review','referred_to_counselor','completed','cancelled')),
      referred_to_counselor boolean NOT NULL DEFAULT false,
      vice_action text NOT NULL DEFAULT '',
      vice_principal_name text NOT NULL DEFAULT '',
      counselor_action text NOT NULL DEFAULT '',
      counselor_name text NOT NULL DEFAULT '',
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      viewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      viewed_at timestamptz,
      vice_action_by uuid REFERENCES users(id) ON DELETE SET NULL,
      vice_action_at timestamptz,
      counselor_action_by uuid REFERENCES users(id) ON DELETE SET NULL,
      counselor_action_at timestamptz,
      completed_at timestamptz,
      cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
      cancelled_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,reference_number),
      UNIQUE (school_id,teacher_id,student_id,referral_date,period_number)
    );
    CREATE INDEX IF NOT EXISTS student_referrals_school_status_date ON student_referrals(school_id,status,referral_date DESC);
    CREATE INDEX IF NOT EXISTS student_referrals_teacher_date ON student_referrals(school_id,teacher_id,referral_date DESC);

    CREATE TABLE IF NOT EXISTS student_referral_events (
      id bigserial PRIMARY KEY,
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      referral_id uuid NOT NULL REFERENCES student_referrals(id) ON DELETE CASCADE,
      actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      actor_role text NOT NULL,
      event_type text NOT NULL,
      note text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS student_referral_events_referral ON student_referral_events(school_id,referral_id,created_at);
  `)
  await adminPool.query('ALTER TABLE student_referrals ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL')
  await adminPool.query('ALTER TABLE student_referrals ADD COLUMN IF NOT EXISTS cancelled_at timestamptz')
  await adminPool.query('ALTER TABLE student_referrals DROP CONSTRAINT IF EXISTS student_referrals_status_check')
  await adminPool.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='student_referrals'::regclass AND conname='student_referrals_status_check_v2') THEN
      ALTER TABLE student_referrals ADD CONSTRAINT student_referrals_status_check_v2
        CHECK (status IN ('submitted','viewed','under_review','referred_to_counselor','completed','cancelled'));
    END IF;
  END $$`)
  await adminPool.query("DELETE FROM student_referrals WHERE status='cancelled'")
}

export async function handleStudentReferralRequest({ req, res, url, user, body, json, scoped }) {
  if (!url.pathname.startsWith('/api/student-referrals')) return false
  const isTeacher = user.role === 'teacher' && validId(user.teacher_id)
  const isSchool = user.role === 'admin' || user.role === 'staff'

  if (req.method === 'GET' && url.pathname === '/api/student-referrals') {
    if (!isTeacher && !isSchool) { json(res, 403, { error: 'forbidden' }); return true }
    const filters = Object.fromEntries(url.searchParams)
    const result = await scoped(user.school_id, async client => {
      const values = [user.school_id]
      const where = ["r.school_id=$1", "r.status<>'cancelled'"]
      const add = value => { values.push(value); return `$${values.length}` }
      if (isTeacher) where.push(`r.teacher_id=${add(user.teacher_id)}`)
      if (filters.status && STATUSES.has(filters.status)) where.push(`r.status=${add(filters.status)}`)
      if (DATE.test(filters.from || '')) where.push(`r.referral_date>=${add(filters.from)}`)
      if (DATE.test(filters.to || '')) where.push(`r.referral_date<=${add(filters.to)}`)
      if (isSchool && validId(filters.teacherId)) where.push(`r.teacher_id=${add(filters.teacherId)}`)
      if (filters.q) {
        const query = `%${clean(filters.q, 120)}%`
        where.push(`(r.student_name ILIKE ${add(query)} OR r.student_id ILIKE $${values.length} OR r.teacher_name ILIKE $${values.length} OR r.classroom_name ILIKE $${values.length})`)
      }
      const school = await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])
      const rows = (await client.query(`SELECT r.id,r.reference_number AS "referenceNumber",r.teacher_id AS "teacherId",r.teacher_name AS "teacherName",
        r.student_id AS "studentId",r.student_name AS "studentName",r.grade_value AS grade,r.classroom_value AS classroom,
        r.classroom_id AS "classroomId",r.classroom_name AS "classroomName",r.assignment_id AS "assignmentId",r.subject_name AS subject,
        to_char(r.referral_date,'YYYY-MM-DD') AS date,r.weekday,r.period_number AS "periodNumber",r.reason,r.other_reason AS "otherReason",
        r.problem_description AS "problemDescription",r.status,r.referred_to_counselor AS "referredToCounselor",
        r.vice_action AS "viceAction",r.vice_principal_name AS "vicePrincipalName",r.counselor_action AS "counselorAction",
        r.counselor_name AS "counselorName",r.created_at AS "createdAt",r.viewed_at AS "viewedAt",
        r.vice_action_at AS "viceActionAt",r.counselor_action_at AS "counselorActionAt",r.completed_at AS "completedAt",r.cancelled_at AS "cancelledAt",
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'type',e.event_type,'actorRole',e.actor_role,'note',e.note,'createdAt',e.created_at) ORDER BY e.created_at)
          FROM student_referral_events e WHERE e.school_id=r.school_id AND e.referral_id=r.id),'[]'::jsonb) AS events
        FROM student_referrals r WHERE ${where.join(' AND ')} ORDER BY r.referral_date DESC,r.created_at DESC LIMIT 5000`, values)).rows
      return { schoolName: school.rows[0]?.name || '', referrals: rows.map(rowReferral) }
    })
    json(res, 200, result)
    return true
  }

  const cancelMatch = url.pathname.match(/^\/api\/student-referrals\/([0-9a-f-]+)\/cancel$/i)
  if (req.method === 'POST' && cancelMatch) {
    if (!isTeacher || !validId(cancelMatch[1])) { json(res, 403, { error: 'forbidden' }); return true }
    const cancelled = await scoped(user.school_id, async client => {
      const result = await client.query(`DELETE FROM student_referrals
        WHERE school_id=$1 AND id=$2 AND teacher_id=$3 AND status NOT IN ('completed','cancelled') RETURNING id`,
      [user.school_id, cancelMatch[1], user.teacher_id])
      return Boolean(result.rowCount)
    })
    if (!cancelled) { json(res, 409, { error: 'referral_cannot_be_cancelled' }); return true }
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-referrals') {
    if (!isTeacher) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const assignmentId = String(input.assignmentId || '')
    const classroomId = String(input.classroomId || '')
    const studentId = clean(input.studentId, 120)
    const date = String(input.date || '')
    const periodNumber = Number(input.periodNumber)
    const reason = String(input.reason || '')
    const otherReason = clean(input.otherReason, 240)
    const problemDescription = clean(input.problemDescription, 3000)
    if (!validId(assignmentId) || !validId(classroomId) || !studentId || !DATE.test(date) || !Number.isInteger(periodNumber) || periodNumber < 1 || periodNumber > 12 || !REASONS.has(reason) || (reason === 'other' && !otherReason) || !problemDescription) {
      json(res, 400, { error: 'invalid_referral' }); return true
    }
    const dateWeekday = new Date(`${date}T12:00:00Z`).getUTCDay()
    const weekday = dateWeekday === 0 ? 1 : dateWeekday + 1
    const result = await scoped(user.school_id, async client => {
      const assignment = await client.query(`SELECT a.id,a.classroom_id,c.name AS "classroomName",a.subject_name AS subject,t.full_name AS "teacherName"
        FROM lesson_schedule_assignments a JOIN lesson_classrooms c ON c.school_id=a.school_id AND c.id=a.classroom_id
        JOIN lesson_teachers t ON t.school_id=a.school_id AND t.id=a.teacher_id
        JOIN lesson_schedule_imports i ON i.school_id=a.school_id AND i.id=a.import_id AND i.is_active=true
        WHERE a.school_id=$1 AND a.id=$2 AND a.teacher_id=$3 AND a.classroom_id=$4 AND a.weekday=$5 AND a.period_number=$6`,
      [user.school_id, assignmentId, user.teacher_id, classroomId, weekday, periodNumber])
      if (!assignment.rowCount) return { error: 'lesson_not_assigned' }
      const mapping = await client.query(`SELECT grade_value AS grade,classroom_value AS classroom FROM teacher_classroom_student_maps
        WHERE school_id=$1 AND classroom_id=$2`, [user.school_id, classroomId])
      if (!mapping.rowCount) return { error: 'classroom_student_mapping_needed' }
      const student = await client.query(`SELECT id,name,grade,classroom FROM students WHERE school_id=$1 AND id=$2 AND active=true AND grade=$3 AND classroom=$4`,
        [user.school_id, studentId, mapping.rows[0].grade, mapping.rows[0].classroom])
      if (!student.rowCount) return { error: 'student_not_in_classroom' }
      try {
        const saved = await client.query(`INSERT INTO student_referrals(school_id,reference_number,teacher_id,teacher_name,student_id,student_name,
          grade_value,classroom_value,classroom_id,classroom_name,assignment_id,subject_name,referral_date,weekday,period_number,reason,other_reason,problem_description,created_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [user.school_id, referenceNumber(), user.teacher_id, assignment.rows[0].teacherName, student.rows[0].id, student.rows[0].name,
          student.rows[0].grade, student.rows[0].classroom, classroomId, assignment.rows[0].classroomName, assignmentId,
          assignment.rows[0].subject || '', date, weekday, periodNumber, reason, otherReason, problemDescription, user.user_id])
        await addEvent(client, user.school_id, saved.rows[0].id, user, 'submitted', 'أرسل المعلم الإحالة إلى حساب المدرسة.')
        return { id: saved.rows[0].id }
      } catch (error) {
        if (error?.code === '23505') return { error: 'duplicate_referral' }
        throw error
      }
    })
    if (result.error) { json(res, 409, result); return true }
    json(res, 201, { ok: true, ...result })
    return true
  }

  const viewedMatch = url.pathname.match(/^\/api\/student-referrals\/([0-9a-f-]+)\/viewed$/i)
  if (req.method === 'POST' && viewedMatch) {
    if (!isSchool || !validId(viewedMatch[1])) { json(res, 403, { error: 'forbidden' }); return true }
    const changed = await scoped(user.school_id, async client => {
      const result = await client.query(`UPDATE student_referrals SET status=CASE WHEN status='submitted' THEN 'viewed' ELSE status END,
        viewed_by=COALESCE(viewed_by,$1),viewed_at=COALESCE(viewed_at,now()),updated_at=now() WHERE school_id=$2 AND id=$3 AND viewed_at IS NULL RETURNING id`,
      [user.user_id, user.school_id, viewedMatch[1]])
      if (result.rowCount) await addEvent(client, user.school_id, viewedMatch[1], user, 'viewed', 'تم فتح الإحالة في حساب المدرسة.')
      return Boolean(result.rowCount)
    })
    json(res, 200, { ok: true, changed })
    return true
  }

  const updateMatch = url.pathname.match(/^\/api\/student-referrals\/([0-9a-f-]+)$/i)
  if (req.method === 'PATCH' && updateMatch) {
    if (!isSchool || !validId(updateMatch[1])) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const status = String(input.status || '')
    const viceAction = clean(input.viceAction, 3000)
    const vicePrincipalName = clean(input.vicePrincipalName, 180)
    const counselorAction = clean(input.counselorAction, 3000)
    const counselorName = clean(input.counselorName, 180)
    const referredToCounselor = Boolean(input.referredToCounselor)
    if (!STATUSES.has(status) || status === 'submitted' || status === 'viewed' || status === 'cancelled' || !viceAction || !vicePrincipalName || (status === 'completed' && referredToCounselor && (!counselorAction || !counselorName))) {
      json(res, 400, { error: 'invalid_referral_action' }); return true
    }
    const changed = await scoped(user.school_id, async client => {
      const result = await client.query(`UPDATE student_referrals SET status=$1,referred_to_counselor=$2,vice_action=$3,vice_principal_name=$4,
        counselor_action=$5,counselor_name=$6,viewed_by=COALESCE(viewed_by,$7),viewed_at=COALESCE(viewed_at,now()),
        vice_action_by=$7,vice_action_at=now(),counselor_action_by=CASE WHEN $5<>'' THEN $7 ELSE counselor_action_by END,
        counselor_action_at=CASE WHEN $5<>'' THEN now() ELSE counselor_action_at END,completed_at=CASE WHEN $1='completed' THEN now() ELSE NULL END,updated_at=now()
        WHERE school_id=$8 AND id=$9 AND status <> 'cancelled' RETURNING id`,
      [status, referredToCounselor, viceAction, vicePrincipalName, counselorAction, counselorName, user.user_id, user.school_id, updateMatch[1]])
      if (result.rowCount) await addEvent(client, user.school_id, updateMatch[1], user, status, clean(input.eventNote, 1000) || 'تم تحديث إجراء الإحالة وحالتها.')
      return Boolean(result.rowCount)
    })
    if (!changed) { json(res, 404, { error: 'referral_not_found' }); return true }
    json(res, 200, { ok: true })
    return true
  }

  return false
}
