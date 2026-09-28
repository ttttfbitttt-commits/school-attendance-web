import http from 'node:http'
import crypto from 'node:crypto'
import { URL } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
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
  const { rows } = await pool.query(`SELECT s.user_id, s.school_id, u.email, u.display_name, m.role
    FROM sessions s JOIN users u ON u.id=s.user_id JOIN memberships m ON m.user_id=s.user_id AND m.school_id=s.school_id
    WHERE s.token_hash=$1 AND s.expires_at > now()`, [tokenHash(token)])
  return rows[0] || null
}
async function createSession(res, userId, schoolId) {
  const token = crypto.randomBytes(32).toString('base64url')
  await pool.query('INSERT INTO sessions(token_hash,user_id,school_id,expires_at) VALUES($1,$2,$3,now()+interval \'12 hours\')', [tokenHash(token), userId, schoolId])
  res.setHeader('set-cookie', sessionCookie(token))
}
function account(row) { return { email: row.email, displayName: row.display_name, role: row.role, schoolId: row.school_id } }
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
async function scoped(schoolId, work) {
  const client = await pool.connect()
  try { await client.query('BEGIN'); await client.query(`SELECT set_config('app.school_id', $1, true)`, [schoolId]); const result = await work(client); await client.query('COMMIT'); return result }
  catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
function todayRiyadh() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date()) }
async function migrateDatabase() {
  await pool.query("ALTER TABLE schools ADD COLUMN IF NOT EXISTS preferences jsonb NOT NULL DEFAULT '{}'::jsonb")
  await pool.query('ALTER TABLE students ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true')
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true })
    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      const { email, password, displayName, schoolName } = await body(req)
      if (!/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 12 || !String(schoolName || '').trim()) return json(res, 400, { error: 'invalid_registration' })
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const school = await client.query('INSERT INTO schools(name,principal_name,academic_year,semester) VALUES($1,$2,$3,$4) RETURNING id,name', [schoolName.trim(), String(displayName || '').trim() || schoolName.trim(), '1448 / 1449', 'الفصل الأول'])
        const user = await client.query('INSERT INTO users(email,password_hash,display_name) VALUES(lower($1),$2,$3) RETURNING id,email,display_name', [email, passwordHash(password), String(displayName || '').trim() || schoolName.trim()])
        await client.query('INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,\'admin\')', [school.rows[0].id, user.rows[0].id])
        await client.query('COMMIT')
        await createSession(res, user.rows[0].id, school.rows[0].id)
        return json(res, 201, { user: { ...user.rows[0], role: 'admin', schoolId: school.rows[0].id }, school: school.rows[0] })
      } catch (e) { await client.query('ROLLBACK'); return json(res, e.code === '23505' ? 409 : 500, { error: 'registration_failed' }) } finally { client.release() }
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const { email, password } = await body(req)
      const user = await pool.query(`SELECT u.id,u.email,u.display_name,m.school_id,m.role,u.password_hash FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.email=lower($1) ORDER BY m.role='admin' DESC LIMIT 1`, [email || ''])
      if (!user.rows[0] || !passwordMatches(String(password || ''), user.rows[0].password_hash)) return json(res, 401, { error: 'invalid_login' })
      await createSession(res, user.rows[0].id, user.rows[0].school_id)
      return json(res, 200, { user: account(user.rows[0]) })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') { const t=parseCookies(req)[COOKIE]; if(t) await pool.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(t)]); res.setHeader('set-cookie',sessionCookie('',0)); return json(res,200,{ok:true}) }
    const user = await auth(req)
    if (!user) return json(res, 401, { error: 'unauthorized' })
    if (req.method === 'GET' && url.pathname === '/api/me') return json(res, 200, { user: account(user) })
    if (req.method === 'GET' && url.pathname === '/api/school') {
      const result = await pool.query('SELECT name,principal_name,academic_year,semester,preferences FROM schools WHERE id=$1', [user.school_id])
      if (!result.rows[0]) return json(res, 404, { error: 'school_not_found' })
      return json(res, 200, { school: schoolProfile(result.rows[0]) })
    }
    if (req.method === 'PUT' && url.pathname === '/api/school') {
      if (user.role !== 'admin') return json(res, 403, { error: 'forbidden' })
      const profile = normalizedSchoolProfile(await body(req))
      if (!profile) return json(res, 400, { error: 'invalid_school_profile' })
      const result = await pool.query('UPDATE schools SET name=$1,principal_name=$2,academic_year=$3,semester=$4,preferences=$5::jsonb WHERE id=$6 RETURNING name,principal_name,academic_year,semester,preferences', [profile.schoolName, profile.principalName, profile.academicYear, profile.semester, JSON.stringify(profile.preferences), user.school_id])
      return json(res, 200, { school: schoolProfile(result.rows[0]) })
    }
    if (req.method === 'GET' && url.pathname === '/api/students') return json(res, 200, await scoped(user.school_id, async c => ({ students: (await c.query('SELECT id,name,phone,grade,classroom,sheet,row_number AS row FROM students WHERE active=true ORDER BY name')).rows })))
    if (req.method === 'PUT' && url.pathname === '/api/students') {
      if (user.role !== 'admin') return json(res,403,{error:'forbidden'})
      const { students=[] } = await body(req)
      if (!Array.isArray(students) || students.length > 20000 || students.some(s => !String(s?.id || '').trim() || !String(s?.name || '').trim())) return json(res,400,{error:'invalid_students'})
      await scoped(user.school_id, async c => {
        await c.query('UPDATE students SET active=false,updated_at=now()')
        for (const s of students) await c.query(`INSERT INTO students(school_id,id,name,phone,grade,classroom,sheet,row_number,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,true)
          ON CONFLICT(school_id,id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,grade=EXCLUDED.grade,classroom=EXCLUDED.classroom,sheet=EXCLUDED.sheet,row_number=EXCLUDED.row_number,active=true,updated_at=now()`,[user.school_id,String(s.id).trim(),String(s.name).trim(),String(s.phone||''),String(s.grade||''),String(s.classroom||''),String(s.sheet||''),Number(s.row)||0])
      })
      return json(res,200,{ok:true})
    }
    if (req.method === 'GET' && url.pathname === '/api/attendance') return json(res,200, await scoped(user.school_id, async c => ({ records:(await c.query(`SELECT a.student_id AS "studentId", to_char(a.attendance_date,'YYYY-MM-DD') AS date, to_char(a.recorded_at AT TIME ZONE 'Asia/Riyadh','HH24:MI:SS') AS time, s.name,s.grade,s.classroom,s.phone,a.status FROM attendance_logs a JOIN students s ON s.school_id=a.school_id AND s.id=a.student_id WHERE a.attendance_date=$1 ORDER BY a.recorded_at DESC`,[url.searchParams.get('date') || todayRiyadh()])).rows })))
    if (req.method === 'POST' && url.pathname === '/api/attendance') {
      const { studentId, status } = await body(req); if (!studentId || !['present','late'].includes(status)) return json(res,400,{error:'invalid_attendance'})
      const result = await scoped(user.school_id, async c => {
        const student = await c.query('SELECT 1 FROM students WHERE id=$1 AND active=true', [studentId])
        if (!student.rowCount) return null
        return c.query(`INSERT INTO attendance_logs(school_id,student_id,attendance_date,recorded_by,status) VALUES($1,$2,$3,$4,$5) ON CONFLICT(school_id,student_id,attendance_date) DO NOTHING RETURNING attendance_date,recorded_at`,[user.school_id,studentId,todayRiyadh(),user.user_id,status])
      })
      if (!result) return json(res,404,{error:'student_not_found'})
      return json(res, result.rowCount ? 201 : 409, { ok: Boolean(result.rowCount) })
    }
    if (req.method === 'DELETE' && url.pathname === '/api/attendance') {
      if (user.role !== 'admin') return json(res,403,{error:'forbidden'})
      const date = url.searchParams.get('date') || todayRiyadh()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res,400,{error:'invalid_date'})
      await scoped(user.school_id, async c => c.query('DELETE FROM attendance_logs WHERE attendance_date=$1', [date]))
      return json(res,200,{ok:true})
    }
    return json(res, 404, { error: 'not_found' })
  } catch (error) { console.error(error); return json(res, 500, { error: 'server_error' }) }
})
migrateDatabase().then(() => server.listen(PORT, '0.0.0.0', () => console.log(`API listening on ${PORT}`))).catch((error) => { console.error('Database migration failed', error); process.exit(1) })
