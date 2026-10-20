const DEFAULT_ACTIVITY_LEADER_PASSWORD = '12345678'

const clean = (value, max = 200) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const identityNumber = value => String(value ?? '').replace(/\s/g, '').replace(/[^0-9]/g, '')
const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''))
const localEmail = (schoolId, leaderId) => `activity-leader-${schoolId}-${leaderId}@local.invalid`

export async function migrateActivityLeaderPortal(adminPool) {
  await adminPool.query(`
    ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_role_check;
    ALTER TABLE memberships ADD CONSTRAINT memberships_role_check CHECK (role IN ('admin','staff','teacher','administrator','student','counselor','vice_principal','activity_leader'));

    CREATE TABLE IF NOT EXISTS school_activity_leaders (
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
    CREATE INDEX IF NOT EXISTS school_activity_leaders_school_name ON school_activity_leaders(school_id,full_name);

    CREATE TABLE IF NOT EXISTS activity_leader_login_accounts (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      activity_leader_id uuid NOT NULL REFERENCES school_activity_leaders(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identity_number text NOT NULL,
      password_hash text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      must_change_password boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,activity_leader_id),
      UNIQUE (school_id,identity_number),
      UNIQUE (school_id,user_id),
      FOREIGN KEY (school_id,activity_leader_id) REFERENCES school_activity_leaders(school_id,id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS activity_leader_login_accounts_identity ON activity_leader_login_accounts(identity_number) WHERE active=true;
  `)
}

async function overview(user, scoped, authPool) {
  const leaders = await scoped(user.school_id, async client => (await client.query(`SELECT id AS "activityLeaderId",full_name AS name,identity_number AS "identityNumber",phone,active
    FROM school_activity_leaders WHERE school_id=$1 ORDER BY active DESC,full_name`, [user.school_id])).rows)
  const accounts = await authPool.query(`SELECT activity_leader_id AS "activityLeaderId",active AS "accountActive",must_change_password AS "mustChangePassword"
    FROM activity_leader_login_accounts WHERE school_id=$1`, [user.school_id])
  const mapped = new Map(accounts.rows.map(row => [row.activityLeaderId, row]))
  return { defaultPassword: DEFAULT_ACTIVITY_LEADER_PASSWORD, leaders: leaders.map(leader => {
    const account = mapped.get(leader.activityLeaderId)
    return { ...leader, active: Boolean(leader.active), accountCreated: Boolean(account), accountActive: Boolean(account?.accountActive), mustChangePassword: Boolean(account?.mustChangePassword) }
  }) }
}

