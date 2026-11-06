import crypto from 'node:crypto'

// الفصل الدراسي في النظام لا يغيّر هوية المدرسة أو حساباتها.  بدلاً من ذلك
// نحفظ لقطة قابلة للاستعادة من بيانات الفصل، ثم نفتح مساحة عمل نظيفة للفصل التالي.
// هذا يجعل جميع الواجهات الحالية ترى الفصل النشط تلقائياً، لأن مصدرها يبقى الجداول
// نفسها، ويمنع خلط بيانات مدرستين أو فصلين.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// هذه السجلات تخص هوية المدرسة أو حسابات أفرادها، وليست محتوى فصل دراسي. تبقى
// مستمرة عند بدء فصل جديد؛ أما بقية السجلات التي تحمل school_id فتؤرشف للفصل.
const PERSISTENT_TABLES = new Set([
  'academic_terms', 'academic_term_audit', 'school_backup_audit', 'school_login_activity',
  'academic_term_transition_requests',
  'memberships', 'almadar_accounts',
  'lesson_teachers', 'teacher_login_accounts', 'teacher_portfolio_correction_settings',
  'administrative_staff', 'administrative_login_accounts',
  'school_vice_principals', 'vice_principal_login_accounts', 'vice_principal_grade_assignments',
  'student_counselors', 'counselor_login_accounts', 'student_counselor_grade_assignments',
  'school_activity_leaders', 'activity_leader_login_accounts',
  'behavior_catalog_rules',
])

// ملفات إنجاز الطلاب هي أكبر ملفات المدرسة. لا نضعها في اللقطة الفصلية ولا نعيدها؛
// فهذا يحقق سياسة تجهيز ملف إنجاز جديد في كل فصل ويحافظ على مساحة التخزين.
const PORTFOLIO_TABLES = ['student_portfolio_corrections', 'student_portfolio_files']

function quoteIdentifier(value) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) throw new Error('invalid_term_table')
  return `"${value}"`
}

function text(value, maximum = 160) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, maximum) : ''
}

function validTerm(input) {
  const academicYear = text(input?.academicYear, 80)
  const semester = text(input?.semester, 80)
  return academicYear && semester ? { academicYear, semester } : null
}

function validId(value) { return UUID.test(String(value || '')) }
function tokenHash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex') }
function publicBaseUrl() { return String(process.env.PUBLIC_APP_URL || 'https://7asr2030.com').replace(/\/$/, '') }
function confirmationUrl(token) { return `${publicBaseUrl()}/term-confirmation.html?token=${encodeURIComponent(token)}` }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]) }

function termSummary(snapshot) {
  const rows = snapshot?.tables && typeof snapshot.tables === 'object' ? snapshot.tables : {}
  const count = table => Array.isArray(rows[table]) ? rows[table].length : 0
  return {
    students: count('students'),
    attendance: count('attendance_logs'),
    classrooms: count('lesson_classrooms'),
    schedules: count('lesson_schedule_assignments'),
    absences: count('absence_records'),
    lessonRecords: count('teacher_lesson_student_records'),
    circulars: count('school_circulars'),
    referrals: count('student_referrals'),
    teacherRecords: count('teacher_evidence_records'),
    teachers: Array.isArray(snapshot?.teachers) ? snapshot.teachers.length : 0,
    portfolioFilesDeleted: Number(snapshot?.portfolio?.files || 0),
    portfolioBytesDeleted: Number(snapshot?.portfolio?.bytes || 0),
  }
}

async function schoolTables(client) {
  const result = await client.query(`SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema='public' AND column_name='school_id'
    ORDER BY table_name`)
  return result.rows.map(row => String(row.table_name)).filter(table =>
    /^[a-z_][a-z0-9_]*$/i.test(table) && !PERSISTENT_TABLES.has(table) && !PORTFOLIO_TABLES.includes(table),
  )
}

async function rowsForSchool(client, table, schoolId) {
  const result = await client.query(`SELECT COALESCE(json_agg(row_to_json(source)), '[]'::json) AS rows
    FROM public.${quoteIdentifier(table)} AS source WHERE school_id=$1`, [schoolId])
  return Array.isArray(result.rows[0]?.rows) ? result.rows[0].rows : []
}

