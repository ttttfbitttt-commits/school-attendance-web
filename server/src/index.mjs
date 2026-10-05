import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import pg from 'pg'
import { handleFeatureRequest, migrateFeatures } from './features.mjs'
import { migrateEmailVerification, requestSchoolRegistration, verifySchoolRegistration } from './emailVerification.mjs'
import { handleLessonFlowRequest, migrateLessonFlow } from './lessonFlow.mjs'
import { handleTeacherPortalRequest, migrateTeacherPortal } from './teacherPortal.mjs'
import { handleBehaviorRequest, migrateBehavior } from './behavior.mjs'
import { handleStudentReferralRequest, migrateStudentReferrals } from './studentReferrals.mjs'
import { handleTeacherCooperationRequest, migrateTeacherCooperation } from './teacherCooperation.mjs'

const { Pool } = pg
if (!process.env.DATABASE_URL || !process.env.RUNTIME_DATABASE_URL || !process.env.AUTH_DATABASE_URL) {
  throw new Error('database_roles_not_configured')
}
const adminPool = new Pool({ connectionString: process.env.DATABASE_URL })
const pool = new Pool({ connectionString: process.env.RUNTIME_DATABASE_URL })
const authPool = new Pool({ connectionString: process.env.AUTH_DATABASE_URL })
const PORT = Number(process.env.PORT || 3000)
const COOKIE = 'attendance_session'
const secureCookie = process.env.NODE_ENV === 'production'

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v.length === 2))
}
function sessionCookie(token, maxAge = 60 * 60 * 12) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookie ? '; Secure' : ''}`
}
function tokenHash(token) { return crypto.createHash('sha256').update(token).digest('hex') }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
}
function passwordMatches(password, saved) {
  const [salt, hash] = saved.split(':')
  const actual = crypto.scryptSync(password, salt, 64).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(actual, 'hex'))
}
async function body(req) {
  const chunks = []
  for await (const chunk of req) { chunks.push(chunk); if (Buffer.concat(chunks).length > 2_000_000) throw new Error('payload_too_large') }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') } catch { throw new Error('invalid_json') }
}
async function auth(req) {
  const token = parseCookies(req)[COOKIE]
  if (!token) return null
  const { rows } = await authPool.query(`SELECT s.user_id, s.school_id, u.email, u.display_name, m.role,
      account.teacher_id,account.must_change_password
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.school_id=s.school_id
      LEFT JOIN teacher_login_accounts account ON account.user_id=s.user_id AND account.school_id=s.school_id
    WHERE s.token_hash=$1 AND s.expires_at > now()
      AND (m.role <> 'teacher' OR account.active=true)`, [tokenHash(token)])
  return rows[0] || null
}
async function createSession(res, userId, schoolId) {
  const token = crypto.randomBytes(32).toString('base64url')
  await authPool.query('INSERT INTO sessions(token_hash,user_id,school_id,expires_at) VALUES($1,$2,$3,now()+interval \'12 hours\')', [tokenHash(token), userId, schoolId])
  res.setHeader('set-cookie', sessionCookie(token))
}
function account(row) {
  return {
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    schoolId: row.school_id,
    teacherId: row.teacher_id || undefined,
    mustChangePassword: Boolean(row.must_change_password),
  }
}
const defaultPreferences = { attendanceMode: 'auto', cutoffTime: '07:30', gradeAliases: {} }
function schoolProfile(row) {
  const preferences = row.preferences && typeof row.preferences === 'object' ? row.preferences : {}
  return {
    schoolName: row.name,
    principalName: row.principal_name,
    academicYear: row.academic_year,
    semester: row.semester,
    preferences: {
      attendanceMode: ['auto', 'present', 'late'].includes(preferences.attendanceMode) ? preferences.attendanceMode : defaultPreferences.attendanceMode,
      cutoffTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.cutoffTime || '') ? preferences.cutoffTime : defaultPreferences.cutoffTime,
      gradeAliases: preferences.gradeAliases && typeof preferences.gradeAliases === 'object' && !Array.isArray(preferences.gradeAliases) ? preferences.gradeAliases : {},
    },
  }
}
function normalizedSchoolProfile(input) {
  const schoolName = String(input.schoolName || '').trim()
  const principalName = String(input.principalName || '').trim()
  const academicYear = String(input.academicYear || '').trim()
  const semester = String(input.semester || '').trim()
  const rawPreferences = input.preferences && typeof input.preferences === 'object' && !Array.isArray(input.preferences) ? input.preferences : {}
  const attendanceMode = ['auto', 'present', 'late'].includes(rawPreferences.attendanceMode) ? rawPreferences.attendanceMode : defaultPreferences.attendanceMode
  const cutoffTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(rawPreferences.cutoffTime || '')) ? String(rawPreferences.cutoffTime) : defaultPreferences.cutoffTime
  const gradeAliases = Object.fromEntries(Object.entries(rawPreferences.gradeAliases && typeof rawPreferences.gradeAliases === 'object' && !Array.isArray(rawPreferences.gradeAliases) ? rawPreferences.gradeAliases : {})
    .filter(([key, value]) => String(key).trim().length <= 100 && String(value).trim().length <= 100)
    .slice(0, 100)
    .map(([key, value]) => [String(key).trim(), String(value).trim()]))
  if (![schoolName, principalName, academicYear, semester].every(value => value.length > 0 && value.length <= 160)) return null
  return { schoolName, principalName, academicYear, semester, preferences: { attendanceMode, cutoffTime, gradeAliases } }
}
async function scopedOn(databasePool, schoolId, work) {
  const client = await databasePool.connect()
  try { await client.query('BEGIN'); await client.query(`SELECT set_config('app.school_id', $1, true)`, [schoolId]); const result = await work(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
async function scoped(schoolId, work) { return scopedOn(pool, schoolId, work) }
function todayRiyadh() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()) }

function sqlStringLiteral(value) { return `'${String(value).replaceAll("'", "''")}'` }

