const DEFAULT_VICE_PRINCIPAL_PASSWORD = '12345678'

const clean = (value, max = 200) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const identityNumber = value => String(value ?? '').replace(/\s/g, '').replace(/[^0-9]/g, '')
const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''))
const localEmail = (schoolId, vicePrincipalId) => `vice-principal-${schoolId}-${vicePrincipalId}@local.invalid`

export async function migrateVicePrincipalPortal(adminPool) {
  await adminPool.query(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin','staff','teacher','administrator','student','counselor','vice_principal'));

    CREATE TABLE IF NOT EXISTS school_vice_principals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      full_name text NOT NULL,
      identity_number text NOT NULL,
      phone text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,id),
      UNIQUE (school_id,identity_number)
    );
    CREATE INDEX IF NOT EXISTS school_vice_principals_school_name ON school_vice_principals(school_id,full_name);

    CREATE TABLE IF NOT EXISTS vice_principal_login_accounts (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      vice_principal_id uuid NOT NULL REFERENCES school_vice_principals(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identity_number text NOT NULL,
      password_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,vice_principal_id),
      UNIQUE (school_id,identity_number),
      UNIQUE (school_id,user_id),
      FOREIGN KEY (school_id,vice_principal_id) REFERENCES school_vice_principals(school_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS vice_principal_login_accounts_identity ON vice_principal_login_accounts(identity_number) WHERE active=true;

    CREATE TABLE IF NOT EXISTS vice_principal_grade_assignments (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      vice_principal_id uuid NOT NULL,
      grade text NOT NULL CHECK (btrim(grade) <> ''),
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,vice_principal_id,grade),
      UNIQUE (school_id,grade),
      FOREIGN KEY (school_id,vice_principal_id) REFERENCES school_vice_principals(school_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS vice_principal_grade_assignments_principal
      ON vice_principal_grade_assignments(school_id,vice_principal_id,grade);
  `)
}

const selectedGrade = value => clean(value, 120)

async function gradeOptions(client, schoolId) {
  const rows = (await client.query(`SELECT grade, vice_principal_id AS "vicePrincipalId" FROM vice_principal_grade_assignments WHERE school_id=$1
    UNION
    SELECT grade, NULL::uuid AS "vicePrincipalId" FROM students WHERE school_id=$1 AND active=true AND btrim(grade)<>''
    ORDER BY grade`, [schoolId])).rows
  return rows.reduce((options, row) => {
    const current = options.get(row.grade)
    if (!current || row.vicePrincipalId) options.set(row.grade, { grade: row.grade, vicePrincipalId: row.vicePrincipalId || null })
    return options
  }, new Map())
}

async function validateGrade(client, schoolId, grade, vicePrincipalId = '') {
  if (!grade) return { error: 'vice_principal_grade_required' }
  const valid = await client.query(`SELECT 1 FROM students WHERE school_id=$1 AND active=true AND grade=$2 LIMIT 1`, [schoolId, grade])
  if (!valid.rowCount) return { error: 'invalid_vice_principal_grade' }
  const used = await client.query(`SELECT grade FROM vice_principal_grade_assignments
    WHERE school_id=$1 AND grade=$2${vicePrincipalId ? ' AND vice_principal_id<>$3' : ''}`, vicePrincipalId ? [schoolId, grade, vicePrincipalId] : [schoolId, grade])
  if (used.rowCount) return { error: 'vice_principal_grade_taken', grade }
  return { grade }
}

async function overview(user, scoped, authPool) {
  const data = await scoped(user.school_id, async client => {
    const vicePrincipals = (await client.query(`SELECT p.id AS "vicePrincipalId",p.full_name AS name,p.identity_number AS "identityNumber",p.phone,p.active,
      COALESCE(MAX(a.grade) FILTER (WHERE a.grade IS NOT NULL),'') AS grade
      FROM school_vice_principals p LEFT JOIN vice_principal_grade_assignments a ON a.school_id=p.school_id AND a.vice_principal_id=p.id
      WHERE p.school_id=$1 GROUP BY p.id ORDER BY p.active DESC,p.full_name`, [user.school_id])).rows
    return { vicePrincipals, grades: [...(await gradeOptions(client, user.school_id)).values()] }
  })
  const accounts = await authPool.query(`SELECT vice_principal_id AS "vicePrincipalId",active AS "accountActive",must_change_password AS "mustChangePassword"
    FROM vice_principal_login_accounts WHERE school_id=$1`, [user.school_id])
  const byPrincipal = new Map(accounts.rows.map(row => [row.vicePrincipalId, row]))
  return {
    defaultPassword: DEFAULT_VICE_PRINCIPAL_PASSWORD,
    grades: data.grades,
    vicePrincipals: data.vicePrincipals.map(principal => {
      const account = byPrincipal.get(principal.vicePrincipalId)
      return { ...principal, active: Boolean(principal.active), accountCreated: Boolean(account), accountActive: Boolean(account?.accountActive), mustChangePassword: Boolean(account?.mustChangePassword) }
    }),
  }
}

export async function handleVicePrincipalPortalRequest(context) {
  const { req, res, url, user, body, json, scoped, authPool, passwordHash } = context
  if (!url.pathname.startsWith('/api/vice-principals')) return false
  const adminOnly = () => user.role === 'admin'

  if (req.method === 'GET' && url.pathname === '/api/vice-principals/admin/overview') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    json(res, 200, await overview(user, scoped, authPool)); return true
  }

  if (req.method === 'POST' && url.pathname === '/api/vice-principals/admin') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const name = clean(input.name, 180)
    const identity = identityNumber(input.identityNumber)
    const phone = clean(input.phone, 48)
    const grade = selectedGrade(input.grade)
    if (!name || identity.length < 6 || !phone) { json(res, 400, { error: 'invalid_vice_principal' }); return true }
    const result = await scoped(user.school_id, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.school_id])
      const checked = await validateGrade(client, user.school_id, grade)
      if (checked.error) return checked
      const inserted = await client.query(`INSERT INTO school_vice_principals(school_id,full_name,identity_number,phone)
        VALUES($1,$2,$3,$4) ON CONFLICT(school_id,identity_number) DO NOTHING
        RETURNING id AS "vicePrincipalId",full_name AS name,identity_number AS "identityNumber",phone,active`, [user.school_id, name, identity, phone])
      if (!inserted.rowCount) return { error: 'vice_principal_identity_exists' }
      await client.query(`INSERT INTO vice_principal_grade_assignments(school_id,vice_principal_id,grade) VALUES($1,$2,$3)`, [user.school_id, inserted.rows[0].vicePrincipalId, grade])
      return { vicePrincipal: { ...inserted.rows[0], grade } }
    })
    if (result.error) { json(res, ['vice_principal_identity_exists','vice_principal_grade_taken'].includes(result.error) ? 409 : 400, result); return true }
    json(res, 201, { ok: true, vicePrincipal: { ...result.vicePrincipal, active: true, accountCreated: false, accountActive: false, mustChangePassword: false } }); return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/vice-principals/admin/grade') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const vicePrincipalId = String(input.vicePrincipalId || '')
    const grade = selectedGrade(input.grade)
    if (!validUuid(vicePrincipalId)) { json(res, 400, { error: 'invalid_vice_principal' }); return true }
    const result = await scoped(user.school_id, async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.school_id])
      const principal = await client.query('SELECT 1 FROM school_vice_principals WHERE school_id=$1 AND id=$2', [user.school_id, vicePrincipalId])
      if (!principal.rowCount) return { error: 'vice_principal_not_found' }
      const checked = await validateGrade(client, user.school_id, grade, vicePrincipalId)
      if (checked.error) return checked
      await client.query('DELETE FROM vice_principal_grade_assignments WHERE school_id=$1 AND vice_principal_id=$2', [user.school_id, vicePrincipalId])
      await client.query(`INSERT INTO vice_principal_grade_assignments(school_id,vice_principal_id,grade) VALUES($1,$2,$3)`, [user.school_id, vicePrincipalId, grade])
      return { grade }
    })
    if (result.error) { json(res, result.error === 'vice_principal_grade_taken' ? 409 : result.error === 'vice_principal_not_found' ? 404 : 400, result); return true }
    json(res, 200, { ok: true, ...result }); return true
  }

  const activate = async (vicePrincipalId, reset = false) => {
    if (!validUuid(vicePrincipalId)) return { error: 'invalid_vice_principal' }
    const principal = await scoped(user.school_id, async client => (await client.query(`SELECT id,full_name,identity_number,active FROM school_vice_principals WHERE school_id=$1 AND id=$2`, [user.school_id, vicePrincipalId])).rows[0])
    if (!principal || !principal.active) return { error: 'vice_principal_not_found' }
    const hash = passwordHash(DEFAULT_VICE_PRINCIPAL_PASSWORD)
    const existing = await authPool.query(`SELECT user_id FROM vice_principal_login_accounts WHERE school_id=$1 AND vice_principal_id=$2`, [user.school_id, vicePrincipalId])
    let userId = existing.rows[0]?.user_id
    if (!userId) {
      const savedUser = await authPool.query(`INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3)
        ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name RETURNING id`, [localEmail(user.school_id, vicePrincipalId), hash, principal.full_name])
      userId = savedUser.rows[0].id
      await authPool.query(`INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,'vice_principal') ON CONFLICT(school_id,user_id) DO UPDATE SET role='vice_principal'`, [user.school_id, userId])
      await authPool.query(`INSERT INTO vice_principal_login_accounts(school_id,vice_principal_id,user_id,identity_number,password_hash,active,must_change_password)
        VALUES($1,$2,$3,$4,$5,true,true)`, [user.school_id, vicePrincipalId, userId, principal.identity_number, hash])
    } else {
      await authPool.query(`UPDATE vice_principal_login_accounts SET password_hash=$1,active=true,must_change_password=true,updated_at=now() WHERE school_id=$2 AND vice_principal_id=$3`, [hash, user.school_id, vicePrincipalId])
      await authPool.query('UPDATE users SET password_hash=$1,display_name=$2 WHERE id=$3', [hash, principal.full_name, userId])
      await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [userId, user.school_id])
    }
    return { ok: true, temporaryPassword: DEFAULT_VICE_PRINCIPAL_PASSWORD, reset }
  }

  if (req.method === 'POST' && url.pathname === '/api/vice-principals/admin/accounts/activate') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const result = await activate(String((await body(req)).vicePrincipalId || ''))
    json(res, result.error ? 404 : 200, result); return true
  }
  if (req.method === 'POST' && url.pathname === '/api/vice-principals/admin/accounts/reset') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const result = await activate(String((await body(req)).vicePrincipalId || ''), true)
    json(res, result.error ? 404 : 200, result); return true
  }
  if (req.method === 'PATCH' && url.pathname === '/api/vice-principals/admin/accounts/status') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const vicePrincipalId = String(input.vicePrincipalId || '')
    if (!validUuid(vicePrincipalId) || typeof input.active !== 'boolean') { json(res, 400, { error: 'invalid_vice_principal_account_status' }); return true }
    const changed = await authPool.query(`UPDATE vice_principal_login_accounts SET active=$1,updated_at=now() WHERE school_id=$2 AND vice_principal_id=$3 RETURNING user_id`, [input.active, user.school_id, vicePrincipalId])
    if (!changed.rowCount) { json(res, 404, { error: 'vice_principal_account_not_found' }); return true }
    if (!input.active) await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true }); return true
  }

  json(res, 404, { error: 'vice_principal_route_not_found' })
  return true
}