async function portfolioUsage(client, schoolId) {
  const result = await client.query(`SELECT COUNT(*)::int AS files,
      COALESCE(SUM(octet_length(file_data)),0)::bigint AS bytes
    FROM student_portfolio_files WHERE school_id=$1`, [schoolId])
  return { files: Number(result.rows[0]?.files || 0), bytes: Number(result.rows[0]?.bytes || 0) }
}

async function captureSnapshot(client, schoolId) {
  const tables = await schoolTables(client)
  const entries = []
  for (const table of tables) entries.push([table, await rowsForSchool(client, table, schoolId)])
  const teachers = await rowsForSchool(client, 'lesson_teachers', schoolId)
  const portfolio = await portfolioUsage(client, schoolId)
  return { version: 1, capturedAt: new Date().toISOString(), tables: Object.fromEntries(entries), teachers, portfolio }
}

async function columnsFor(client, table) {
  const result = await client.query(`SELECT column_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND is_generated='NEVER'
    ORDER BY ordinal_position`, [table])
  return new Set(result.rows.map(row => String(row.column_name)).filter(column => /^[a-z_][a-z0-9_]*$/i.test(column)))
}

async function restoreRows(client, table, rows) {
  if (!Array.isArray(rows) || !rows.length) return
  const available = await columnsFor(client, table)
  const columns = [...new Set(rows.flatMap(row => Object.keys(row || {})))].filter(column => available.has(column))
  if (!columns.length) return
  const names = columns.map(quoteIdentifier).join(',')
  await client.query(`INSERT INTO public.${quoteIdentifier(table)} (${names})
    SELECT ${names} FROM json_populate_recordset(NULL::public.${quoteIdentifier(table)}, $1::json)`, [JSON.stringify(rows)])
}

async function restoreTeachers(client, schoolId, rows) {
  if (!Array.isArray(rows) || !rows.length) {
    await client.query('UPDATE lesson_teachers SET active=false,source_updated_at=now() WHERE school_id=$1', [schoolId])
    return
  }
  const ids = rows.map(row => row.id).filter(validId)
  await client.query('UPDATE lesson_teachers SET active=false,source_updated_at=now() WHERE school_id=$1 AND NOT (id = ANY($2::uuid[]))', [schoolId, ids])
  const columns = ['id', 'school_id', 'identity_number', 'full_name', 'normalized_name', 'phone', 'active', 'source_updated_at', 'created_at']
  const names = columns.map(quoteIdentifier).join(',')
  const updates = ['identity_number', 'full_name', 'normalized_name', 'phone', 'active', 'source_updated_at'].map(column => `${quoteIdentifier(column)}=EXCLUDED.${quoteIdentifier(column)}`).join(',')
  await client.query(`INSERT INTO lesson_teachers (${names})
    SELECT ${names} FROM json_populate_recordset(NULL::lesson_teachers, $1::json)
    ON CONFLICT (id) DO UPDATE SET ${updates}`, [JSON.stringify(rows)])
}

async function clearTermData(client, schoolId) {
  const tables = await schoolTables(client)
  // تعطيل قيود العلاقات داخل المعاملة فقط يسمح بمسح بيانات الفصل بترتيب آمن حتى
  // مع الجداول المتشابكة، ثم تُعاد القيود قبل تنفيذ المعاملة.
  await client.query("SET LOCAL session_replication_role='replica'")
  for (const table of tables) await client.query(`DELETE FROM public.${quoteIdentifier(table)} WHERE school_id=$1`, [schoolId])
  for (const table of PORTFOLIO_TABLES) await client.query(`DELETE FROM public.${quoteIdentifier(table)} WHERE school_id=$1`, [schoolId])
  await client.query("SET LOCAL session_replication_role='origin'")
  return tables
}