export async function handleActivityLeaderPortalRequest(context) {
  const { req, res, url, user, body, json, scoped, authPool, passwordHash } = context
  if (!url.pathname.startsWith('/api/activity-leaders')) return false
  const adminOnly = () => user.role === 'admin'
  const leaderOnly = () => user.role === 'activity_leader' && validUuid(user.activity_leader_id)

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/admin/overview') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    json(res, 200, await overview(user, scoped, authPool)); return true
  }

  if (req.method === 'POST' && url.pathname === '/api/activity-leaders/admin/leaders') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const name = clean(input.name, 180); const identity = identityNumber(input.identityNumber); const phone = clean(input.phone, 48)
    if (!name || identity.length < 6 || !phone) { json(res, 400, { error: 'invalid_activity_leader' }); return true }
    const leader = await scoped(user.school_id, async client => (await client.query(`INSERT INTO school_activity_leaders(school_id,full_name,identity_number,phone)
      VALUES($1,$2,$3,$4) ON CONFLICT(school_id,identity_number) DO NOTHING
      RETURNING id AS "activityLeaderId",full_name AS name,identity_number AS "identityNumber",phone,active`, [user.school_id, name, identity, phone])).rows[0] || null)
    if (!leader) { json(res, 409, { error: 'activity_leader_identity_exists' }); return true }
    json(res, 201, { ok: true, leader: { ...leader, active: true, accountCreated: false, accountActive: false, mustChangePassword: false } }); return true
  }

  const activate = async (activityLeaderId, reset = false) => {
    if (!validUuid(activityLeaderId)) return { error: 'invalid_activity_leader' }
    const leader = await scoped(user.school_id, async client => (await client.query(`SELECT id,full_name,identity_number,active FROM school_activity_leaders WHERE school_id=$1 AND id=$2`, [user.school_id, activityLeaderId])).rows[0] || null)
    if (!leader || !leader.active) return { error: 'activity_leader_not_found' }
    const hash = passwordHash(DEFAULT_ACTIVITY_LEADER_PASSWORD)
    const existing = await authPool.query(`SELECT user_id FROM activity_leader_login_accounts WHERE school_id=$1 AND activity_leader_id=$2`, [user.school_id, activityLeaderId])
    let userId = existing.rows[0]?.user_id
    if (!userId) {
      const saved = await authPool.query(`INSERT INTO users(email,password_hash,display_name) VALUES($1,$2,$3)
        ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,display_name=EXCLUDED.display_name RETURNING id`, [localEmail(user.school_id, activityLeaderId), hash, leader.full_name])
      userId = saved.rows[0].id
      await authPool.query(`INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,'activity_leader') ON CONFLICT(school_id,user_id) DO UPDATE SET role='activity_leader'`, [user.school_id, userId])
      await authPool.query(`INSERT INTO activity_leader_login_accounts(school_id,activity_leader_id,user_id,identity_number,password_hash,active,must_change_password)
        VALUES($1,$2,$3,$4,$5,true,true)`, [user.school_id, activityLeaderId, userId, leader.identity_number, hash])
    } else {
      await authPool.query(`UPDATE activity_leader_login_accounts SET password_hash=$1,active=true,must_change_password=true,updated_at=now()
        WHERE school_id=$2 AND activity_leader_id=$3`, [hash, user.school_id, activityLeaderId])
      await authPool.query('UPDATE users SET password_hash=$1,display_name=$2 WHERE id=$3', [hash, leader.full_name, userId])
      await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [userId, user.school_id])
    }
    return { ok: true, temporaryPassword: DEFAULT_ACTIVITY_LEADER_PASSWORD, reset }
  }

  if (req.method === 'POST' && url.pathname === '/api/activity-leaders/admin/accounts/activate') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const result = await activate(String((await body(req)).activityLeaderId || ''))
    json(res, result.error ? 404 : 200, result); return true
  }
  if (req.method === 'POST' && url.pathname === '/api/activity-leaders/admin/accounts/reset') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const result = await activate(String((await body(req)).activityLeaderId || ''), true)
    json(res, result.error ? 404 : 200, result); return true
  }
  if (req.method === 'PATCH' && url.pathname === '/api/activity-leaders/admin/accounts/status') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req); const activityLeaderId = String(input.activityLeaderId || '')
    if (!validUuid(activityLeaderId) || typeof input.active !== 'boolean') { json(res, 400, { error: 'invalid_activity_leader_account_status' }); return true }
    const changed = await authPool.query(`UPDATE activity_leader_login_accounts SET active=$1,updated_at=now()
      WHERE school_id=$2 AND activity_leader_id=$3 RETURNING user_id`, [input.active, user.school_id, activityLeaderId])
    if (!changed.rowCount) { json(res, 404, { error: 'activity_leader_account_not_found' }); return true }
    if (!input.active) await authPool.query('DELETE FROM sessions WHERE user_id=$1 AND school_id=$2', [changed.rows[0].user_id, user.school_id])
    json(res, 200, { ok: true }); return true
  }
  if (req.method === 'POST' && url.pathname === '/api/activity-leaders/leader/password') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const password = String((await body(req)).password || '')
    if (password.length < 8 || password.length > 200) { json(res, 400, { error: 'weak_password' }); return true }
    const hash = passwordHash(password)
    const changed = await authPool.query(`UPDATE activity_leader_login_accounts SET password_hash=$1,must_change_password=false,updated_at=now()
      WHERE school_id=$2 AND activity_leader_id=$3 AND user_id=$4 AND active=true`, [hash, user.school_id, user.activity_leader_id, user.user_id])
    if (!changed.rowCount) { json(res, 404, { error: 'activity_leader_account_not_found' }); return true }
    await authPool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, user.user_id])
    json(res, 200, { ok: true }); return true
  }
  json(res, 404, { error: 'activity_leader_route_not_found' }); return true
}
