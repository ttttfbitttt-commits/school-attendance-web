const DEFAULT_COUNSELOR_PASSWORD = '12345678'

const clean = (value, max = 200) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const identityNumber = value => String(value ?? '').replace(/\s/g, '').replace(/[^0-9]/g, '')
const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''))
const localEmail = (schoolId, counselorId) => `counselor-${schoolId}-${counselorId}@local.invalid`

export async function migrateCounselorPortal(adminPool) {
  await adminPool.query(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin','staff','teacher','administrator','student','counselor','vice_principal','activity_leader'));

    CREATE TABLE IF NOT EXISTS student_counselors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      full_name text NOT NULL,
      identity_number text NOT NULL,
      phone text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id, id),
      UNIQUE (school_id, identity_number)
    );
    CREATE INDEX IF NOT EXISTS student_counselors_school_name ON student_counselors(school_id, full_name);

    CREATE TABLE IF NOT EXISTS counselor_login_accounts (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      counselor_id uuid NOT NULL REFERENCES student_counselors(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identity_number text NOT NULL,
      password_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id, counselor_id),
      UNIQUE (school_id, identity_number),
      UNIQUE (school_id, user_id),
      FOREIGN KEY (school_id, counselor_id) REFERENCES student_counselors(school_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS counselor_login_accounts_identity ON counselor_login_accounts(identity_number) WHERE active=true;

    CREATE TABLE IF NOT EXISTS student_counselor_grade_assignments (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      counselor_id uuid NOT NULL,
      grade text NOT NULL CHECK (btrim(grade) <> ''),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id, counselor_id, grade),
      UNIQUE (school_id, grade),
      FOREIGN KEY (school_id, counselor_id) REFERENCES student_counselors(school_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS student_counselor_grade_assignments_counselor
      ON student_counselor_grade_assignments(school_id, counselor_id, grade);

    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS referred_counselor_id uuid REFERENCES student_counselors(id) ON DELETE SET NULL;
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS referred_counselor_name text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS referral_note text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS referred_by_name text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS referred_at timestamptz;
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS counselor_action text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS counselor_plan text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS counselor_acted_by uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS counselor_name text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS counselor_acted_at timestamptz;
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS case_state text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS vice_decision_note text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS vice_decided_by uuid REFERENCES users(id) ON DELETE SET NULL;
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS vice_decided_by_name text NOT NULL DEFAULT '';
    ALTER TABLE absence_follow_up_cases ADD COLUMN IF NOT EXISTS vice_decided_at timestamptz;
  `)
}

const selectedGrades = value => [...new Set((Array.isArray(value) ? value : []).map(grade => clean(grade, 120)).filter(Boolean))]

async function gradeOptions(client, schoolId) {
  const rows = (await client.query(`SELECT grade, counselor_id AS "counselorId" FROM student_counselor_grade_assignments WHERE school_id=$1
    UNION
    SELECT grade, NULL::uuid AS "counselorId" FROM students WHERE school_id=$1 AND active=true AND btrim(grade)<>''
    ORDER BY grade`, [schoolId])).rows
  return rows.reduce((options, row) => {
    const current = options.get(row.grade)
    if (!current || row.counselorId) options.set(row.grade, { grade: row.grade, counselorId: row.counselorId || null })
    return options
  }, new Map())
}

async function validateGrades(client, schoolId, grades, counselorId = '') {
  if (!grades.length) return { error: 'counselor_grades_required' }
  const valid = await client.query(`SELECT DISTINCT grade FROM students
    WHERE school_id=$1 AND active=true AND grade=ANY($2::text[])`, [schoolId, grades])
  if (valid.rowCount !== grades.length) return { error: 'invalid_counselor_grades' }
  const used = await client.query(`SELECT grade FROM student_counselor_grade_assignments
    WHERE school_id=$1 AND grade=ANY($2::text[])${counselorId ? ' AND counselor_id<>$3' : ''}`, counselorId ? [schoolId, grades, counselorId] : [schoolId, grades])
  if (used.rowCount) return { error: 'counselor_grade_taken', grades: used.rows.map(row => row.grade) }
  return { grades }
}

async function overview(user, scoped, authPool) {
  const data = await scoped(user.school_id, async client => {
    const counselors = (await client.query(`SELECT c.id AS "counselorId",c.full_name AS name,c.identity_number AS "identityNumber",c.phone,c.active,
      COALESCE(array_agg(g.grade ORDER BY g.grade) FILTER (WHERE g.grade IS NOT NULL),'{}'::text[]) AS "assignedGrades"
      FROM student_counselors c LEFT JOIN student_counselor_grade_assignments g ON g.school_id=c.school_id AND g.counselor_id=c.id
      WHERE c.school_id=$1 GROUP BY c.id ORDER BY c.active DESC,c.full_name`, [user.school_id])).rows
    const grades = [...(await gradeOptions(client, user.school_id)).values()]
    return { counselors, grades }
  })
  const accounts = await authPool.query(`SELECT counselor_id AS "counselorId",active AS "accountActive",must_change_password AS "mustChangePassword"
    FROM counselor_login_accounts WHERE school_id=$1`, [user.school_id])
  const byCounselor = new Map(accounts.rows.map(row => [row.counselorId, row]))
  return { defaultPassword: DEFAULT_COUNSELOR_PASSWORD, grades: data.grades, counselors: data.counselors.map(counselor => {
    const account = byCounselor.get(counselor.counselorId)
    return { ...counselor, active: Boolean(counselor.active), accountCreated: Boolean(account), accountActive: Boolean(account?.accountActive), mustChangePassword: Boolean(account?.mustChangePassword) }
  }) }
}

export async function handleCounselorPortalRequest(context) {
  const { req, res, url, user, body, json, scoped, authPool, passwordHash } = context
  if (!url.pathname.startsWith('/api/counselor-portal')) return false
  const adminOnly = () => user.role === 'admin'
  const counselorOnly = () => user.role === 'counselor' && validUuid(user.counselor_id)

  if (req.method === 'GET' && url.pathname === '/api/counselor-portal/admin/overview') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    json(res, 200, await overview(user, scoped, authPool))
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/counselor-portal/admin/counselors') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const name = clean(input.name, 180)
    const identity = identityNumber(input.identityNumber)
    const phone = clean(input.phone, 48)
    const grades = selectedGrades(input.grades)
    if (!name || identity.length < 6 || !phone) { json(res, 400, { error: 'invalid_counselor' }); return true }
    const result = await scoped(user.school_id, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.school_id])
      const checked = await validateGrades(client, user.school_id, grades)
      if (checked.error) return checked
      const inserted = await client.query(`INSERT INTO student_counselors(school_id,full_name,identity_number,phone)
        VALUES($1,$2,$3,$4) ON CONFLICT(school_id,identity_number) DO NOTHING
        RETURNING id AS "counselorId",full_name AS name,identity_number AS "identityNumber",phone,active`, [user.school_id, name, identity, phone])
      if (!inserted.rowCount) return { error: 'counselor_identity_exists' }
      await client.query(`INSERT INTO student_counselor_grade_assignments(school_id,counselor_id,grade)
        SELECT $1,$2,grade FROM unnest($3::text[]) AS grade`, [user.school_id, inserted.rows[0].counselorId, grades])
      return { counselor: { ...inserted.rows[0], assignedGrades: grades } }
    })
    if (result.error) { json(res, result.error === 'counselor_identity_exists' || result.error === 'counselor_grade_taken' ? 409 : 400, result); return true }
    json(res, 201, { ok: true, counselor: { ...result.counselor, active: true, accountCreated: false, accountActive: false, mustChangePassword: false } })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/counselor-portal/admin/counselors/grades') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const counselorId = String(input.counselorId || '')
    const grades = selectedGrades(input.grades)
    if (!validUuid(counselorId)) { json(res, 400, { error: 'invalid_counselor' }); return true }
    const result = await scoped(user.school_id, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.school_id])
      const counselor = await client.query('SELECT 1 FROM student_counselors WHERE school_id=$1 AND id=$2', [user.school_id, counselorId])
      if (!counselor.rowCount) return { error: 'counselor_not_found' }
      const checked = await validateGrades(client, user.school_id, grades, counselorId)
      if (checked.error) return checked
      await client.query('DELETE FROM student_counselor_grade_assignments WHERE school_id=$1 AND counselor_id=$2', [user.school_id, counselorId])
      await client.query(`INSERT INTO student_counselor_grade_assignments(school_id,counselor_id,grade)
        SELECT $1,$2,grade FROM unnest($3::text[]) AS grade`, [user.school_id, counselorId, grades])
      return { assignedGrades: grades }
    })
    if (result.error) { json(res, result.error === 'counselor_grade_taken' ? 409 : result.error === 'counselor_not_found' ? 404 : 400, result); return true }
    json(res, 200, { ok: true, ...result })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/counselor-portal/admin/accounts/activate') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const counselorId = String(input.counselorId || '')
    if (!validUuid(counselorId)) { json(res, 400, { error: 'invalid_counselor' }); return true }
    const counselor = await scoped(user.school_id, async client => (await client.query(`SELECT id,full_name,identity_number,active FROM student_counselors
      WHERE school_id=$1 AND id=$2`, [user.school_id, counselorId])).rows[0])
    if (!counselor || !counselor.active) { json(res, 404, { error: 'counselor_not_found' }); return true }
    const hash = passwordHash(DEFAULT_COUNSELOR_PASSWORD)
    const existing = await authPool.query(`SELECT user_id FROM counselor_login_accounts WHERE school_id=$1 AND counselor_id=$2`, [user.school_id, counselorId])
    let userId = existing.rows[0]?.user_id
    if (!userId) {
      const savedUser = await authPool.query(`INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3)
        ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name RETURNING id`, [localEmail(user.school_id, counselorId), hash, counselor.full_name])
      userId = savedUser.rows[0].id
      await authPool.query(`INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,'counselor')
        ON CONFLICT(school_id,user_id) DO UPDATE SET role='counselor'`, [user.school_id, userId])
      await authPool.query(`INSERT INTO counselor_login_accounts(school_id,counselor_id,user_id,identity_number,password_hash,active,must_change_password)
        VALUES($1,$2,$3,$4,$5,true,true)`, [user.school_id, counselorId, userId, counselor.identity_number, hash])
    } else {
      await authPool.query(`UPDATE counselor_login_accounts SET password_hash=$1,active=true,must_change_password=true,updated_at=now()
        WHERE school_id=$2 AND counselor_id=$3`, [hash, user.school_id, counselorId])
      await authPool.query('UPDATE users SET password_hash=$1,display_name=$2 WHERE id=$3', [hash, counselor.full_name, userId])
      await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [userId, user.school_id])
    }
    json(res, 200, { ok: true, temporaryPassword: DEFAULT_COUNSELOR_PASSWORD })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/counselor-portal/admin/accounts/reset') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const counselorId = String((await body(req)).counselorId || '')
    if (!validUuid(counselorId)) { json(res, 400, { error: 'invalid_counselor' }); return true }
    const hash = passwordHash(DEFAULT_COUNSELOR_PASSWORD)
    const changed = await authPool.query(`UPDATE counselor_login_accounts SET password_hash=$1,active=true,must_change_password=true,updated_at=now()
      WHERE school_id=$2 AND counselor_id=$3 RETURNING user_id`, [hash, user.school_id, counselorId])
    if (!changed.rowCount) { json(res, 404, { error: 'counselor_account_not_found' }); return true }
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, changed.rows[0].user_id])
    await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true, temporaryPassword: DEFAULT_COUNSELOR_PASSWORD })
    return true
  }

  if (req.method === 'PATCH' && url.pathname === '/api/counselor-portal/admin/accounts/status') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const counselorId = String(input.counselorId || '')
    if (!validUuid(counselorId) || typeof input.active !== 'boolean') { json(res, 400, { error: 'invalid_counselor_account_status' }); return true }
    const changed = await authPool.query(`UPDATE counselor_login_accounts SET active=$1,updated_at=now()
      WHERE school_id=$2 AND counselor_id=$3 RETURNING user_id`, [input.active, user.school_id, counselorId])
    if (!changed.rowCount) { json(res, 404, { error: 'counselor_account_not_found' }); return true }
    if (!input.active) await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/counselor-portal/counselor/dashboard') {
    if (!counselorOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const dashboard = await scoped(user.school_id, async client => {
      const grades = (await client.query(`SELECT grade FROM student_counselor_grade_assignments
        WHERE school_id=$1 AND counselor_id=$2 ORDER BY grade`, [user.school_id, user.counselor_id])).rows.map(row => row.grade)
      const [school, counselor, students, teachers] = await Promise.all([
        client.query('SELECT name FROM schools WHERE id=$1', [user.school_id]),
        client.query(`SELECT full_name AS name,identity_number AS "identityNumber",phone FROM student_counselors WHERE school_id=$1 AND id=$2 AND active=true`, [user.school_id, user.counselor_id]),
        client.query(`SELECT id,name,phone,grade,classroom FROM students WHERE school_id=$1 AND active=true AND grade=ANY($2::text[]) ORDER BY grade,classroom,name`, [user.school_id, grades]),
        client.query(`SELECT DISTINCT t.id AS "teacherId",t.full_name AS name,t.identity_number AS "identityNumber",t.phone
          FROM lesson_teachers t JOIN lesson_schedule_assignments a ON a.school_id=t.school_id AND a.teacher_id=t.id
          JOIN teacher_classroom_student_maps m ON m.school_id=a.school_id AND m.classroom_id=a.classroom_id
          WHERE t.school_id=$1 AND t.active=true AND m.grade_value=ANY($2::text[]) ORDER BY name`, [user.school_id, grades]),
      ])
      if (!counselor.rowCount) return null
      return { schoolName: school.rows[0]?.name || '', counselor: counselor.rows[0], assignedGrades: grades, students: students.rows, teachers: teachers.rows }
    })
    if (!dashboard) { json(res, 404, { error: 'counselor_not_found' }); return true }
    json(res, 200, { ...dashboard, mustChangePassword: Boolean(user.must_change_password) })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/counselor-portal/counselor/password') {
    if (!counselorOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const password = String((await body(req)).password || '')
    if (password.length < 8 || password.length > 200) { json(res, 400, { error: 'invalid_counselor_password' }); return true }
    const hash = passwordHash(password)
    const changed = await authPool.query(`UPDATE counselor_login_accounts SET password_hash=$1,must_change_password=false,updated_at=now()
      WHERE school_id=$2 AND counselor_id=$3 RETURNING user_id`, [hash, user.school_id, user.counselor_id])
    if (!changed.rowCount) { json(res, 404, { error: 'counselor_account_not_found' }); return true }
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, changed.rows[0].user_id])
    json(res, 200, { ok: true })
    return true
  }

  json(res, 404, { error: 'counselor_portal_route_not_found' })
  return true
}
