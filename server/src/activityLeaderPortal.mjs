import { sendEvidenceImage, teacherEvidenceRecords, teacherEvidenceTeachers } from './teacherPortal.mjs'

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

    CREATE TABLE IF NOT EXISTS activity_leader_activities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      activity_leader_id uuid NOT NULL REFERENCES school_activity_leaders(id) ON DELETE CASCADE,
      slot_number smallint NOT NULL CHECK (slot_number BETWEEN 1 AND 8),
      title text NOT NULL,
      description text NOT NULL DEFAULT '',
      attachment_data text NOT NULL DEFAULT '',
      attachment_name text NOT NULL DEFAULT '',
      attachment_type text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,slot_number)
    );
    CREATE INDEX IF NOT EXISTS activity_leader_activities_school_created ON activity_leader_activities(school_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS activity_leader_activity_recipients (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      activity_id uuid NOT NULL REFERENCES activity_leader_activities(id) ON DELETE CASCADE,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE CASCADE,
      seen_at timestamptz,
      completed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,activity_id,teacher_id)
    );
    CREATE INDEX IF NOT EXISTS activity_leader_activity_recipients_teacher ON activity_leader_activity_recipients(school_id,teacher_id,seen_at);

    ALTER TABLE teacher_evidence_records ADD COLUMN IF NOT EXISTS activity_id uuid;
    ALTER TABLE teacher_evidence_records DROP CONSTRAINT IF EXISTS teacher_evidence_records_slot_number_check;
    ALTER TABLE teacher_evidence_records ADD CONSTRAINT teacher_evidence_records_slot_number_check CHECK (slot_number BETWEEN 1 AND 12);
    ALTER TABLE teacher_evidence_records DROP CONSTRAINT IF EXISTS teacher_evidence_records_school_id_teacher_id_slot_number_key;
    CREATE UNIQUE INDEX IF NOT EXISTS teacher_evidence_regular_slot_unique ON teacher_evidence_records(school_id,teacher_id,slot_number) WHERE activity_id IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS teacher_evidence_activity_unique ON teacher_evidence_records(school_id,teacher_id,activity_id) WHERE activity_id IS NOT NULL;
  `)
}

const activityAttachment = value => {
  const match = /^data:(application\/pdf|image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(value || ''))
  if (!match || Buffer.byteLength(match[2], 'base64') > 1_500_000) return null
  return { data: String(value), type: match[1] }
}

function sendActivityAttachment(res, value) {
  const attachment = activityAttachment(value?.attachmentData)
  if (!attachment) return false
  const data = Buffer.from(attachment.data.slice(attachment.data.indexOf(',') + 1), 'base64')
  res.writeHead(200, { 'content-type': attachment.type, 'content-length': data.length, 'content-disposition': 'inline', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' })
  res.end(data)
  return true
}

const activityFileUrl = activityId => `/api/activity-leaders/leader/activity-file?activityId=${encodeURIComponent(activityId)}`

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

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/leader/evidence') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    json(res, 200, { teachers: await scoped(user.school_id, client => teacherEvidenceTeachers(client, user.school_id)) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/leader/profile') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const school = await scoped(user.school_id, async client => (await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])).rows[0] || null)
    json(res, 200, { schoolName: school?.name || 'المدرسة' })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/leader/activities') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const result = await scoped(user.school_id, async client => {
      const [activities, teachers] = await Promise.all([
        client.query(`SELECT activity.id,activity.slot_number AS "slotNumber",activity.title,activity.description,
          activity.attachment_name AS "attachmentName",activity.attachment_type AS "attachmentType",activity.created_at AS "createdAt",
          COUNT(recipient.teacher_id)::int AS "teacherCount",COUNT(evidence.id)::int AS "completedCount",
          array_remove(array_agg(recipient.teacher_id),NULL)::text[] AS "teacherIds"
          FROM activity_leader_activities activity
          LEFT JOIN activity_leader_activity_recipients recipient ON recipient.school_id=activity.school_id AND recipient.activity_id=activity.id
          LEFT JOIN teacher_evidence_records evidence ON evidence.school_id=recipient.school_id AND evidence.activity_id=recipient.activity_id AND evidence.teacher_id=recipient.teacher_id
          WHERE activity.school_id=$1 GROUP BY activity.id ORDER BY activity.slot_number`, [user.school_id]),
        client.query(`SELECT id AS "teacherId",full_name AS name,identity_number AS "identityNumber" FROM lesson_teachers WHERE school_id=$1 AND active=true ORDER BY full_name`, [user.school_id]),
      ])
      return { activities: activities.rows.map(row => ({ ...row, slotNumber: Number(row.slotNumber), teacherCount: Number(row.teacherCount), completedCount: Number(row.completedCount), teacherIds: row.teacherIds || [], attachmentUrl: row.attachmentName ? activityFileUrl(row.id) : '' })), teachers: teachers.rows }
    })
    json(res, 200, result); return true
  }

  if (req.method === 'POST' && url.pathname === '/api/activity-leaders/leader/activities') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req, 2_300_000)
    const slotNumber = Number(input.slotNumber)
    const title = clean(input.title, 240)
    const description = clean(input.description, 4000)
    const teacherIds = [...new Set(Array.isArray(input.teacherIds) ? input.teacherIds.map(String).filter(validUuid) : [])]
    const attachment = input.attachment ? activityAttachment(input.attachment) : { data: '', type: '' }
    const attachmentName = clean(input.attachmentName, 240)
    if (!Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 8 || !title || !description || !teacherIds.length || !attachment) { json(res, 400, { error: 'invalid_activity' }); return true }
    const result = await scoped(user.school_id, async client => {
      const allowed = await client.query(`SELECT id FROM lesson_teachers WHERE school_id=$1 AND active=true AND id=ANY($2::uuid[])`, [user.school_id, teacherIds])
      if (allowed.rowCount !== teacherIds.length) return { error: 'invalid_activity_teachers' }
      const saved = await client.query(`INSERT INTO activity_leader_activities(school_id,activity_leader_id,slot_number,title,description,attachment_data,attachment_name,attachment_type,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,now())
        ON CONFLICT(school_id,slot_number) DO UPDATE SET activity_leader_id=EXCLUDED.activity_leader_id,title=EXCLUDED.title,description=EXCLUDED.description,
          attachment_data=CASE WHEN EXCLUDED.attachment_data='' THEN activity_leader_activities.attachment_data ELSE EXCLUDED.attachment_data END,
          attachment_name=CASE WHEN EXCLUDED.attachment_data='' THEN activity_leader_activities.attachment_name ELSE EXCLUDED.attachment_name END,
          attachment_type=CASE WHEN EXCLUDED.attachment_data='' THEN activity_leader_activities.attachment_type ELSE EXCLUDED.attachment_type END,updated_at=now()
        RETURNING id`, [user.school_id, user.activity_leader_id, slotNumber, title, description, attachment.data, attachmentName, attachment.type])
      const activityId = saved.rows[0].id
      await client.query(`DELETE FROM activity_leader_activity_recipients WHERE school_id=$1 AND activity_id=$2`, [user.school_id, activityId])
      await client.query(`INSERT INTO activity_leader_activity_recipients(school_id,activity_id,teacher_id) SELECT $1,$2,unnest($3::uuid[])`, [user.school_id, activityId, teacherIds])
      return { ok: true, activityId }
    })
    json(res, result.error ? 400 : 200, result); return true
  }

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/leader/activity-file') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const activityId = String(url.searchParams.get('activityId') || '')
    if (!validUuid(activityId)) { json(res, 400, { error: 'invalid_activity' }); return true }
    const activity = await scoped(user.school_id, async client => (await client.query(`SELECT attachment_data AS "attachmentData" FROM activity_leader_activities WHERE school_id=$1 AND id=$2`, [user.school_id, activityId])).rows[0] || null)
    if (!activity || !sendActivityAttachment(res, activity)) { json(res, 404, { error: 'activity_file_not_found' }); return true }
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/leader/activities/report') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const activityId = String(url.searchParams.get('activityId') || '')
    if (!validUuid(activityId)) { json(res, 400, { error: 'invalid_activity' }); return true }
    const result = await scoped(user.school_id, async client => {
      const activity = (await client.query(`SELECT id,slot_number AS "slotNumber",title,description,attachment_name AS "attachmentName",created_at AS "createdAt" FROM activity_leader_activities WHERE school_id=$1 AND id=$2`, [user.school_id, activityId])).rows[0] || null
      if (!activity) return null
      const recipients = (await client.query(`SELECT teacher.id AS "teacherId",teacher.full_name AS name,teacher.identity_number AS "identityNumber",recipient.seen_at AS "seenAt",recipient.completed_at AS "completedAt",
        evidence.id AS "evidenceId",evidence.grade_value AS grade,evidence.classroom_value AS classroom,evidence.title,evidence.strategy,evidence.notes
        FROM activity_leader_activity_recipients recipient JOIN lesson_teachers teacher ON teacher.id=recipient.teacher_id AND teacher.school_id=recipient.school_id
        LEFT JOIN teacher_evidence_records evidence ON evidence.school_id=recipient.school_id AND evidence.teacher_id=recipient.teacher_id AND evidence.activity_id=recipient.activity_id
        WHERE recipient.school_id=$1 AND recipient.activity_id=$2 ORDER BY teacher.full_name`, [user.school_id, activityId])).rows
      const evidenceIds = recipients.map(row => row.evidenceId).filter(Boolean)
      const images = evidenceIds.length ? (await client.query(`SELECT evidence_id AS "evidenceId",slot_number AS "slotNumber",updated_at AS "updatedAt"
        FROM teacher_evidence_images WHERE school_id=$1 AND evidence_id=ANY($2::uuid[]) ORDER BY slot_number`, [user.school_id, evidenceIds])).rows : []
      const imagesByEvidence = new Map()
      for (const image of images) {
        const list = imagesByEvidence.get(image.evidenceId) || []
        list.push({ slotNumber: Number(image.slotNumber), fileUrl: `/api/activity-leaders/leader/evidence/file?evidenceId=${encodeURIComponent(image.evidenceId)}&slotNumber=${encodeURIComponent(image.slotNumber)}`, updatedAt: image.updatedAt })
        imagesByEvidence.set(image.evidenceId, list)
      }
      return { activity: { ...activity, slotNumber: Number(activity.slotNumber), attachmentUrl: activity.attachmentName ? activityFileUrl(activity.id) : '' }, recipients: recipients.map(row => ({ ...row, completed: Boolean(row.evidenceId), images: imagesByEvidence.get(row.evidenceId) || [] })) }
    })
    if (!result) { json(res, 404, { error: 'activity_not_found' }); return true }
    json(res, 200, result); return true
  }

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/leader/evidence/records') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const teacherId = String(url.searchParams.get('teacherId') || '')
    if (!validUuid(teacherId)) { json(res, 400, { error: 'invalid_teacher' }); return true }
    const result = await scoped(user.school_id, async client => {
      const teacher = (await client.query(`SELECT id AS "teacherId",full_name AS name,identity_number AS "identityNumber"
        FROM lesson_teachers WHERE school_id=$1 AND id=$2 AND active=true`, [user.school_id, teacherId])).rows[0] || null
      return teacher ? { teacher, records: await teacherEvidenceRecords(client, user.school_id, teacherId, 'activity_leader') } : null
    })
    if (!result) { json(res, 404, { error: 'teacher_not_found' }); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/activity-leaders/leader/evidence/file') {
    if (!leaderOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const evidenceId = String(url.searchParams.get('evidenceId') || '')
    const slotNumber = Number(url.searchParams.get('slotNumber'))
    if (!validUuid(evidenceId) || !Number.isInteger(slotNumber) || slotNumber < 1 || slotNumber > 4) { json(res, 400, { error: 'invalid_evidence_file' }); return true }
    const image = await scoped(user.school_id, async client => (await client.query(`SELECT image.image_data AS "imageData"
      FROM teacher_evidence_images image
      JOIN teacher_evidence_records evidence ON evidence.id=image.evidence_id AND evidence.school_id=image.school_id
      WHERE image.school_id=$1 AND image.evidence_id=$2 AND image.slot_number=$3`, [user.school_id, evidenceId, slotNumber])).rows[0] || null)
    if (!image || !sendEvidenceImage(res, image)) { json(res, 404, { error: 'evidence_file_not_found' }); return true }
    return true
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
