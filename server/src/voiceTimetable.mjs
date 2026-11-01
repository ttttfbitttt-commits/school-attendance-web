function clean(value, max = 160) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function validId(value) { return /^[0-9a-f-]{36}$/i.test(String(value || '')) }

function normalize(input) {
  const classes = Array.isArray(input?.classes) ? input.classes.slice(0, 250).map(item => ({ id: clean(item?.id, 80), name: clean(item?.name) })).filter(item => item.id && item.name) : []
  const subjects = Array.isArray(input?.subjects) ? input.subjects.slice(0, 250).map(item => ({ id: clean(item?.id, 80), name: clean(item?.name), weeklyLessons: Math.max(0, Math.min(40, Number(item?.weeklyLessons) || 0)) })).filter(item => item.id && item.name) : []
  const classIds = new Set(classes.map(item => item.id)); const subjectIds = new Set(subjects.map(item => item.id))
  const assignments = Array.isArray(input?.assignments) ? input.assignments.slice(0, 5000).map(item => ({ classId: clean(item?.classId, 80), subjectId: clean(item?.subjectId, 80), teacherId: clean(item?.teacherId, 80) })).filter(item => classIds.has(item.classId) && subjectIds.has(item.subjectId) && validId(item.teacherId)) : []
  return { classes, subjects, assignments }
}

export async function migrateVoiceTimetable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS voice_timetable_projects (
      school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
      configuration jsonb NOT NULL DEFAULT '{"classes":[],"subjects":[],"assignments":[]}'::jsonb,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE voice_timetable_projects ENABLE ROW LEVEL SECURITY;
    ALTER TABLE voice_timetable_projects FORCE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='voice_timetable_projects' AND policyname='voice_timetable_projects_school_scope') THEN
        CREATE POLICY voice_timetable_projects_school_scope ON voice_timetable_projects
          USING (school_id=current_setting('app.school_id',true)::uuid)
          WITH CHECK (school_id=current_setting('app.school_id',true)::uuid);
      END IF;
    END $$;
  `)
}

export async function handleVoiceTimetableRequest(context) {
  const { req, res, url, user, body, json, scoped } = context
  if (!url.pathname.startsWith('/api/voice-timetable')) return false
  if (!['admin', 'vice_principal'].includes(user.role)) { json(res, 403, { error: 'forbidden' }); return true }
  if (req.method === 'GET' && url.pathname === '/api/voice-timetable/project') {
    const result = await scoped(user.school_id, async client => {
      const [project, teachers] = await Promise.all([
        client.query('SELECT configuration,updated_at AS "updatedAt" FROM voice_timetable_projects WHERE school_id=$1', [user.school_id]),
        client.query(`SELECT id,full_name AS name,identity_number AS "identityNumber" FROM lesson_teachers WHERE school_id=$1 AND active=true ORDER BY full_name`, [user.school_id]),
      ])
      return { configuration: normalize(project.rows[0]?.configuration || {}), updatedAt: project.rows[0]?.updatedAt || null, teachers: teachers.rows }
    })
    json(res, 200, result); return true
  }
  if (req.method === 'PUT' && url.pathname === '/api/voice-timetable/project') {
    const configuration = normalize(await body(req))
    const result = await scoped(user.school_id, async client => {
      const allowed = new Set((await client.query('SELECT id FROM lesson_teachers WHERE school_id=$1 AND active=true', [user.school_id])).rows.map(row => row.id))
      configuration.assignments = configuration.assignments.filter(item => allowed.has(item.teacherId))
      const saved = await client.query(`INSERT INTO voice_timetable_projects(school_id,configuration,updated_by,updated_at)
        VALUES($1,$2::jsonb,$3,now()) ON CONFLICT(school_id) DO UPDATE SET configuration=EXCLUDED.configuration,updated_by=EXCLUDED.updated_by,updated_at=now()
        RETURNING updated_at AS "updatedAt"`, [user.school_id, JSON.stringify(configuration), user.user_id])
      return { configuration, updatedAt: saved.rows[0].updatedAt }
    })
    json(res, 200, result); return true
  }
  json(res, 404, { error: 'not_found' }); return true
}