async function ensureActiveTerm(client, schoolId) {
  let result = await client.query(`SELECT * FROM academic_terms WHERE school_id=$1 AND status='active' ORDER BY activated_at DESC LIMIT 1`, [schoolId])
  if (result.rowCount) return result.rows[0]
  const school = await client.query('SELECT academic_year,semester FROM schools WHERE id=$1', [schoolId])
  if (!school.rowCount) throw new Error('school_not_found')
  result = await client.query(`INSERT INTO academic_terms(school_id,academic_year,semester,status,activated_at)
    VALUES($1,$2,$3,'active',now()) RETURNING *`, [schoolId, school.rows[0].academic_year, school.rows[0].semester])
  return result.rows[0]
}

function responseTerm(row) {
  const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : null
  return {
    id: row.id,
    academicYear: row.academic_year,
    semester: row.semester,
    status: row.status,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    archivedAt: row.archived_at,
    summary: row.summary || (snapshot ? termSummary(snapshot) : null),
    hasArchive: Boolean(snapshot?.version),
  }
}

async function schoolProfile(client, schoolId) {
  const result = await client.query(`SELECT name,principal_name,general_education_administration,education_office,academic_year,semester,preferences
    FROM schools WHERE id=$1`, [schoolId])
  const row = result.rows[0]
  if (!row) throw new Error('school_not_found')
  return {
    schoolName: row.name,
    principalName: row.principal_name,
    generalEducationAdministration: row.general_education_administration || '',
    educationOffice: row.education_office || '',
    academicYear: row.academic_year,
    semester: row.semester,
    preferences: row.preferences || {},
  }
}

