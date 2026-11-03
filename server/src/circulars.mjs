import crypto from 'node:crypto'

const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''))
const clean = (value, maximum = 240) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex')
const publicBaseUrl = () => String(process.env.PUBLIC_APP_URL || 'https://7asr2030.com').replace(/\/$/, '')

function accessAllowed(user) {
  return ['admin', 'vice_principal', 'counselor', 'activity_leader'].includes(user?.role)
    || (user?.role === 'administrator' && user?.circulars_access === true)
}
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '' }
function supportedAttachment(input) {
  const fileData = String(input?.fileData || '')
  const match = /^data:(image\/(?:png|jpeg|webp)|application\/pdf);base64,([A-Za-z0-9+/=]+)$/.exec(fileData)
  if (!match || fileData.length > 11_000_000) return null
  const fileName = clean(input?.fileName, 240)
  if (!fileName) return null
  return { fileData, fileName, fileType: match[1] }
}
function recipientRow(row, withSignature = true) {
  return {
    id: row.id, teacherId: row.teacherId, teacherName: row.teacherName, teacherPhone: row.teacherPhone || '',
    status: row.status, generatedAt: row.generatedAt || null, sentByName: row.sentByName || '', sentAt: row.sentAt || null,
    signedAt: row.signedAt || null, signatureData: withSignature ? (row.signatureData || '') : undefined,
  }
}
function circularRow(row) {
  return {
    id: row.id, title: row.title, circularDate: row.circularDate, fileName: row.fileName, fileType: row.fileType,
    createdByName: row.createdByName || '', createdAt: row.createdAt || null,
    recipients: Number(row.recipients || 0), signed: Number(row.signed || 0), pending: Number(row.pending || 0), sent: Number(row.sent || 0),
  }
}
const recipientColumns = `a.id,a.teacher_id AS "teacherId",a.teacher_name AS "teacherName",a.teacher_phone AS "teacherPhone",a.status,
  to_char(a.generated_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "generatedAt",a.sent_by_name AS "sentByName",
  to_char(a.sent_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "sentAt",
  to_char(a.signed_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "signedAt",a.signature_data AS "signatureData"`
const recipientReturningColumns = recipientColumns.replaceAll('a.', '')