async function configureDatabaseRoles() {
  const runtimePassword = String(process.env.APP_DB_PASSWORD || '')
  const authPassword = String(process.env.AUTH_DB_PASSWORD || '')
  const adminPassword = decodeURIComponent(new URL(process.env.DATABASE_URL).password)
  if (runtimePassword.length < 32 || authPassword.length < 32 || runtimePassword === authPassword || runtimePassword === adminPassword || authPassword === adminPassword) {
    throw new Error('database_role_passwords_must_be_distinct_and_at_least_32_characters')
  }

  for (const [role, password] of [['attendance_app', runtimePassword], ['attendance_auth', authPassword]]) {
    const exists = await adminPool.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])
    const roleSql = exists.rowCount
      ? `ALTER ROLE ${role} WITH LOGIN PASSWORD ${sqlStringLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
      : `CREATE ROLE ${role} WITH LOGIN PASSWORD ${sqlStringLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`
    await adminPool.query(roleSql)
  }

  await adminPool.query('GRANT USAGE ON SCHEMA public TO attendance_app, attendance_auth')
  await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON schools, students, attendance_logs, almadar_accounts, student_excuses,
    message_logs, absence_records, absence_corrections, lesson_teachers, lesson_classrooms, lesson_schedule_imports,
    lesson_name_mappings, lesson_time_slots, lesson_schedule_assignments, teacher_incidents, teacher_day_absences,
    teacher_classroom_student_maps, teacher_lesson_sessions, teacher_lesson_student_records,
    teacher_sheet_configs, teacher_sheet_entries, behavior_incidents, behavior_student_records,
    behavior_action_steps, behavior_score_movements, behavior_audit_logs, student_referrals,
    student_referral_events, teacher_attendance_contributions TO attendance_app`)
  await adminPool.query('GRANT SELECT ON behavior_catalog_rules TO attendance_app')
  await adminPool.query('GRANT USAGE, SELECT ON SEQUENCE behavior_audit_logs_id_seq TO attendance_app')
  await adminPool.query('GRANT USAGE, SELECT ON SEQUENCE student_referral_events_id_seq TO attendance_app')
  await adminPool.query('GRANT SELECT, INSERT, UPDATE ON schools, users, memberships TO attendance_auth')
  await adminPool.query('GRANT SELECT, INSERT, DELETE ON sessions TO attendance_auth')
  await adminPool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON teacher_login_accounts TO attendance_auth')
  await adminPool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON pending_school_registrations TO attendance_auth')
}