async function audit(client, schoolId, userId, action, termId, detail = {}) {
  await client.query(`INSERT INTO academic_term_audit(school_id,actor_id,term_id,action,details)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [schoolId, userId, termId, action, JSON.stringify(detail)])
}

async function sendTransitionConfirmationEmail(email, schoolName, activeTerm, target, token) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) throw new Error('email_verification_not_configured')
  const url = confirmationUrl(token)
  const safeSchool = escapeHtml(schoolName)
  const safeActive = escapeHtml(`${activeTerm.semester} ${activeTerm.academic_year}`)
  const safeTarget = escapeHtml(`${target.semester} ${target.academicYear}`)
  const safeUrl = escapeHtml(url)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'نظام حصر الطلاب <no-reply@7asr2030.com>',
        to: [email],
        subject: `تأكيد أرشفة الفصل وفتح فصل جديد: ${schoolName}`,
        text: `طُلب أرشفة ${activeTerm.semester} ${activeTerm.academic_year} وفتح ${target.semester} ${target.academicYear} لمدرسة «${schoolName}».\n\nلن تبدأ الأرشفة ولن تُحذف ملفات إنجاز الطلاب بمجرد الطلب. افتح الرابط التالي ثم اضغط «تأكيد الأرشفة وفتح الفصل» لإتمام العملية:\n${url}\n\nصلاحية الرابط 30 دقيقة ويُستخدم مرة واحدة فقط. إذا لم تطلب أنت ذلك، تجاهل الرسالة.`,
        html: `<div dir="rtl" lang="ar"><h2>تأكيد فتح فصل دراسي جديد</h2><p>طُلب أرشفة <strong>${safeActive}</strong> وفتح <strong>${safeTarget}</strong> لمدرسة <strong>${safeSchool}</strong>.</p><p><strong>لن تُؤرشف أي بيانات ولن تُحذف ملفات إنجاز الطلاب بمجرد الطلب.</strong> افتح الرابط ثم اضغط «تأكيد الأرشفة وفتح الفصل» لإتمام العملية.</p><p><a href="${safeUrl}">مراجعة وتأكيد الطلب</a></p><p>صلاحية الرابط 30 دقيقة ويُستخدم مرة واحدة فقط. إذا لم تطلب أنت ذلك، تجاهل هذه الرسالة.</p></div>`,
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('email_send_failed')
  } catch (error) {
    if (error instanceof Error && error.message === 'email_verification_not_configured') throw error
    throw new Error('email_send_failed')
  } finally { clearTimeout(timeout) }
}

async function createTransitionRequest(termPool, schoolId, userId, target) {
  return withSchool(termPool, schoolId, async client => {
    const active = await ensureActiveTerm(client, schoolId)
    if (active.academic_year === target.academicYear && active.semester === target.semester) throw new Error('term_already_active')
    const existingTerm = await client.query('SELECT 1 FROM academic_terms WHERE school_id=$1 AND academic_year=$2 AND semester=$3', [schoolId, target.academicYear, target.semester])
    if (existingTerm.rowCount) throw new Error('term_already_exists')
    const recipient = await client.query(`SELECT u.email,school.name AS "schoolName"
      FROM memberships member JOIN users u ON u.id=member.user_id
      JOIN schools school ON school.id=member.school_id
      WHERE member.school_id=$1 AND member.role='admin'
      ORDER BY u.created_at ASC LIMIT 1`, [schoolId])
    if (!recipient.rowCount || !/^\S+@\S+\.\S+$/.test(String(recipient.rows[0].email || ''))) throw new Error('school_confirmation_email_missing')
    const token = crypto.randomBytes(32).toString('base64url')
    // طلب واحد فقط معلّق لكل مدرسة: لا يحدث أي تعديل للبيانات عند استبدال طلب تأكيد قديم.
    await client.query("UPDATE academic_term_transition_requests SET status='cancelled' WHERE school_id=$1 AND status='pending'", [schoolId])
    const request = await client.query(`INSERT INTO academic_term_transition_requests(
      school_id,requested_by,recipient_email,target_academic_year,target_semester,token_hash,expires_at,status)
      VALUES($1,$2,$3,$4,$5,$6,now()+interval '30 minutes','pending') RETURNING id`,
    [schoolId, userId, recipient.rows[0].email, target.academicYear, target.semester, tokenHash(token)])
    try {
      await sendTransitionConfirmationEmail(recipient.rows[0].email, recipient.rows[0].schoolName, active, target, token)
    } catch (error) {
      await client.query('DELETE FROM academic_term_transition_requests WHERE id=$1', [request.rows[0].id])
      throw error
    }
    await audit(client, schoolId, userId, 'confirmation_requested', active.id, { target, recipientEmail: recipient.rows[0].email })
    return { recipientEmail: recipient.rows[0].email, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() }
  })
}

async function prepareTerm(client, schoolId, userId, target) {
  const active = await ensureActiveTerm(client, schoolId)
  if (active.academic_year === target.academicYear && active.semester === target.semester) throw new Error('term_already_active')
  const existing = await client.query('SELECT id FROM academic_terms WHERE school_id=$1 AND academic_year=$2 AND semester=$3', [schoolId, target.academicYear, target.semester])
  if (existing.rowCount) throw new Error('term_already_exists')
  const snapshot = await captureSnapshot(client, schoolId)
  const summary = termSummary(snapshot)
  await client.query(`UPDATE academic_terms SET snapshot=$2::jsonb,summary=$3::jsonb,status='archived',archived_at=now()
    WHERE school_id=$1 AND id=$4`, [schoolId, JSON.stringify(snapshot), JSON.stringify(summary), active.id])
  await clearTermData(client, schoolId)
  const created = await client.query(`INSERT INTO academic_terms(school_id,academic_year,semester,status,summary,created_by,activated_at)
    VALUES($1,$2,$3,'active','{}'::jsonb,$4,now()) RETURNING *`, [schoolId, target.academicYear, target.semester, userId])
  await client.query('UPDATE schools SET academic_year=$1,semester=$2 WHERE id=$3', [target.academicYear, target.semester, schoolId])
  await audit(client, schoolId, userId, 'prepared', created.rows[0].id, { archivedTermId: active.id, archivedSummary: summary })
  const school = await schoolProfile(client, schoolId)
  return { term: responseTerm(created.rows[0]), school, archivedSummary: summary }
}

async function withSchool(termPool, schoolId, work) {
  const client = await termPool.connect()
  try {
    await client.query('BEGIN')
    await client.query(`SELECT set_config('app.school_id', $1, true)`, [schoolId])
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* transaction was not opened */ }
    throw error
  } finally { client.release() }
}

export async function migrateAcademicTerms(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS academic_terms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      academic_year text NOT NULL CHECK (length(trim(academic_year)) BETWEEN 3 AND 80),
      semester text NOT NULL CHECK (length(trim(semester)) BETWEEN 2 AND 80),
      status text NOT NULL DEFAULT 'archived' CHECK (status IN ('active','archived')),
      snapshot jsonb,
      summary jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      activated_at timestamptz,
      archived_at timestamptz,
      UNIQUE(school_id,academic_year,semester)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS academic_terms_one_active_per_school
      ON academic_terms(school_id) WHERE status='active';
    CREATE INDEX IF NOT EXISTS academic_terms_school_history
      ON academic_terms(school_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS academic_term_audit (
      id bigserial PRIMARY KEY,
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      term_id uuid REFERENCES academic_terms(id) ON DELETE SET NULL,
      action text NOT NULL CHECK (action IN ('initialized','confirmation_requested','prepared','activated')),
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS academic_term_audit_school_created
      ON academic_term_audit(school_id,created_at DESC);
    ALTER TABLE academic_term_audit DROP CONSTRAINT IF EXISTS academic_term_audit_action_check;
    ALTER TABLE academic_term_audit ADD CONSTRAINT academic_term_audit_action_check
      CHECK (action IN ('initialized','confirmation_requested','prepared','activated'));
    CREATE TABLE IF NOT EXISTS academic_term_transition_requests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
      recipient_email citext NOT NULL,
      target_academic_year text NOT NULL,
      target_semester text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS academic_term_transition_one_pending
      ON academic_term_transition_requests(school_id) WHERE status='pending';
    CREATE INDEX IF NOT EXISTS academic_term_transition_token
      ON academic_term_transition_requests(token_hash,expires_at) WHERE status='pending';
    INSERT INTO academic_terms(school_id,academic_year,semester,status,activated_at)
      SELECT id,academic_year,semester,'active',now() FROM schools school
      WHERE NOT EXISTS (SELECT 1 FROM academic_terms term WHERE term.school_id=school.id AND term.status='active')
      ON CONFLICT (school_id,academic_year,semester) DO NOTHING;
  `)
}

