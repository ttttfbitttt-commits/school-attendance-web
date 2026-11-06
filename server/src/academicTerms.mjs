// الفصل الدراسي في النظام لا يغيّر هوية المدرسة أو حساباتها.  بدلاً من ذلك
// نحفظ لقطة قابلة للاستعادة من بيانات الفصل، ثم نفتح مساحة عمل نظيفة للفصل التالي.
// هذا يجعل جميع الواجهات الحالية ترى الفصل النشط تلقائياً، لأن مصدرها يبقى الجداول
// نفسها، ويمنع خلط بيانات مدرستين أو فصلين.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// هذه السجلات تخص هوية المدرسة أو حسابات أفرادها، وليست محتوى فصل دراسي. تبقى
// مستمرة عند بدء فصل جديد؛ أما بقية السجلات التي تحمل school_id فتؤرشف للفصل.
const PERSISTENT_TABLES = new Set([
  'academic_terms', 'academic_term_audit', 'school_backup_audit', 'school_login_activity',
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
      action text NOT NULL CHECK (action IN ('initialized','prepared','activated')),
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS academic_term_audit_school_created
      ON academic_term_audit(school_id,created_at DESC);
    INSERT INTO academic_terms(school_id,academic_year,semester,status,activated_at)
      SELECT id,academic_year,semester,'active',now() FROM schools school
      WHERE NOT EXISTS (SELECT 1 FROM academic_terms term WHERE term.school_id=school.id AND term.status='active')
      ON CONFLICT (school_id,academic_year,semester) DO NOTHING;
  `)
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
      const payload = await withSchool(termPool, user.school_id, async client => {
          const active = await ensureActiveTerm(client, user.school_id)
          if (active.academic_year === target.academicYear && active.semester === target.semester) throw new Error('term_already_active')
          const existing = await client.query('SELECT id FROM academic_terms WHERE school_id=$1 AND academic_year=$2 AND semester=$3', [user.school_id, target.academicYear, target.semester])
          if (existing.rowCount) throw new Error('term_already_exists')
          const snapshot = await captureSnapshot(client, user.school_id)
          const summary = termSummary(snapshot)
          await client.query(`UPDATE academic_terms SET snapshot=$2::jsonb,summary=$3::jsonb,status='archived',archived_at=now()
            WHERE school_id=$1 AND id=$4`, [user.school_id, JSON.stringify(snapshot), JSON.stringify(summary), active.id])
          await clearTermData(client, user.school_id)
          const created = await client.query(`INSERT INTO academic_terms(school_id,academic_year,semester,status,summary,created_by,activated_at)
            VALUES($1,$2,$3,'active','{}'::jsonb,$4,now()) RETURNING *`, [user.school_id, target.academicYear, target.semester, user.user_id])
          await client.query('UPDATE schools SET academic_year=$1,semester=$2 WHERE id=$3', [target.academicYear, target.semester, user.school_id])
          await audit(client, user.school_id, user.user_id, 'prepared', created.rows[0].id, { archivedTermId: active.id, archivedSummary: summary })
          const school = await schoolProfile(client, user.school_id)
          return { term: responseTerm(created.rows[0]), school, archivedSummary: summary }
      })
      return json(res, 200, { ok: true, ...payload }) || true
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