async function enforceTenantRowSecurity() {
  const tables = [
    ['schools', 'id', 'schools_school_scope'],
    ['students', 'school_id', 'students_school_scope'],
    ['attendance_logs', 'school_id', 'attendance_school_scope'],
    ['almadar_accounts', 'school_id', 'almadar_accounts_school_scope'],
    ['student_excuses', 'school_id', 'student_excuses_school_scope'],
    ['message_logs', 'school_id', 'message_logs_school_scope'],
    ['absence_records', 'school_id', 'absence_records_school_scope'],
    ['absence_corrections', 'school_id', 'absence_corrections_school_scope'],
    ['lesson_teachers', 'school_id', 'lesson_teachers_school_scope'],
    ['lesson_classrooms', 'school_id', 'lesson_classrooms_school_scope'],
    ['lesson_schedule_imports', 'school_id', 'lesson_schedule_imports_school_scope'],
    ['lesson_name_mappings', 'school_id', 'lesson_name_mappings_school_scope'],
    ['lesson_time_slots', 'school_id', 'lesson_time_slots_school_scope'],
    ['lesson_schedule_assignments', 'school_id', 'lesson_schedule_assignments_school_scope'],
    ['teacher_incidents', 'school_id', 'teacher_incidents_school_scope'],
    ['teacher_day_absences', 'school_id', 'teacher_day_absences_school_scope'],
    ['teacher_classroom_student_maps', 'school_id', 'teacher_classroom_student_maps_school_scope'],
    ['teacher_lesson_sessions', 'school_id', 'teacher_lesson_sessions_school_scope'],
    ['teacher_lesson_student_records', 'school_id', 'teacher_lesson_student_records_school_scope'],
    ['teacher_sheet_configs', 'school_id', 'teacher_sheet_configs_school_scope'],
    ['teacher_sheet_entries', 'school_id', 'teacher_sheet_entries_school_scope'],
    ['behavior_incidents', 'school_id', 'behavior_incidents_school_scope'],
    ['behavior_student_records', 'school_id', 'behavior_student_records_school_scope'],
    ['behavior_action_steps', 'school_id', 'behavior_action_steps_school_scope'],
    ['behavior_score_movements', 'school_id', 'behavior_score_movements_school_scope'],
    ['behavior_audit_logs', 'school_id', 'behavior_audit_logs_school_scope'],
    ['student_referrals', 'school_id', 'student_referrals_school_scope'],
    ['student_referral_events', 'school_id', 'student_referral_events_school_scope'],
    ['teacher_attendance_contributions', 'school_id', 'teacher_attendance_contributions_school_scope'],
  ]
  for (const [table, schoolColumn, policy] of tables) {
    await adminPool.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`)
    await adminPool.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`)
    const existing = await adminPool.query('SELECT 1 FROM pg_policies WHERE schemaname=$1 AND tablename=$2 AND policyname=$3', ['public', table, policy])
    if (!existing.rowCount) {
      await adminPool.query(`CREATE POLICY ${policy} ON ${table} USING (${schoolColumn}=current_setting('app.school_id',true)::uuid) WITH CHECK (${schoolColumn}=current_setting('app.school_id',true)::uuid)`)
    }
  }
}