export async function handleAcademicTermPublicRequest({ req, res, url, body, json, termPool }) {
  const token = String(url.searchParams.get('token') || '')
  const validToken = /^[A-Za-z0-9_-]{40,50}$/.test(token)
  if (req.method === 'GET' && url.pathname === '/api/academic-terms/confirmation') {
    if (!validToken) return json(res, 400, { error: 'invalid_or_expired_term_confirmation' }) || true
    const request = await termPool.query(`SELECT request.target_academic_year AS "academicYear",request.target_semester AS semester,
        request.expires_at AS "expiresAt",school.name AS "schoolName",school.academic_year AS "currentAcademicYear",school.semester AS "currentSemester"
      FROM academic_term_transition_requests request JOIN schools school ON school.id=request.school_id
      WHERE request.token_hash=$1 AND request.status='pending' AND request.expires_at>now()`, [tokenHash(token)])
    if (!request.rowCount) return json(res, 400, { error: 'invalid_or_expired_term_confirmation' }) || true
    return json(res, 200, { request: request.rows[0] }) || true
  }
  if (req.method === 'POST' && url.pathname === '/api/academic-terms/confirmation') {
    const input = await body(req)
    const submittedToken = String(input.token || '')
    if (!/^[A-Za-z0-9_-]{40,50}$/.test(submittedToken)) return json(res, 400, { error: 'invalid_or_expired_term_confirmation' }) || true
    const initial = await termPool.query(`SELECT school_id FROM academic_term_transition_requests
      WHERE token_hash=$1 AND status='pending' AND expires_at>now()`, [tokenHash(submittedToken)])
    if (!initial.rowCount) return json(res, 400, { error: 'invalid_or_expired_term_confirmation' }) || true
    try {
      const result = await withSchool(termPool, initial.rows[0].school_id, async client => {
        const pending = await client.query(`SELECT * FROM academic_term_transition_requests
          WHERE token_hash=$1 AND status='pending' AND expires_at>now() FOR UPDATE`, [tokenHash(submittedToken)])
        if (!pending.rowCount) throw new Error('invalid_or_expired_term_confirmation')
        const request = pending.rows[0]
        const target = validTerm({ academicYear: request.target_academic_year, semester: request.target_semester })
        if (!target) throw new Error('invalid_or_expired_term_confirmation')
        const prepared = await prepareTerm(client, request.school_id, request.requested_by, target)
        await client.query("UPDATE academic_term_transition_requests SET status='confirmed',confirmed_at=now() WHERE id=$1", [request.id])
        return prepared
      })
      return json(res, 200, { ok: true, term: result.term }) || true
    } catch (error) {
      const code = error instanceof Error ? error.message : ''
      const known = new Set(['invalid_or_expired_term_confirmation', 'term_already_active', 'term_already_exists'])
      return json(res, known.has(code) ? 400 : 500, { error: known.has(code) ? code : 'term_confirmation_failed' }) || true
    }
  }
  return false
}

