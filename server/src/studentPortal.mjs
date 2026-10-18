const DEFAULT_STUDENT_PASSWORD = '12345678'
const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''))
const identityNumber = value => String(value ?? '').trim().replace(/\s/g, '').replace(/[^0-9]/g, '')
const clean = (value, max = 200) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const portfolioGenerationJobs = new Map()
const portfolioFileTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
const classroomKey = value => clean(value, 260).normalize('NFKC').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[\u064B-\u065F\u0670ـ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim()
const portfolioFileUrl = (assignmentId, studentId, slotNumber) => `/api/student-portal/portfolio/file?assignmentId=${encodeURIComponent(assignmentId)}&studentId=${encodeURIComponent(studentId)}&slotNumber=${encodeURIComponent(slotNumber)}`

function riyadhClock() {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const date = `${values.year}-${values.month}-${values.day}`
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return { date, hm: `${values.hour}:${values.minute}`, weekday: day === 0 ? 1 : day + 1 }
}

function barcodeCandidates(raw) {
  const code = clean(raw, 500)
  if (!code) return []
  const values = [code]
  const pathMatch = code.replace(/\\/g, '/').match(/(?:^|\/)student_barcodes\/([^/]+)\.png$/i)
  if (pathMatch?.[1]) values.push(pathMatch[1])
  return [...new Set(values.map(value => clean(value, 200).replace(/^([+-]?\d+)\.0+$/, '$1')).filter(Boolean))]
}

async function studentCooperationStatus(client, schoolId, studentId, authorized, clock = riyadhClock()) {
  const student = (await client.query(`SELECT id,name,grade,classroom FROM students
    WHERE school_id=$1 AND id=$2 AND active=true`, [schoolId, studentId])).rows[0]
  const base = { authorized: Boolean(authorized), configured: false, available: false, date: clock.date, windowStart: '', windowEnd: '', classroom: student ? { grade: student.grade, classroom: student.classroom } : null }
  if (!authorized || !student) return { ...base, student: null }
  const slot = (await client.query(`SELECT to_char(starts_at,'HH24:MI') AS "startTime",to_char(ends_at,'HH24:MI') AS "endTime"
    FROM lesson_time_slots WHERE school_id=$1 AND weekday=$2 AND period_number=1 LIMIT 1`, [schoolId, clock.weekday])).rows[0]
  if (!slot) return { ...base, student }
  return { ...base, configured: true, available: clock.hm >= slot.startTime && clock.hm < slot.endTime, windowStart: slot.startTime, windowEnd: slot.endTime, student }
}

async function ensureAutomaticMappings(client, schoolId) {
  const unmapped = (await client.query(`SELECT c.id,c.name FROM lesson_classrooms c LEFT JOIN teacher_classroom_student_maps m
    ON m.school_id=c.school_id AND m.classroom_id=c.id WHERE c.school_id=$1 AND c.active=true AND m.classroom_id IS NULL`, [schoolId])).rows
  if (!unmapped.length) return
  const studentGroups = (await client.query(`SELECT grade,classroom,COUNT(*)::int AS count FROM students
    WHERE school_id=$1 AND active=true GROUP BY grade,classroom`, [schoolId])).rows.map(row => ({ ...row, key: classroomKey(`${row.grade} ${row.classroom}`) }))
  for (const classroom of unmapped) {
    const matches = studentGroups.filter(group => group.key && group.key === classroomKey(classroom.name))
    if (matches.length !== 1) continue
    const match = matches[0]
    await client.query(`INSERT INTO teacher_classroom_student_maps(school_id,classroom_id,grade_value,classroom_value,mapping_source)
      VALUES($1,$2,$3,$4,'automatic') ON CONFLICT(school_id,classroom_id) DO NOTHING`, [schoolId, classroom.id, match.grade, match.classroom])
  }
}

function portfolioSlots(files = []) {
  const bySlot = new Map(files.map(file => [Number(file.slotNumber), file]))
  return Array.from({ length: 10 }, (_, index) => {
    const file = bySlot.get(index + 1)
    return { slotNumber: index + 1, fileUrl: file?.fileUrl || '', fileName: file?.fileName || '', fileType: file?.fileType || '', uploadedAt: file?.uploadedAt || null }
  })
}

function portfolioFile(value, fileName) {
  const data = String(value || '')
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(data)
  if (!match || !portfolioFileTypes.has(match[1])) return null
  const bytes = Buffer.byteLength(match[2], 'base64')
  if (!bytes || bytes > 4_000_000) return null
  const name = clean(fileName, 160).replace(/[^\p{L}\p{N}._() -]/gu, '') || 'ملف مرفوع'
  return { data, name, type: match[1] }
}

function storedPortfolioFile(file, studentId = '') {
  return { ...file, fileUrl: portfolioFileUrl(file.assignmentId, studentId || file.studentId, file.slotNumber) }
}

function sendPortfolioFile(res, file) {
  const match = /^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(file.fileData || ''))
  if (!match || !portfolioFileTypes.has(match[1])) return false
  const data = Buffer.from(match[2], 'base64')
  const type = portfolioFileTypes.has(file.fileType) ? file.fileType : match[1]
  const name = clean(file.fileName, 160).replace(/["\\\r\n]/g, '') || 'ملف-إنجاز'
  const inline = type === 'application/pdf' || type.startsWith('image/')
  res.writeHead(200, {
    'content-type': type,
    'content-length': data.length,
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(data)
  return true
}

function localEmail(schoolId, studentId) {
  return `student-${schoolId}-${Buffer.from(String(studentId)).toString('hex')}@local.invalid`
}

async function assignmentGroups(client, schoolId, mode, teacherId = '') {
  await ensureAutomaticMappings(client, schoolId)
  const common = `
    FROM lesson_schedule_assignments a
      JOIN lesson_classrooms c ON c.id=a.classroom_id AND c.school_id=a.school_id
      JOIN teacher_classroom_student_maps m ON m.school_id=a.school_id AND m.classroom_id=a.classroom_id
      LEFT JOIN lesson_teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id
      LEFT JOIN students s ON s.school_id=a.school_id AND s.active=true AND s.grade=m.grade_value AND s.classroom=m.classroom_value
    WHERE a.school_id=$1
      AND a.import_id=(SELECT id FROM lesson_schedule_imports WHERE school_id=$1 AND is_active=true ORDER BY imported_at DESC LIMIT 1)
      AND COALESCE(trim(a.subject_name),'')<>''
      ${mode === 'teacher' ? 'AND a.teacher_id=$2' : ''}
  `
  const values = mode === 'teacher' ? [schoolId, teacherId] : [schoolId]
  const groups = (await client.query(`SELECT MIN(a.id::text) AS "assignmentId",a.subject_name AS subject,
      COALESCE(t.full_name,'غير محدد') AS "teacherName",m.grade_value AS grade,m.classroom_value AS classroom,
      COUNT(DISTINCT s.id)::int AS "studentCount"
      ${common}
      GROUP BY a.subject_name,t.full_name,m.grade_value,m.classroom_value
      ORDER BY m.grade_value,m.classroom_value,a.subject_name,t.full_name`, values)).rows
  if (!groups.length) return []
  const ids = groups.map(row => row.assignmentId)
  const counts = await client.query(`SELECT assignment_id::text AS "assignmentId",COUNT(*)::int AS count
    FROM student_portfolio_files WHERE school_id=$1 AND assignment_id=ANY($2::uuid[]) GROUP BY assignment_id`, [schoolId, ids])
  const countMap = new Map(counts.rows.map(row => [row.assignmentId, Number(row.count)]))
  return groups.map(group => ({ ...group, submittedFiles: countMap.get(group.assignmentId) || 0 }))
}

async function assignmentRoster(client, schoolId, assignmentId, teacherId = '') {
  if (!validUuid(assignmentId)) return null
  await ensureAutomaticMappings(client, schoolId)
  const assignment = (await client.query(`SELECT a.id::text AS "assignmentId",a.subject_name AS subject,
      COALESCE(t.full_name,'غير محدد') AS "teacherName",m.grade_value AS grade,m.classroom_value AS classroom
    FROM lesson_schedule_assignments a
      JOIN teacher_classroom_student_maps m ON m.school_id=a.school_id AND m.classroom_id=a.classroom_id
      LEFT JOIN lesson_teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id
    WHERE a.school_id=$1 AND a.id=$2::uuid ${teacherId ? 'AND a.teacher_id=$3::uuid' : ''}
    LIMIT 1`, teacherId ? [schoolId, assignmentId, teacherId] : [schoolId, assignmentId])).rows[0]
  if (!assignment) return null
  const students = (await client.query(`SELECT id,name,grade,classroom FROM students
    WHERE school_id=$1 AND active=true AND grade=$2 AND classroom=$3 ORDER BY name`, [schoolId, assignment.grade, assignment.classroom])).rows
  const files = (await client.query(`SELECT student_id AS "studentId",assignment_id::text AS "assignmentId",slot_number AS "slotNumber",file_name AS "fileName",file_type AS "fileType",
      to_char(uploaded_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "uploadedAt"
    FROM student_portfolio_files WHERE school_id=$1 AND assignment_id=$2::uuid`, [schoolId, assignmentId])).rows.map(file => storedPortfolioFile(file))
  const fileMap = new Map()
  for (const file of files) {
    const current = fileMap.get(file.studentId) || []
    current.push(file)
    fileMap.set(file.studentId, current)
  }
  return { ...assignment, students: students.map(student => ({ ...student, identityNumber: identityNumber(student.id), slots: portfolioSlots(fileMap.get(student.id)) })) }
}

async function studentSubjects(client, schoolId, studentId) {
  await ensureAutomaticMappings(client, schoolId)
  const student = (await client.query('SELECT id,name,phone,grade,classroom FROM students WHERE school_id=$1 AND id=$2 AND active=true', [schoolId, studentId])).rows[0]
  if (!student) return null
  const subjects = (await client.query(`SELECT MIN(a.id::text) AS "assignmentId",a.subject_name AS subject,
      COALESCE(t.full_name,'غير محدد') AS "teacherName",m.grade_value AS grade,m.classroom_value AS classroom
    FROM teacher_classroom_student_maps m
      JOIN lesson_schedule_assignments a ON a.school_id=m.school_id AND a.classroom_id=m.classroom_id
      LEFT JOIN lesson_teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id
    WHERE m.school_id=$1 AND m.grade_value=$2 AND m.classroom_value=$3
      AND a.import_id=(SELECT id FROM lesson_schedule_imports WHERE school_id=$1 AND is_active=true ORDER BY imported_at DESC LIMIT 1)
      AND COALESCE(trim(a.subject_name),'')<>''
    GROUP BY a.subject_name,t.full_name,m.grade_value,m.classroom_value
    ORDER BY a.subject_name,t.full_name`, [schoolId, student.grade, student.classroom])).rows
  if (!subjects.length) return { student, subjects: [] }
  const files = (await client.query(`SELECT assignment_id::text AS "assignmentId",slot_number AS "slotNumber",file_name AS "fileName",file_type AS "fileType",
      to_char(uploaded_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "uploadedAt"
    FROM student_portfolio_files WHERE school_id=$1 AND student_id=$2 AND assignment_id=ANY($3::uuid[])`, [schoolId, studentId, subjects.map(row => row.assignmentId)])).rows.map(file => storedPortfolioFile(file, studentId))
  const byAssignment = new Map()
  for (const file of files) {
    const current = byAssignment.get(file.assignmentId) || []
    current.push(file)
    byAssignment.set(file.assignmentId, current)
  }
  return { student, subjects: subjects.map(subject => ({ ...subject, slots: portfolioSlots(byAssignment.get(subject.assignmentId)) })) }
}

async function upsertStudentAccount({ authPool, schoolId, student, passwordHash }) {
  const existing = await authPool.query('SELECT 1 FROM student_login_accounts WHERE school_id=$1 AND student_id=$2', [schoolId, student.id])
  if (existing.rowCount) return null
  const hash = passwordHash(DEFAULT_STUDENT_PASSWORD)
  const savedUser = await authPool.query(`INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3)
    ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name RETURNING id`, [localEmail(schoolId, student.id), hash, student.name])
  await authPool.query(`INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,'student')
    ON CONFLICT(school_id,user_id) DO UPDATE SET role='student'`, [schoolId, savedUser.rows[0].id])
  await authPool.query(`INSERT INTO student_login_accounts(school_id,student_id,user_id,identity_number,password_hash,active,must_change_password)
    VALUES($1,$2,$3,$4,$5,true,true)`, [schoolId, student.id, savedUser.rows[0].id, identityNumber(student.id), hash])
  return { studentId: student.id, name: student.name, identityNumber: identityNumber(student.id), temporaryPassword: DEFAULT_STUDENT_PASSWORD }
}

async function runStudentAccountGeneration(job, students, authPool, passwordHash) {
  try {
    for (let index = 0; index < students.length; index += 8) {
      await Promise.all(students.slice(index, index + 8).map(async student => {
        try {
          const created = await upsertStudentAccount({ authPool, schoolId: job.schoolId, student, passwordHash })
          if (created) job.created += 1
          else job.skipped += 1
        } catch {
          job.failed += 1
        } finally {
          job.processed += 1
        }
      }))
    }
    job.status = 'completed'
  } catch {
    job.status = 'failed'
  } finally {
    job.completedAt = Date.now()
  }
}

export async function migrateStudentPortal(adminPool) {
  await adminPool.query(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin','staff','teacher','administrator','student'));
    CREATE TABLE IF NOT EXISTS student_login_accounts (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identity_number text NOT NULL,
      password_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT true,
      attendance_cooperation_access boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,student_id),
      UNIQUE (school_id,identity_number),
      UNIQUE (school_id,user_id),
      FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS student_login_accounts_identity ON student_login_accounts(identity_number) WHERE active=true;
    CREATE TABLE IF NOT EXISTS student_portfolio_files (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      student_id text NOT NULL,
      assignment_id uuid NOT NULL REFERENCES lesson_schedule_assignments(id) ON DELETE CASCADE,
      slot_number smallint NOT NULL CHECK (slot_number BETWEEN 1 AND 10),
      file_data text NOT NULL,
      file_name text NOT NULL DEFAULT '',
      file_type text NOT NULL DEFAULT '',
      uploaded_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,student_id,assignment_id,slot_number),
      FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS student_portfolio_files_assignment ON student_portfolio_files(school_id,assignment_id,student_id);
  `)
  await adminPool.query(`
    ALTER TABLE student_login_accounts ADD COLUMN IF NOT EXISTS attendance_cooperation_access boolean NOT NULL DEFAULT false;
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_portfolio_files' AND column_name='image_data')
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='student_portfolio_files' AND column_name='file_data') THEN
        ALTER TABLE student_portfolio_files RENAME COLUMN image_data TO file_data;
      END IF;
    END $$;
    ALTER TABLE student_portfolio_files ADD COLUMN IF NOT EXISTS file_name text NOT NULL DEFAULT '';
    ALTER TABLE student_portfolio_files ADD COLUMN IF NOT EXISTS file_type text NOT NULL DEFAULT '';
    ALTER TABLE student_portfolio_files DROP CONSTRAINT IF EXISTS student_portfolio_files_slot_number_check;
    ALTER TABLE student_portfolio_files ADD CONSTRAINT student_portfolio_files_slot_number_check CHECK (slot_number BETWEEN 1 AND 10);
    UPDATE student_portfolio_files
      SET file_type=COALESCE(NULLIF(file_type,''),substring(file_data from '^data:([^;]+)')),
          file_name=CASE WHEN COALESCE(file_name,'')='' THEN 'ملف مرفوع' ELSE file_name END
      WHERE COALESCE(file_type,'')='' OR COALESCE(file_name,'')='';
  `)
}

export async function handleStudentPortalRequest(context) {
  const { req, res, url, user, body, json, scoped, authPool, passwordHash } = context
  const adminOnly = () => user.role === 'admin'
  const teacherOnly = () => user.role === 'teacher' && validUuid(user.teacher_id)
  const studentOnly = () => user.role === 'student' && Boolean(user.student_id)

  if (req.method === 'GET' && url.pathname === '/api/student-portal/admin/overview') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const students = await scoped(user.school_id, client => client.query(`SELECT id,name,grade,classroom,phone FROM students
      WHERE school_id=$1 AND active=true ORDER BY grade,classroom,name`, [user.school_id]))
    const accounts = await authPool.query(`SELECT student_id AS "studentId",active AS "accountActive",must_change_password AS "mustChangePassword",attendance_cooperation_access AS "attendanceCooperationAccess"
      FROM student_login_accounts WHERE school_id=$1`, [user.school_id])
    const byId = new Map(accounts.rows.map(row => [row.studentId, row]))
    json(res, 200, { defaultPassword: DEFAULT_STUDENT_PASSWORD, students: students.rows.map(student => {
      const account = byId.get(student.id)
      const number = identityNumber(student.id)
      return { studentId: student.id, name: student.name, grade: student.grade, classroom: student.classroom, phone: student.phone,
        identityNumber: number, eligible: number.length >= 6, accountCreated: Boolean(account), accountActive: Boolean(account?.accountActive), mustChangePassword: Boolean(account?.mustChangePassword), attendanceCooperationAccess: Boolean(account?.attendanceCooperationAccess) }
    }) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/admin/accounts/generate/progress') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const job = portfolioGenerationJobs.get(String(url.searchParams.get('jobId') || ''))
    if (!job || job.schoolId !== user.school_id) { json(res, 404, { error: 'generation_job_not_found' }); return true }
    json(res, 200, { ok: true, jobId: job.id, total: job.total, processed: job.processed, created: job.created, skipped: job.skipped, failed: job.failed, status: job.status, defaultPassword: DEFAULT_STUDENT_PASSWORD })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-portal/admin/accounts/generate') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const running = [...portfolioGenerationJobs.values()].find(job => job.schoolId === user.school_id && job.status === 'running')
    if (running) {
      json(res, 200, { ok: true, jobId: running.id, total: running.total, processed: running.processed, created: running.created, skipped: running.skipped, failed: running.failed, status: running.status, defaultPassword: DEFAULT_STUDENT_PASSWORD })
      return true
    }
    const input = await body(req)
    const requested = Array.isArray(input.studentIds) ? new Set(input.studentIds.map(value => String(value))) : null
    const students = await scoped(user.school_id, client => client.query(`SELECT id,name FROM students WHERE school_id=$1 AND active=true ORDER BY name`, [user.school_id]))
    const selected = students.rows.filter(student => (!requested || requested.has(student.id)) && identityNumber(student.id).length >= 6)
    const job = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`, schoolId: user.school_id, total: selected.length, processed: 0, created: 0, skipped: 0, failed: 0, status: 'running', startedAt: Date.now(), completedAt: null }
    portfolioGenerationJobs.set(job.id, job)
    void runStudentAccountGeneration(job, selected, authPool, passwordHash)
    json(res, 200, { ok: true, jobId: job.id, total: job.total, processed: 0, created: 0, skipped: 0, failed: 0, status: job.status, defaultPassword: DEFAULT_STUDENT_PASSWORD })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-portal/admin/accounts/reset') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const studentId = clean(input.studentId, 100)
    if (!studentId) { json(res, 400, { error: 'invalid_student' }); return true }
    const hash = passwordHash(DEFAULT_STUDENT_PASSWORD)
    const changed = await authPool.query(`UPDATE student_login_accounts SET password_hash=$1,active=true,must_change_password=true,updated_at=now()
      WHERE school_id=$2 AND student_id=$3 RETURNING user_id`, [hash, user.school_id, studentId])
    if (!changed.rowCount) { json(res, 404, { error: 'student_account_not_found' }); return true }
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, changed.rows[0].user_id])
    await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true, temporaryPassword: DEFAULT_STUDENT_PASSWORD })
    return true
  }

  if (req.method === 'PATCH' && url.pathname === '/api/student-portal/admin/accounts/status') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const studentId = clean(input.studentId, 100)
    if (!studentId || typeof input.active !== 'boolean') { json(res, 400, { error: 'invalid_student_account_status' }); return true }
    const changed = await authPool.query(`UPDATE student_login_accounts SET active=$1,updated_at=now()
      WHERE school_id=$2 AND student_id=$3 RETURNING user_id`, [input.active, user.school_id, studentId])
    if (!changed.rowCount) { json(res, 404, { error: 'student_account_not_found' }); return true }
    if (!input.active) await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'PATCH' && url.pathname === '/api/student-portal/admin/accounts/cooperation-access') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const studentId = clean(input.studentId, 100)
    if (!studentId || typeof input.attendanceCooperationAccess !== 'boolean') { json(res, 400, { error: 'invalid_student_cooperation_access' }); return true }
    const changed = await authPool.query(`UPDATE student_login_accounts SET attendance_cooperation_access=$1,updated_at=now()
      WHERE school_id=$2 AND student_id=$3 RETURNING attendance_cooperation_access AS "attendanceCooperationAccess"`, [input.attendanceCooperationAccess, user.school_id, studentId])
    if (!changed.rowCount) { json(res, 404, { error: 'student_account_not_found' }); return true }
    json(res, 200, { ok: true, attendanceCooperationAccess: Boolean(changed.rows[0].attendanceCooperationAccess) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/admin/portfolio/groups') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    json(res, 200, { groups: await scoped(user.school_id, client => assignmentGroups(client, user.school_id, 'school')) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/admin/portfolio/entries') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const entry = await scoped(user.school_id, client => assignmentRoster(client, user.school_id, url.searchParams.get('assignmentId') || ''))
    if (!entry) { json(res, 404, { error: 'portfolio_assignment_not_found' }); return true }
    json(res, 200, entry)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/teacher/portfolio/groups') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    json(res, 200, { groups: await scoped(user.school_id, client => assignmentGroups(client, user.school_id, 'teacher', user.teacher_id)) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/teacher/portfolio/entries') {
    if (!teacherOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const entry = await scoped(user.school_id, client => assignmentRoster(client, user.school_id, url.searchParams.get('assignmentId') || '', user.teacher_id))
    if (!entry) { json(res, 404, { error: 'portfolio_assignment_not_found' }); return true }
    json(res, 200, entry)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/portfolio/file') {
    if (!['admin', 'teacher', 'student'].includes(user.role)) { json(res, 403, { error: 'forbidden' }); return true }
    const assignmentId = String(url.searchParams.get('assignmentId') || '')
    const studentId = clean(url.searchParams.get('studentId'), 100)
    const slotNumber = Number(url.searchParams.get('slotNumber'))
    if (!validUuid(assignmentId) || !studentId || !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 10) { json(res, 400, { error: 'invalid_portfolio_file' }); return true }
    const file = await scoped(user.school_id, async client => {
      if (user.role === 'student' && studentId !== user.student_id) return null
      if (user.role === 'teacher') {
        const allowed = await client.query(`SELECT 1 FROM lesson_schedule_assignments WHERE school_id=$1 AND id=$2::uuid AND teacher_id=$3::uuid LIMIT 1`, [user.school_id, assignmentId, user.teacher_id])
        if (!allowed.rowCount) return null
      }
      return (await client.query(`SELECT file_data AS "fileData",file_name AS "fileName",file_type AS "fileType"
        FROM student_portfolio_files WHERE school_id=$1 AND student_id=$2 AND assignment_id=$3::uuid AND slot_number=$4`, [user.school_id, studentId, assignmentId, slotNumber])).rows[0] || null
    })
    if (!file || !sendPortfolioFile(res, file)) { json(res, 404, { error: 'portfolio_file_not_found' }); return true }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/student/cooperation/status') {
    if (!studentOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const status = await scoped(user.school_id, client => studentCooperationStatus(client, user.school_id, user.student_id, user.student_attendance_cooperation_access))
    const { student, ...publicStatus } = status
    json(res, 200, publicStatus)
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-portal/student/cooperation/scan') {
    if (!studentOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const candidates = barcodeCandidates(input.code)
    if (!candidates.length) { json(res, 400, { error: 'invalid_barcode' }); return true }
    const clock = riyadhClock()
    const result = await scoped(user.school_id, async client => {
      const status = await studentCooperationStatus(client, user.school_id, user.student_id, user.student_attendance_cooperation_access, clock)
      if (!status.authorized) return { error: 'cooperation_not_authorized' }
      if (!status.available || !status.student) return { error: 'cooperation_closed', status }
      const wanted = new Set(candidates)
      const classmates = (await client.query(`SELECT id,name,grade,classroom FROM students
        WHERE school_id=$1 AND active=true AND grade=$2 AND classroom=$3`, [user.school_id, status.student.grade, status.student.classroom])).rows
      const student = classmates.find(item => wanted.has(clean(item.id, 200).replace(/^([+-]?\d+)\.0+$/, '$1')))
      if (!student) return { error: 'student_not_in_classroom' }
      if (student.id === user.student_id) return { error: 'own_barcode_not_allowed' }
      const existing = await client.query(`SELECT to_char(recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time
        FROM attendance_logs WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3`, [user.school_id, student.id, clock.date])
      if (existing.rowCount) return { outcome: 'duplicate', student, attendance: { status: 'present', time: existing.rows[0].time } }
      const inserted = await client.query(`INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_by,status)
        VALUES($1,$2,$3,$4,'present') ON CONFLICT(school_id,student_id,attendance_date) DO NOTHING
        RETURNING to_char(recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time`, [user.school_id, student.id, clock.date, user.user_id])
      if (!inserted.rowCount) {
        const race = await client.query(`SELECT to_char(recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time
          FROM attendance_logs WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3`, [user.school_id, student.id, clock.date])
        return { outcome: 'duplicate', student, attendance: { status: 'present', time: race.rows[0]?.time || '' } }
      }
      await client.query(`DELETE FROM absence_records WHERE school_id=$1 AND student_id=$2 AND absence_date=$3`, [user.school_id, student.id, clock.date])
      return { outcome: 'created', student, attendance: { status: 'present', time: inserted.rows[0].time } }
    })
    if (result.error) {
      const code = result.error === 'student_not_in_classroom' ? 404 : result.error === 'cooperation_closed' ? 409 : 403
      json(res, code, result)
      return true
    }
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/student-portal/student/dashboard') {
    if (!studentOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const result = await scoped(user.school_id, async client => {
      const subjectData = await studentSubjects(client, user.school_id, user.student_id)
      if (!subjectData) return null
      const school = (await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])).rows[0]
      const schedule = (await client.query(`SELECT a.id::text AS "assignmentId",a.weekday AS weekday,a.period_number AS "periodNumber",
        a.subject_name AS subject,COALESCE(t.full_name,'غير محدد') AS "teacherName",c.name AS classroom,
        to_char(ts.starts_at,'HH24:MI') AS "startTime",to_char(ts.ends_at,'HH24:MI') AS "endTime"
        FROM teacher_classroom_student_maps m
          JOIN lesson_schedule_assignments a ON a.school_id=m.school_id AND a.classroom_id=m.classroom_id
          JOIN lesson_classrooms c ON c.id=a.classroom_id AND c.school_id=a.school_id
          LEFT JOIN lesson_teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id
          LEFT JOIN lesson_time_slots ts ON ts.school_id=a.school_id AND ts.weekday=a.weekday AND ts.period_number=a.period_number
        WHERE m.school_id=$1 AND m.grade_value=$2 AND m.classroom_value=$3
          AND a.import_id=(SELECT id FROM lesson_schedule_imports WHERE school_id=$1 AND is_active=true ORDER BY imported_at DESC LIMIT 1)
        ORDER BY a.weekday,a.period_number,a.subject_name`, [user.school_id, subjectData.student.grade, subjectData.student.classroom])).rows
      const cooperation = await studentCooperationStatus(client, user.school_id, user.student_id, user.student_attendance_cooperation_access)
      const { student: cooperationStudent, ...attendanceCooperation } = cooperation
      return { schoolName: school?.name || 'المدرسة', attendanceCooperation, student: { ...subjectData.student, identityNumber: identityNumber(subjectData.student.id), qrValue: subjectData.student.id }, subjects: subjectData.subjects, schedule }
    })
    if (!result) { json(res, 404, { error: 'student_not_found' }); return true }
    json(res, 200, { ...result, mustChangePassword: Boolean(user.must_change_password) })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-portal/student/password') {
    if (!studentOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const password = String(input.password || '')
    if (password.length < 8 || password.length > 200) { json(res, 400, { error: 'invalid_student_password' }); return true }
    const hash = passwordHash(password)
    const changed = await authPool.query(`UPDATE student_login_accounts SET password_hash=$1,must_change_password=false,updated_at=now()
      WHERE school_id=$2 AND student_id=$3 RETURNING user_id`, [hash, user.school_id, user.student_id])
    if (!changed.rowCount) { json(res, 404, { error: 'student_account_not_found' }); return true }
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, changed.rows[0].user_id])
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-portal/student/portfolio/upload') {
    if (!studentOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req, 8_000_000)
    const assignmentId = String(input.assignmentId || '')
    const slotNumber = Number(input.slotNumber)
    const file = portfolioFile(input.file, input.fileName)
    if (!validUuid(assignmentId) || !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 10 || !file) { json(res, 400, { error: 'invalid_portfolio_file' }); return true }
    const saved = await scoped(user.school_id, async client => {
      const subjects = await studentSubjects(client, user.school_id, user.student_id)
      if (!subjects?.subjects.some(subject => subject.assignmentId === assignmentId)) return null
      const result = await client.query(`INSERT INTO student_portfolio_files(school_id,student_id,assignment_id,slot_number,file_data,file_name,file_type,uploaded_at)
        VALUES($1,$2,$3::uuid,$4,$5,$6,$7,now())
        ON CONFLICT(school_id,student_id,assignment_id,slot_number) DO UPDATE SET file_data=EXCLUDED.file_data,file_name=EXCLUDED.file_name,file_type=EXCLUDED.file_type,uploaded_at=now()
        RETURNING assignment_id::text AS "assignmentId",slot_number AS "slotNumber",file_name AS "fileName",file_type AS "fileType",to_char(uploaded_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "uploadedAt"`, [user.school_id, user.student_id, assignmentId, slotNumber, file.data, file.name, file.type])
      return storedPortfolioFile(result.rows[0], user.student_id)
    })
    if (!saved) { json(res, 403, { error: 'portfolio_assignment_forbidden' }); return true }
    json(res, 200, { ok: true, file: saved })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/student-portal/student/portfolio/delete') {
    if (!studentOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const assignmentId = String(input.assignmentId || '')
    const slotNumber = Number(input.slotNumber)
    if (!validUuid(assignmentId) || !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 10) { json(res, 400, { error: 'invalid_portfolio_slot' }); return true }
    await scoped(user.school_id, client => client.query(`DELETE FROM student_portfolio_files WHERE school_id=$1 AND student_id=$2 AND assignment_id=$3::uuid AND slot_number=$4`, [user.school_id, user.student_id, assignmentId, slotNumber]))
    json(res, 200, { ok: true })
    return true
  }

  return false
}