export async function migrateCirculars(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS school_circulars (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      title text NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 240),
      circular_date date NOT NULL,
      file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 240),
      file_type text NOT NULL CHECK (file_type IN ('image/png','image/jpeg','image/webp','application/pdf')),
      file_data text NOT NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by_name text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS school_circular_acknowledgements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      circular_id uuid NOT NULL REFERENCES school_circulars(id) ON DELETE CASCADE,
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE CASCADE,
      teacher_name text NOT NULL,
      teacher_phone text NOT NULL DEFAULT '',
      access_token_hash text NOT NULL UNIQUE,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed')),
      generated_at timestamptz NOT NULL DEFAULT now(),
      sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
      sent_by_name text NOT NULL DEFAULT '',
      sent_at timestamptz,
      signed_at timestamptz,
      signature_data text NOT NULL DEFAULT '',
      UNIQUE (circular_id,teacher_id)
    );
    CREATE INDEX IF NOT EXISTS school_circulars_school_date_idx ON school_circulars(school_id,circular_date DESC,created_at DESC);
    CREATE INDEX IF NOT EXISTS school_circular_ack_school_idx ON school_circular_acknowledgements(school_id,circular_id,status);
  `)
}

export async function handleCircularRequest({ req, res, url, user, body, json, scoped, todayRiyadh }) {
  if (!url.pathname.startsWith('/api/circulars')) return false
  if (!accessAllowed(user)) { json(res, 403, { error: 'forbidden' }); return true }

  if (req.method === 'GET' && url.pathname === '/api/circulars') {
    const result = await scoped(user.school_id, client => client.query(`SELECT c.id,c.title,to_char(c.circular_date,'YYYY-MM-DD') AS "circularDate",c.file_name AS "fileName",c.file_type AS "fileType",
      c.created_by_name AS "createdByName",to_char(c.created_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "createdAt",
      COUNT(a.id)::int AS recipients,COUNT(a.id) FILTER (WHERE a.status='signed')::int AS signed,
      COUNT(a.id) FILTER (WHERE a.status='pending')::int AS pending,COUNT(a.id) FILTER (WHERE a.sent_at IS NOT NULL)::int AS sent
      FROM school_circulars c LEFT JOIN school_circular_acknowledgements a ON a.circular_id=c.id AND a.school_id=c.school_id
      WHERE c.school_id=$1 GROUP BY c.id ORDER BY c.circular_date DESC,c.created_at DESC LIMIT 1000`, [user.school_id]))
    json(res, 200, { circulars: result.rows.map(circularRow) })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/circulars') {
    const input = await body(req, 12_000_000)
    const title = clean(input.title, 240)
    const circularDate = validDate(input.circularDate) || todayRiyadh()
    const attachment = supportedAttachment(input)
    if (title.length < 2 || !attachment || !circularDate) { json(res, 400, { error: 'invalid_circular' }); return true }
    const saved = await scoped(user.school_id, client => client.query(`INSERT INTO school_circulars(school_id,title,circular_date,file_name,file_type,file_data,created_by,created_by_name)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,title,to_char(circular_date,'YYYY-MM-DD') AS "circularDate",file_name AS "fileName",file_type AS "fileType",
      created_by_name AS "createdByName",to_char(created_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "createdAt",0::int AS recipients,0::int AS signed,0::int AS pending,0::int AS sent`,
    [user.school_id, title, circularDate, attachment.fileName, attachment.fileType, attachment.fileData, user.user_id, clean(user.display_name, 160)]))
    json(res, 201, { circular: circularRow(saved.rows[0]) })
    return true
  }

  const detailMatch = /^\/api\/circulars\/([0-9a-f-]{36})$/i.exec(url.pathname)
  if (req.method === 'GET' && detailMatch) {
    const result = await scoped(user.school_id, async client => {
      const circular = await client.query(`SELECT id,title,to_char(circular_date,'YYYY-MM-DD') AS "circularDate",file_name AS "fileName",file_type AS "fileType",file_data AS "fileData",
        created_by_name AS "createdByName",to_char(created_at AT TIME ZONE 'Asia/Riyadh','YYYY-MM-DD HH24:MI') AS "createdAt" FROM school_circulars WHERE school_id=$1 AND id=$2`, [user.school_id, detailMatch[1]])
      if (!circular.rowCount) return null
      const recipients = await client.query(`SELECT ${recipientColumns} FROM school_circular_acknowledgements a WHERE a.school_id=$1 AND a.circular_id=$2 ORDER BY a.teacher_name`, [user.school_id, detailMatch[1]])
      return { circular: circular.rows[0], recipients: recipients.rows }
    })
    if (!result) { json(res, 404, { error: 'circular_not_found' }); return true }
    json(res, 200, { circular: { ...circularRow({ ...result.circular, recipients: result.recipients.length, signed: result.recipients.filter(row => row.status === 'signed').length, pending: result.recipients.filter(row => row.status === 'pending').length, sent: result.recipients.filter(row => row.sentAt).length }), fileData: result.circular.fileData }, recipients: result.recipients.map(row => recipientRow(row)) })
    return true
  }

  const generateMatch = /^\/api\/circulars\/([0-9a-f-]{36})\/recipients$/i.exec(url.pathname)
  if (req.method === 'POST' && generateMatch) {
    const result = await scoped(user.school_id, async client => {
      const circular = await client.query('SELECT id FROM school_circulars WHERE school_id=$1 AND id=$2', [user.school_id, generateMatch[1]])
      if (!circular.rowCount) return { missing: true }
      const teachers = await client.query(`SELECT id,full_name,phone FROM lesson_teachers WHERE school_id=$1 AND active=true ORDER BY full_name`, [user.school_id])
      let generated = 0
      for (const teacher of teachers.rows) {
        const token = crypto.randomBytes(32).toString('base64url')
        const inserted = await client.query(`INSERT INTO school_circular_acknowledgements(circular_id,school_id,teacher_id,teacher_name,teacher_phone,access_token_hash)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(circular_id,teacher_id) DO NOTHING RETURNING id`, [generateMatch[1], user.school_id, teacher.id, teacher.full_name, teacher.phone || '', tokenHash(token)])
        generated += inserted.rowCount
      }
      const recipients = await client.query(`SELECT ${recipientColumns} FROM school_circular_acknowledgements a WHERE a.school_id=$1 AND a.circular_id=$2 ORDER BY a.teacher_name`, [user.school_id, generateMatch[1]])
      return { generated, total: teachers.rowCount, recipients: recipients.rows }
    })
    if (result.missing) { json(res, 404, { error: 'circular_not_found' }); return true }
    json(res, 200, { generated: result.generated, total: result.total, recipients: result.recipients.map(row => recipientRow(row)) })
    return true
  }

  const sendMatch = /^\/api\/circulars\/([0-9a-f-]{36})\/recipients\/([0-9a-f-]{36})\/send$/i.exec(url.pathname)
  if (req.method === 'POST' && sendMatch) {
    const sent = await scoped(user.school_id, async client => {
      const token = crypto.randomBytes(32).toString('base64url')
      const result = await client.query(`UPDATE school_circular_acknowledgements SET access_token_hash=$4,sent_by=$5,sent_by_name=$6,sent_at=now()
        WHERE school_id=$1 AND circular_id=$2 AND id=$3 RETURNING ${recipientReturningColumns}`,
      [user.school_id, sendMatch[1], sendMatch[2], tokenHash(token), user.user_id, clean(user.display_name, 160)])
      return result.rowCount ? { row: result.rows[0], token } : null
    })
    if (!sent) { json(res, 404, { error: 'recipient_not_found' }); return true }
    json(res, 200, { recipient: recipientRow(sent.row), link: `${publicBaseUrl()}/circular-signature.html?token=${encodeURIComponent(sent.token)}` })
    return true
  }

  json(res, 404, { error: 'not_found' })
  return true
}

export async function handleCircularPublicRequest({ req, res, url, body, json, publicPool }) {
  if (!url.pathname.startsWith('/api/circulars/public')) return false
  const token = clean(url.searchParams.get('token'), 200)
  if (!token) { json(res, 400, { error: 'invalid_link' }); return true }
  const hash = tokenHash(token)
  if (req.method === 'GET' && url.pathname === '/api/circulars/public') {
    const result = await publicPool.query(`SELECT a.teacher_name AS "teacherName",a.status,c.title,c.file_name AS "fileName",c.file_type AS "fileType",c.file_data AS "fileData",
      to_char(c.circular_date,'YYYY-MM-DD') AS "circularDate",s.name AS "schoolName"
      FROM school_circular_acknowledgements a JOIN school_circulars c ON c.id=a.circular_id JOIN schools s ON s.id=a.school_id
      WHERE a.access_token_hash=$1`, [hash])
    if (!result.rowCount) { json(res, 404, { error: 'link_not_found' }); return true }
    json(res, 200, { circular: result.rows[0] })
    return true
  }
  if (req.method === 'POST' && url.pathname === '/api/circulars/public/sign') {
    const input = await body(req, 1_800_000)
    const signature = String(input.signatureData || '')
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signature) || signature.length > 1_600_000) { json(res, 400, { error: 'invalid_signature' }); return true }
    const result = await publicPool.query(`UPDATE school_circular_acknowledgements SET status='signed',signature_data=$2,signed_at=now()
      WHERE access_token_hash=$1 AND status='pending' RETURNING id`, [hash, signature])
    if (!result.rowCount) { json(res, 409, { error: 'already_signed' }); return true }
    json(res, 200, { ok: true })
    return true
  }
  json(res, 405, { error: 'method_not_allowed' })
  return true
}
