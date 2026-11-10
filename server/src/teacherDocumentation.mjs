const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''))
const clean = (value, limit) => String(value ?? '').trim().slice(0, limit)
const imageValid = value => /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value) && Buffer.byteLength(value.slice(value.indexOf(',') + 1), 'base64') <= 1_000_000

export async function migrateTeacherDocumentation(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS teacher_documentations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE CASCADE,
    kind text NOT NULL CHECK (kind IN ('strategy','report')),
    title text NOT NULL, subject text NOT NULL DEFAULT '', grade_value text NOT NULL DEFAULT '',
    classroom_value text NOT NULL DEFAULT '', execution_date date NOT NULL,
    strategy text NOT NULL DEFAULT '', report_for text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '',
    visit_teacher_name text NOT NULL DEFAULT '', vice_principal_name text NOT NULL DEFAULT '',
    activity_leader_name text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
    images jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  ); CREATE INDEX IF NOT EXISTS teacher_documentations_owner ON teacher_documentations(school_id,teacher_id,updated_at DESC)`)
}

const columns = `id,kind,title,subject,grade_value AS grade,classroom_value AS classroom,
  to_char(execution_date,'YYYY-MM-DD') AS "executionDate",strategy,report_for AS "reportFor",description,
  visit_teacher_name AS "visitTeacherName",vice_principal_name AS "vicePrincipalName",
  activity_leader_name AS "activityLeaderName",notes,created_at AS "createdAt",updated_at AS "updatedAt"`

export async function handleTeacherDocumentation({ req, res, url, user, body, json, scoped }) {
  const path = url.pathname
  if (path === '/api/teacher-portal/documentation-image') {
    if (!['admin','activity_leader'].includes(user.role)) { json(res,403,{error:'forbidden'}); return true }
    const id=String(url.searchParams.get('id') || ''), slot=Number(url.searchParams.get('slot'))
    if (!uuid(id) || !Number.isInteger(slot) || slot<1 || slot>4) { json(res,400,{error:'invalid_image'}); return true }
    const value=await scoped(user.school_id,async client => (await client.query(`SELECT images ->> ($3::int - 1) AS image FROM teacher_documentations WHERE school_id=$1 AND id=$2`,[user.school_id,id,slot])).rows[0]?.image || '')
    if (!imageValid(value)) { json(res,404,{error:'not_found'}); return true }
    const match=/^data:(image\/(?:jpeg|png|webp));base64,(.*)$/.exec(value), bytes=Buffer.from(match[2],'base64')
    res.writeHead(200,{'content-type':match[1],'content-length':bytes.length,'cache-control':'private, no-store','x-content-type-options':'nosniff'}); res.end(bytes); return true
  }
  if (!path.startsWith('/api/teacher-portal/teacher/documentations')) return false
  if (user.role !== 'teacher' || !uuid(user.teacher_id)) { json(res,403,{error:'forbidden'}); return true }
  const match = /^\/api\/teacher-portal\/teacher\/documentations(?:\/([0-9a-f-]{36}))?$/.exec(path)
  if (!match || (match[1] && !uuid(match[1]))) { json(res,404,{error:'not_found'}); return true }
  const id = match[1]
  if (req.method === 'GET') {
    const data = await scoped(user.school_id, async client => {
      if (id) return (await client.query(`SELECT ${columns},images FROM teacher_documentations WHERE school_id=$1 AND teacher_id=$2 AND id=$3`,[user.school_id,user.teacher_id,id])).rows[0] || null
      return (await client.query(`SELECT ${columns},jsonb_array_length(images) AS "imageCount" FROM teacher_documentations WHERE school_id=$1 AND teacher_id=$2 ORDER BY updated_at DESC`,[user.school_id,user.teacher_id])).rows
    })
    if (id && !data) json(res,404,{error:'not_found'})
    else json(res,200,id ? {record:data} : {records:data})
    return true
  }
  if (req.method === 'POST') {
    const input=await body(req,6_500_000)
    const kind=String(input.kind || ''), title=clean(input.title,240), date=String(input.executionDate || '')
    const images=Array.isArray(input.images) ? input.images : null
    const parsedDate = new Date(date+'T12:00:00Z')
    if (!['strategy','report'].includes(kind) || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0,10)!==date || (kind === 'strategy' && !clean(input.strategy,240)) || !images || images.length>4 || images.some(value => typeof value !== 'string' || !imageValid(value))) { json(res,400,{error:'invalid_documentation'}); return true }
    const fields=[kind,title,clean(input.subject,200),clean(input.grade,160),clean(input.classroom,160),date,clean(input.strategy,240),clean(input.reportFor,240),clean(input.description,5000),clean(input.visitTeacherName,200),clean(input.vicePrincipalName,200),clean(input.activityLeaderName,200),clean(input.notes,4000),JSON.stringify(images)]
    const saved=await scoped(user.school_id,async client => {
      const values=[user.school_id,user.teacher_id,...fields]
      const query=id
        ? `UPDATE teacher_documentations SET kind=$3,title=$4,subject=$5,grade_value=$6,classroom_value=$7,execution_date=$8,strategy=$9,report_for=$10,description=$11,visit_teacher_name=$12,vice_principal_name=$13,activity_leader_name=$14,notes=$15,images=$16::jsonb,updated_at=now() WHERE school_id=$1 AND teacher_id=$2 AND id=$17 RETURNING ${columns},images`
        : `INSERT INTO teacher_documentations(school_id,teacher_id,kind,title,subject,grade_value,classroom_value,execution_date,strategy,report_for,description,visit_teacher_name,vice_principal_name,activity_leader_name,notes,images) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) RETURNING ${columns},images`
      return (await client.query(query,id ? [...values,id] : values)).rows[0] || null
    })
    if (!saved) json(res,404,{error:'not_found'})
    else json(res,200,{record:saved})
    return true
  }
  json(res,405,{error:'method_not_allowed'}); return true
}