async function migrateDatabase() {
  await adminPool.query("ALTER TABLE schools ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb")
  await adminPool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true')
  await migrateFeatures(adminPool)
  await migrateEmailVerification(adminPool)
  await migrateLessonFlow(adminPool)
  await migrateTeacherPortal(adminPool)
  await migrateBehavior(adminPool)
  await migrateStudentReferrals(adminPool)
  await migrateTeacherCooperation(adminPool)
  await enforceTenantRowSecurity()
  await configureDatabaseRoles()
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true })
    if (req.method === 'POST' && url.pathname === '/api/auth/register') return requestSchoolRegistration({ req, res, authPool, body, json, passwordHash })
    if (req.method === 'POST' && url.pathname === '/api/auth/verify-email') return verifySchoolRegistration({ req, res, authPool, body, json, scopedOn, createSession })
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const { email, password } = await body(req)
      const user = await authPool.query(`SELECT u.id,u.email,u.display_name,m.school_id,m.role,u.password_hash FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=lower($1) AND m.role IN ('admin','staff') ORDER BY m.role='admin' DESC LIMIT 1`, [email || ''])
      if (!user.rows[0] || !passwordMatches(String(password || ''), user.rows[0].password_hash)) return json(res, 401, { error: 'invalid_login' })
      await createSession(res, user.rows[0].id, user.rows[0].school_id)
      return json(res, 200, { user: account(user.rows[0]) })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/teacher-login') {
      const { identityNumber, password, schoolId } = await body(req)
      const identity = String(identityNumber || '').replace(/\D/g, '').slice(0, 32)
      const candidates = await authPool.query(`SELECT account.user_id,account.school_id,account.teacher_id,account.must_change_password,account.password_hash,u.email,u.display_name,m.role
        FROM teacher_login_accounts account JOIN users u ON u.id=account.user_id
          JOIN memberships m ON m.user_id=account.user_id AND m.school_id=account.school_id
        WHERE account.identity_number=$1 AND account.active=true AND m.role='teacher'${schoolId ? ' AND account.school_id=$2' : ''}`,
      schoolId ? [identity, String(schoolId)] : [identity])
      const matches = candidates.rows.filter(row => passwordMatches(String(password || ''), row.password_hash))
      if (!matches.length) return json(res, 401, { error: 'invalid_teacher_login' })
      if (!schoolId && matches.length > 1) {
        const schools = await Promise.all(matches.map(async row => ({
          id: row.school_id,
          name: (await scopedOn(authPool, row.school_id, client => client.query('SELECT name FROM schools WHERE id=$1', [row.school_id]))).rows[0]?.name || 'المدرسة',
        })))
        return json(res, 409, { error: 'teacher_school_selection_required', schools })
      }
      const teacher = matches[0]
      await createSession(res, teacher.user_id, teacher.school_id)
      return json(res, 200, { user: account(teacher) })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { const t=parseCookies(req)[COOKIE]; if(t) await authPool.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(t)]); res.setHeader('set-cookie',sessionCookie('',0)); return json(res,200,{ok:true}) }
    const user = await auth(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, { user: account(user) })
    if (await handleTeacherCooperationRequest({ req, res, url, user, body, json, scoped })) return
    if (await handleStudentReferralRequest({ req, res, url, user, body, json, scoped, todayRiyadh })) return
    if (await handleTeacherPortalRequest({ req, res, url, user, pool, authPool, body, json, scoped, todayRiyadh, passwordHash })) return
    // Teacher accounts are intentionally isolated from the administrative attendance APIs.
    if (user.role === 'teacher') return json(res, 403, { error: 'teacher_portal_only' })
    if (req.method === 'GET' && url.pathname === '/api/school') {
      const result = await scoped(user.school_id, async c => c.query('SELECT name,principal_name,academic_year,semester,preferences FROM schools WHERE id=$1', [user.school_id]))
      if (!result.rows[0]) return json(res, 404, { error: 'school_not_found' })
      return json(res, 200, { school: schoolProfile(result.rows[0]) })
    }
    if (req.method === 'PUT' && url.pathname === '/api/school') {
      if (user.role !== 'admin') return json(res, 403, { error: 'forbidden' })
      const profile = normalizedSchoolProfile(await body(req))
      if (!profile) return json(res, 400, { error: 'invalid_school_profile' })
      const result = await scoped(user.school_id, async c => c.query('UPDATE schools SET name=$1,principal_name=$2,academic_year=$3,semester=$4,preferences=$5::jsonb WHERE id=$6 RETURNING name,principal_name,academic_year,semester,preferences', [profile.schoolName, profile.principalName, profile.academicYear, profile.semester, JSON.stringify(profile.preferences), user.school_id]))
      return json(res, 200, { school: schoolProfile(result.rows[0]) })
    }
    if (req.method === 'GET' && url.pathname === '/api/students') return json(res, 200, await scoped(user.school_id, async c => ({ students: (await c.query('SELECT id,name,phone,grade,classroom,sheet,row_number AS row FROM students WHERE school_id=$1 AND active=true ORDER BY name', [user.school_id])).rows })))
    if (req.method === 'PUT' && url.pathname === '/api/students') {
      if (user.role !== 'admin') return json(res,403,{error:'forbidden'})
      const { students=[] } = await body(req)
      if (!Array.isArray(students) || students.length > 20000 || students.some(s => !String(s?.id || '').trim() || !String(s?.name || '').trim())) return json(res,400,{error:'invalid_students'})
      await scoped(user.school_id, async c => {
        await c.query('UPDATE students SET active=false,updated_at=now() WHERE school_id=$1', [user.school_id])
        for (const s of students) await c.query(`INSERT INTO students(school_id,id,name,phone,grade,classroom,sheet,row_number,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)
          ON CONFLICT(school_id,id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,grade=EXCLUDED.grade,classroom=EXCLUDED.classroom,sheet=EXCLUDED.sheet,row_number=EXCLUDED.row_number,active=true,updated_at=now()`,[user.school_id,String(s.id).trim(),String(s.name).trim(),String(s.phone||''),String(s.grade||''),String(s.classroom||''),String(s.sheet||''),Number(s.row)||0])
      })
      return json(res,200,{ok:true})
    }
    if (req.method === 'GET' && url.pathname === '/api/attendance') return json(res,200, await scoped(user.school_id, async c => ({ records:(await c.query(`SELECT a.student_id AS "studentId", to_char(a.attendance_date,'YYYY-MM-DD') AS date, to_char(a.recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time, s.name,s.grade,s.classroom,s.phone,a.status FROM attendance_logs a JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id WHERE a.school_id=$1 AND a.attendance_date=$2 ORDER BY a.recorded_at DESC`,[user.school_id,url.searchParams.get('date') || todayRiyadh()])).rows })))
    if (req.method === 'POST' && url.pathname === '/api/attendance') {
      const { studentId, status } = await body(req); if (!studentId || !['present','late'].includes(status)) return json(res,400,{error:'invalid_attendance'})
      const attendanceDate = todayRiyadh()
      const result = await scoped(user.school_id, async c => {
        const student = await c.query('SELECT 1 FROM students WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, studentId])
        if (!student.rowCount) return null
        // Attendance always wins: a student marked present or late cannot remain absent for the same day.
        await c.query('DELETE FROM absence_records WHERE school_id=$1 AND student_id=$2 AND absence_date=$3', [user.school_id, studentId, attendanceDate])
        return c.query(`INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_by,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,student_id,attendance_date) DO NOTHING RETURNING attendance_date,recorded_at`,[user.school_id,studentId,attendanceDate,user.user_id,status])
      })
      if (!result) return json(res,404,{error:'student_not_found'})
      return json(res, result.rowCount ? 201 : 200, { ok: Boolean(result.rowCount), duplicate: !result.rowCount })
    }
    if (req.method === 'DELETE' && url.pathname === '/api/attendance') {
      if (user.role !== 'admin') return json(res,403,{error:'forbidden'})
      const date = url.searchParams.get('date') || todayRiyadh()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res,400,{error:'invalid_date'})
      await scoped(user.school_id, async c => c.query('DELETE FROM attendance_logs WHERE school_id=$1 AND attendance_date=$2', [user.school_id, date]))
      return json(res,200,{ok:true})
    }
    if (await handleLessonFlowRequest({ req, res, url, user, pool, body, json, scoped, todayRiyadh })) return
    if (await handleBehaviorRequest({ req, res, url, user, pool, body, json, scoped, todayRiyadh })) return
    if (await handleFeatureRequest({ req, res, url, user, pool, body, json, scoped, todayRiyadh })) return
    return json(res, 404, { error: 'not_found' })
  } catch (error) {
    console.error(error)
    if (error instanceof Error && error.message === 'almadar_encryption_not_configured') return json(res, 503, { error: 'almadar_encryption_not_configured' })
    if (error instanceof Error && error.message === 'teacher_credential_encryption_not_configured') return json(res, 503, { error: 'teacher_credential_encryption_not_configured' })
    return json(res, 500, { error: 'server_error' })
  }
})
async function start() {
  await migrateDatabase()
  await adminPool.end()
  delete process.env.DATABASE_URL
  delete process.env.RUNTIME_DATABASE_URL
  delete process.env.AUTH_DATABASE_URL
  delete process.env.APP_DB_PASSWORD
  delete process.env.AUTH_DB_PASSWORD
  server.listen(PORT, '0.0.0.0', () => console.log(`API listening on ${PORT}`))
}

start().catch((error) => { console.error('Database migration failed', error); process.exit(1) })