export async function handleAcademicTermRequest({ req, res, url, user, body, json, termPool }) {
  if (!url.pathname.startsWith('/api/academic-terms')) return false
  try {
    const schoolRoles = new Set(['admin', 'vice_principal'])
    if (!schoolRoles.has(user.role)) return json(res, 403, { error: 'forbidden' }) || true

    if (req.method === 'GET' && url.pathname === '/api/academic-terms') {
      const terms = await withSchool(termPool, user.school_id, async client => {
        await ensureActiveTerm(client, user.school_id)
        return (await client.query('SELECT * FROM academic_terms WHERE school_id=$1 ORDER BY status=\'active\' DESC,created_at DESC', [user.school_id])).rows
      })
      return json(res, 200, { terms: terms.map(responseTerm), canManage: user.role === 'admin' }) || true
    }

    const archiveRoute = /^\/api\/academic-terms\/([0-9a-f-]{36})\/archive$/i.exec(url.pathname)
    if (req.method === 'GET' && archiveRoute) {
      const result = await withSchool(termPool, user.school_id, async client => client.query('SELECT * FROM academic_terms WHERE school_id=$1 AND id=$2', [user.school_id, archiveRoute[1]]))
      if (!result.rowCount) return json(res, 404, { error: 'term_not_found' }) || true
      const row = result.rows[0]
      const snapshot = row.snapshot && typeof row.snapshot === 'object' ? row.snapshot : null
      if (!snapshot) return json(res, 409, { error: 'term_archive_not_ready' }) || true
      const tables = snapshot.tables || {}
      const students = Array.isArray(tables.students) ? tables.students.slice(0, 5000).map(item => ({
        id: item.id, name: item.name, grade: item.grade, classroom: item.classroom, active: item.active,
      })) : []
      return json(res, 200, {
        term: responseTerm(row),
        archive: {
          students,
          subjects: Array.from(new Set((Array.isArray(tables.lesson_schedule_assignments) ? tables.lesson_schedule_assignments : []).map(item => item.subject_name).filter(Boolean))).sort(),
          summary: termSummary(snapshot),
        },
      }) || true
    }

    if (user.role !== 'admin') return json(res, 403, { error: 'term_management_admin_only' }) || true

    if (req.method === 'POST' && url.pathname === '/api/academic-terms/prepare') {
      const input = await body(req)
      const target = validTerm(input)
      if (!target) return json(res, 400, { error: 'invalid_term' }) || true
      if (String(input.confirmation || '').trim() !== 'فتح فصل دراسي جديد') return json(res, 400, { error: 'term_confirmation_required' }) || true
      const request = await createTransitionRequest(termPool, user.school_id, user.user_id, target)
      return json(res, 200, {
        ok: true,
        verificationRequired: true,
        recipientEmail: request.recipientEmail,
        expiresAt: request.expiresAt,
      }) || true
    }

    if (req.method === 'POST' && url.pathname === '/api/academic-terms/resend-confirmation') {
      const pending = await termPool.query(`SELECT target_academic_year AS "academicYear",target_semester AS semester
        FROM academic_term_transition_requests
        WHERE school_id=$1 AND status='pending' AND expires_at>now()
        ORDER BY created_at DESC LIMIT 1`, [user.school_id])
      if (!pending.rowCount) return json(res, 409, { error: 'no_pending_term_confirmation' }) || true
      const target = validTerm(pending.rows[0])
      if (!target) return json(res, 400, { error: 'invalid_term' }) || true
      const request = await createTransitionRequest(termPool, user.school_id, user.user_id, target)
      return json(res, 200, {
        ok: true,
        recipientEmail: request.recipientEmail,
        expiresAt: request.expiresAt,
      }) || true
    }

    if (req.method === 'POST' && url.pathname === '/api/academic-terms/cancel-confirmation') {
      const pending = await termPool.query(`SELECT id FROM academic_term_transition_requests
        WHERE school_id=$1 AND status='pending' AND expires_at>now()
        ORDER BY created_at DESC LIMIT 1`, [user.school_id])
      if (!pending.rowCount) return json(res, 409, { error: 'no_pending_term_confirmation_to_cancel' }) || true
      await termPool.query(`UPDATE academic_term_transition_requests SET status='cancelled',confirmed_at=NULL
        WHERE id=$1 AND status='pending'`, [pending.rows[0].id])
      return json(res, 200, { ok: true }) || true
    }

    const activateRoute = /^\/api\/academic-terms\/([0-9a-f-]{36})\/activate$/i.exec(url.pathname)
    if (req.method === 'POST' && activateRoute) {
      const input = await body(req)
      if (String(input.confirmation || '').trim() !== 'استعادة الفصل الدراسي') return json(res, 400, { error: 'term_activation_confirmation_required' }) || true
      const payload = await withSchool(termPool, user.school_id, async client => {
          const targetResult = await client.query('SELECT * FROM academic_terms WHERE school_id=$1 AND id=$2', [user.school_id, activateRoute[1]])
          if (!targetResult.rowCount) throw new Error('term_not_found')
          const target = targetResult.rows[0]
          if (target.status === 'active') {
            const school = await schoolProfile(client, user.school_id)
            return { term: responseTerm(target), school }
          }
          if (!target.snapshot || typeof target.snapshot !== 'object' || !target.snapshot.tables) throw new Error('term_archive_not_ready')
          const active = await ensureActiveTerm(client, user.school_id)
          const currentSnapshot = await captureSnapshot(client, user.school_id)
          await client.query(`UPDATE academic_terms SET snapshot=$2::jsonb,summary=$3::jsonb,status='archived',archived_at=now()
            WHERE school_id=$1 AND id=$4`, [user.school_id, JSON.stringify(currentSnapshot), JSON.stringify(termSummary(currentSnapshot)), active.id])
          const tables = await clearTermData(client, user.school_id)
          await client.query("SET LOCAL session_replication_role='replica'")
          for (const table of tables) await restoreRows(client, table, target.snapshot.tables[table])
          await restoreTeachers(client, user.school_id, target.snapshot.teachers)
          await client.query("SET LOCAL session_replication_role='origin'")
          await client.query(`UPDATE academic_terms SET status='active',activated_at=now() WHERE school_id=$1 AND id=$2`, [user.school_id, target.id])
          await client.query('UPDATE schools SET academic_year=$1,semester=$2 WHERE id=$3', [target.academic_year, target.semester, user.school_id])
          await audit(client, user.school_id, user.user_id, 'activated', target.id, { archivedTermId: active.id })
          const school = await schoolProfile(client, user.school_id)
          return { term: responseTerm({ ...target, status: 'active' }), school }
      })
      return json(res, 200, { ok: true, ...payload }) || true
    }

    return false
  } catch (error) {
    const message = error instanceof Error ? error.message : 'term_operation_failed'
    const known = new Set(['invalid_term', 'term_confirmation_required', 'term_activation_confirmation_required', 'term_already_active', 'term_already_exists', 'term_not_found', 'term_archive_not_ready', 'school_not_found'])
    return json(res, known.has(message) ? 400 : 500, { error: known.has(message) ? message : 'term_operation_failed' }) || true
  }
}
