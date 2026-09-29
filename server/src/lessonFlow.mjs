import crypto from 'node:crypto'

const RIYADH_TIME_ZONE = 'Asia/Riyadh'
const VALID_WEEKDAYS = new Set([1, 2, 3, 4, 5, 6, 7])
const NAME_STOP_WORDS = new Set(['بن', 'ابن', 'بنت', 'ال'])

function cleanText(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function normalizeName(value) {
  return cleanText(value, 300)
    .normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameTokens(value) {
  return normalizeName(value).split(' ').filter(token => token && !NAME_STOP_WORDS.has(token))
}

function candidateScore(rawName, teacherName) {
  const raw = nameTokens(rawName)
  const teacher = nameTokens(teacherName)
  if (!raw.length || !teacher.length) return 0
  if (raw.join(' ') === teacher.join(' ')) return 1
  const rawSet = new Set(raw)
  const teacherSet = new Set(teacher)
  const shared = [...rawSet].filter(token => teacherSet.has(token)).length
  const coverage = shared / Math.max(rawSet.size, teacherSet.size)
  const startsSame = raw[0] === teacher[0] ? 0.08 : 0
  const endsSame = raw.at(-1) === teacher.at(-1) ? 0.12 : 0
  return Math.min(0.99, coverage + startsSame + endsSame)
}

function validTime(value) {
  const time = String(value || '').trim()
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : null
}

function validDate(value) {
  const date = String(value || '')
  const parsed = new Date(`${date}T12:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null
}

function asWeekday(value) {
  const weekday = Number(value)
  return VALID_WEEKDAYS.has(weekday) ? weekday : null
}

function asPeriod(value) {
  const period = Number(value)
  return Number.isInteger(period) && period >= 1 && period <= 12 ? period : null
}

function riyadhClock() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: RIYADH_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).filter(part => part.type !== 'literal').map(part => [part.type, part.value]))
  const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: RIYADH_TIME_ZONE, weekday: 'short' }).format(new Date())
  const weekdayMap = { Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7 }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
    weekday: weekdayMap[weekdayName] || 0,
  }
}

function teacherLookup(rows) {
  const lookup = new Map()
  for (const row of rows) {
    const normalized = normalizeName(row.full_name)
    if (!normalized) continue
    const matches = lookup.get(normalized) || []
    matches.push(row)
    lookup.set(normalized, matches)
  }
  return lookup
}

function incidentRow(row) {
  return {
    id: row.id,
    classroomId: row.classroomId,
    classroom: row.classroom,
    teacherId: row.teacherId,
    teacherName: row.teacherName,
    identityNumber: row.identityNumber,
    subject: row.subject,
    incidentDate: row.incidentDate,
    weekday: Number(row.weekday),
    periodNumber: Number(row.periodNumber),
    startTime: row.startTime,
    endTime: row.endTime,
    status: row.status,
    cancelNote: row.cancelNote || '',
    detectedAt: row.detectedAt,
    confirmedAt: row.confirmedAt || null,
  }
}

async function activeImport(client, schoolId) {
  return (await client.query(`SELECT id,source_school_name AS "sourceSchoolName",imported_at AS "importedAt"
    FROM lesson_schedule_imports WHERE school_id=$1 AND is_active=true LIMIT 1`, [schoolId])).rows[0] || null
}

async function overview(client, schoolId) {
  const [teachers, classrooms, active, times, incidentSummary] = await Promise.all([
    client.query('SELECT COUNT(*)::int AS count FROM lesson_teachers WHERE school_id=$1 AND active=true', [schoolId]),
    client.query(`SELECT id,name,qr_token AS "qrToken" FROM lesson_classrooms
      WHERE school_id=$1 AND active=true ORDER BY name`, [schoolId]),
    activeImport(client, schoolId),
    client.query(`SELECT weekday,period_number AS "periodNumber",to_char(starts_at,'HH24:MI') AS "startTime",to_char(ends_at,'HH24:MI') AS "endTime"
      FROM lesson_time_slots WHERE school_id=$1 ORDER BY weekday,period_number`, [schoolId]),
    client.query(`SELECT COUNT(*) FILTER (WHERE status='draft')::int AS drafts,
      COUNT(*) FILTER (WHERE status='confirmed')::int AS confirmed,
      COUNT(*)::int AS total FROM teacher_incidents WHERE school_id=$1`, [schoolId]),
  ])
  const assignmentCounts = active
    ? await client.query(`SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE teacher_id IS NULL)::int AS unresolved
      FROM lesson_schedule_assignments WHERE school_id=$1 AND import_id=$2`, [schoolId, active.id])
    : { rows: [{ total: 0, unresolved: 0 }] }
  const teacherRows = (await client.query(`SELECT id,full_name,identity_number AS "identityNumber" FROM lesson_teachers
    WHERE school_id=$1 AND active=true ORDER BY full_name`, [schoolId])).rows
  const unresolvedRows = active
    ? (await client.query(`SELECT raw_teacher_name AS "rawName",raw_teacher_normalized AS "rawNormalized",COUNT(*)::int AS occurrences
      FROM lesson_schedule_assignments WHERE school_id=$1 AND import_id=$2 AND teacher_id IS NULL
      GROUP BY raw_teacher_name,raw_teacher_normalized ORDER BY COUNT(*) DESC,raw_teacher_name`, [schoolId, active.id])).rows
    : []
  const unresolved = unresolvedRows.map(row => ({
    rawName: row.rawName,
    occurrences: Number(row.occurrences),
    candidates: teacherRows
      .map(teacher => ({ id: teacher.id, name: teacher.full_name, identityNumber: teacher.identityNumber, score: candidateScore(row.rawName, teacher.full_name) }))
      .filter(candidate => candidate.score >= 0.25)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ar'))
      .slice(0, 5),
  }))
  return {
    summary: {
      teachers: Number(teachers.rows[0].count),
      classrooms: classrooms.rowCount,
      assignments: Number(assignmentCounts.rows[0].total),
      unresolved: Number(assignmentCounts.rows[0].unresolved),
      incidents: { drafts: Number(incidentSummary.rows[0].drafts), confirmed: Number(incidentSummary.rows[0].confirmed), total: Number(incidentSummary.rows[0].total) },
    },
    activeImport: active,
    teachers: teacherRows.map(row => ({ id: row.id, name: row.full_name, identityNumber: row.identityNumber })),
    classrooms: classrooms.rows,
    times: times.rows.map(row => ({ ...row, weekday: Number(row.weekday), periodNumber: Number(row.periodNumber) })),
    unresolved,
  }
}

async function applyExactTeacherMatches(client, schoolId) {
  const active = await activeImport(client, schoolId)
  if (!active) return 0
  const teachers = (await client.query('SELECT id,full_name FROM lesson_teachers WHERE school_id=$1 AND active=true', [schoolId])).rows
  const lookup = teacherLookup(teachers)
  const pending = (await client.query(`SELECT id,raw_teacher_normalized FROM lesson_schedule_assignments
    WHERE school_id=$1 AND import_id=$2 AND teacher_id IS NULL`, [schoolId, active.id])).rows
  let updated = 0
  for (const row of pending) {
    const matches = lookup.get(row.raw_teacher_normalized) || []
    if (matches.length === 1) {
      await client.query(`UPDATE lesson_schedule_assignments SET teacher_id=$1,mapping_status='exact'
        WHERE school_id=$2 AND id=$3 AND teacher_id IS NULL`, [matches[0].id, schoolId, row.id])
      updated += 1
    }
  }
  return updated
}

export async function migrateLessonFlow(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lesson_teachers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      identity_number text NOT NULL CHECK (length(identity_number) BETWEEN 5 AND 32),
      full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 240),
      normalized_name text NOT NULL,
      phone text NOT NULL DEFAULT '',
      active boolean NOT NULL DEFAULT true,
      source_updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,identity_number)
    );
    CREATE TABLE IF NOT EXISTS lesson_classrooms (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 160),
      normalized_name text NOT NULL,
      qr_token text NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,normalized_name)
    );
    CREATE TABLE IF NOT EXISTS lesson_schedule_imports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      source_school_name text NOT NULL DEFAULT '',
      is_active boolean NOT NULL DEFAULT true,
      imported_by uuid REFERENCES users(id) ON DELETE SET NULL,
      imported_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS lesson_schedule_one_active_per_school
      ON lesson_schedule_imports(school_id) WHERE is_active=true;
    CREATE TABLE IF NOT EXISTS lesson_name_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      raw_name text NOT NULL,
      raw_name_normalized text NOT NULL,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE RESTRICT,
      mapped_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,raw_name_normalized)
    );
    CREATE TABLE IF NOT EXISTS lesson_time_slots (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 12),
      starts_at time NOT NULL,
      ends_at time NOT NULL,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (school_id,weekday,period_number),
      CHECK (ends_at > starts_at)
    );
    CREATE TABLE IF NOT EXISTS lesson_schedule_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      import_id uuid NOT NULL REFERENCES lesson_schedule_imports(id) ON DELETE CASCADE,
      classroom_id uuid NOT NULL REFERENCES lesson_classrooms(id) ON DELETE RESTRICT,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 12),
      subject_name text NOT NULL DEFAULT '',
      raw_teacher_name text NOT NULL DEFAULT '',
      raw_teacher_normalized text NOT NULL DEFAULT '',
      teacher_id uuid REFERENCES lesson_teachers(id) ON DELETE RESTRICT,
      mapping_status text NOT NULL DEFAULT 'unresolved' CHECK (mapping_status IN ('exact','manual','unresolved')),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (import_id,classroom_id,weekday,period_number)
    );
    CREATE TABLE IF NOT EXISTS teacher_incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      assignment_id uuid NOT NULL REFERENCES lesson_schedule_assignments(id) ON DELETE RESTRICT,
      classroom_id uuid NOT NULL REFERENCES lesson_classrooms(id) ON DELETE RESTRICT,
      teacher_id uuid NOT NULL REFERENCES lesson_teachers(id) ON DELETE RESTRICT,
      incident_date date NOT NULL,
      weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
      period_number smallint NOT NULL CHECK (period_number BETWEEN 1 AND 12),
      start_time time NOT NULL,
      end_time time NOT NULL,
      subject_name text NOT NULL DEFAULT '',
      teacher_name text NOT NULL,
      identity_number text NOT NULL,
      status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','cancelled')),
      cancel_note text NOT NULL DEFAULT '' CHECK (length(cancel_note) <= 500),
      detected_by uuid REFERENCES users(id) ON DELETE SET NULL,
      detected_at timestamptz NOT NULL DEFAULT now(),
      confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      confirmed_at timestamptz,
      cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
      cancelled_at timestamptz
    );
    CREATE UNIQUE INDEX IF NOT EXISTS teacher_incidents_one_open_per_lesson
      ON teacher_incidents(school_id,classroom_id,incident_date,period_number)
      WHERE status IN ('draft','confirmed');
    CREATE INDEX IF NOT EXISTS lesson_teachers_school_name ON lesson_teachers(school_id,normalized_name);
    CREATE INDEX IF NOT EXISTS lesson_assignments_active_lookup ON lesson_schedule_assignments(school_id,import_id,classroom_id,weekday,period_number);
    CREATE INDEX IF NOT EXISTS teacher_incidents_school_date ON teacher_incidents(school_id,incident_date DESC,detected_at DESC);
  `)
}

export async function handleLessonFlowRequest(context) {
  const { req, res, url, user, body, json, scoped } = context
  const adminOnly = () => user.role === 'admin'

  if (!url.pathname.startsWith('/api/lesson-flow')) return false
  if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }

  if (req.method === 'GET' && url.pathname === '/api/lesson-flow/overview') {
    const result = await scoped(user.school_id, client => overview(client, user.school_id))
    json(res, 200, result)
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/lesson-flow/teachers') {
    const input = await body(req)
    const source = Array.isArray(input.teachers) ? input.teachers : []
    if (!source.length || source.length > 2000) { json(res, 400, { error: 'invalid_teacher_import' }); return true }
    const teachers = []
    const seen = new Set()
    for (const value of source) {
      const name = cleanText(value?.name, 240)
      const identityNumber = String(value?.identityNumber ?? '').replace(/\D/g, '').slice(0, 32)
      const phone = String(value?.phone ?? '').replace(/\D/g, '').slice(0, 24)
      if (!name || identityNumber.length < 5 || seen.has(identityNumber)) continue
      seen.add(identityNumber)
      teachers.push({ name, identityNumber, phone, normalizedName: normalizeName(name) })
    }
    if (!teachers.length) { json(res, 400, { error: 'teacher_import_has_no_valid_rows' }); return true }
    const result = await scoped(user.school_id, async client => {
      await client.query('UPDATE lesson_teachers SET active=false WHERE school_id=$1', [user.school_id])
      for (const teacher of teachers) {
        await client.query(`INSERT INTO lesson_teachers(school_id,identity_number,full_name,normalized_name,phone,active,source_updated_at)
          VALUES($1,$2,$3,$4,$5,true,now())
          ON CONFLICT(school_id,identity_number) DO UPDATE SET full_name=EXCLUDED.full_name,normalized_name=EXCLUDED.normalized_name,
            phone=EXCLUDED.phone,active=true,source_updated_at=now()`, [user.school_id, teacher.identityNumber, teacher.name, teacher.normalizedName, teacher.phone])
      }
      const exactResolved = await applyExactTeacherMatches(client, user.school_id)
      return { imported: teachers.length, exactResolved }
    })
    json(res, 200, { ok: true, ...result })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/lesson-flow/schedule') {
    const input = await body(req)
    const sourceClassrooms = Array.isArray(input.classrooms) ? input.classrooms : []
    const sourceAssignments = Array.isArray(input.assignments) ? input.assignments : []
    const sourceTimes = Array.isArray(input.times) ? input.times : []
    if (!sourceClassrooms.length || sourceClassrooms.length > 600 || !sourceAssignments.length || sourceAssignments.length > 10000) {
      json(res, 400, { error: 'invalid_schedule_import' }); return true
    }
    const classroomNames = [...new Set(sourceClassrooms.map(value => cleanText(value?.name ?? value, 160)).filter(Boolean))]
    const assignments = sourceAssignments.map(value => ({
      classroomName: cleanText(value?.classroomName, 160),
      weekday: asWeekday(value?.weekday),
      periodNumber: asPeriod(value?.periodNumber),
      subjectName: cleanText(value?.subjectName, 180),
      rawTeacherName: cleanText(value?.rawTeacherName, 240),
    })).filter(value => value.classroomName && value.weekday && value.periodNumber)
    const times = sourceTimes.map(value => ({
      weekday: asWeekday(value?.weekday), periodNumber: asPeriod(value?.periodNumber),
      startTime: validTime(value?.startTime), endTime: validTime(value?.endTime),
    })).filter(value => value.weekday && value.periodNumber && value.startTime && value.endTime && value.endTime > value.startTime)
    if (!classroomNames.length || !assignments.length) { json(res, 400, { error: 'schedule_import_has_no_valid_rows' }); return true }
    const duplicateAssignment = new Set()
    if (assignments.some(value => {
      const key = `${normalizeName(value.classroomName)}:${value.weekday}:${value.periodNumber}`
      if (duplicateAssignment.has(key)) return true
      duplicateAssignment.add(key)
      return false
    })) { json(res, 400, { error: 'schedule_import_has_duplicate_slots' }); return true }
    const result = await scoped(user.school_id, async client => {
      const teachers = (await client.query('SELECT id,full_name,normalized_name FROM lesson_teachers WHERE school_id=$1 AND active=true', [user.school_id])).rows
      const lookup = teacherLookup(teachers)
      const mappings = new Map((await client.query(`SELECT raw_name_normalized,teacher_id FROM lesson_name_mappings WHERE school_id=$1`, [user.school_id])).rows.map(row => [row.raw_name_normalized, row.teacher_id]))
      const existingTimes = await client.query('SELECT 1 FROM lesson_time_slots WHERE school_id=$1 LIMIT 1', [user.school_id])
      await client.query('UPDATE lesson_schedule_imports SET is_active=false WHERE school_id=$1 AND is_active=true', [user.school_id])
      const imported = (await client.query(`INSERT INTO lesson_schedule_imports(school_id,source_school_name,is_active,imported_by)
        VALUES($1,$2,true,$3) RETURNING id`, [user.school_id, cleanText(input.sourceSchoolName, 160), user.user_id])).rows[0]
      await client.query('UPDATE lesson_classrooms SET active=false,updated_at=now() WHERE school_id=$1', [user.school_id])
      const classroomByName = new Map()
      for (const name of classroomNames) {
        const normalized = normalizeName(name)
        const classroom = (await client.query(`INSERT INTO lesson_classrooms(school_id,name,normalized_name,qr_token,active,updated_at)
          VALUES($1,$2,$3,$4,true,now())
          ON CONFLICT(school_id,normalized_name) DO UPDATE SET name=EXCLUDED.name,active=true,updated_at=now()
          RETURNING id,name,normalized_name`, [user.school_id, name, normalized, crypto.randomBytes(18).toString('base64url')])).rows[0]
        classroomByName.set(classroom.normalized_name, classroom)
      }
      if (!existingTimes.rowCount) {
        for (const slot of times) {
          await client.query(`INSERT INTO lesson_time_slots(school_id,weekday,period_number,starts_at,ends_at,updated_by)
            VALUES($1,$2,$3,$4::time,$5::time,$6) ON CONFLICT DO NOTHING`, [user.school_id, slot.weekday, slot.periodNumber, slot.startTime, slot.endTime, user.user_id])
        }
      }
      let resolved = 0
      for (const assignment of assignments) {
        const classroom = classroomByName.get(normalizeName(assignment.classroomName))
        const rawNormalized = normalizeName(assignment.rawTeacherName)
        const manualTeacherId = mappings.get(rawNormalized)
        const exact = lookup.get(rawNormalized) || []
        const teacherId = manualTeacherId || (exact.length === 1 ? exact[0].id : null)
        const mappingStatus = manualTeacherId ? 'manual' : teacherId ? 'exact' : 'unresolved'
        if (teacherId) resolved += 1
        await client.query(`INSERT INTO lesson_schedule_assignments(
          school_id,import_id,classroom_id,weekday,period_number,subject_name,raw_teacher_name,raw_teacher_normalized,teacher_id,mapping_status)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
          user.school_id, imported.id, classroom.id, assignment.weekday, assignment.periodNumber, assignment.subjectName,
          assignment.rawTeacherName, rawNormalized, teacherId, mappingStatus,
        ])
      }
      return { importedClassrooms: classroomNames.length, importedAssignments: assignments.length, resolved, seededTimes: !existingTimes.rowCount ? times.length : 0 }
    })
    json(res, 200, { ok: true, ...result })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/lesson-flow/mappings') {
    const input = await body(req)
    const source = Array.isArray(input.mappings) ? input.mappings : []
    if (!source.length || source.length > 300) { json(res, 400, { error: 'invalid_name_mappings' }); return true }
    const result = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return { noSchedule: true }
      let updated = 0
      for (const mapping of source) {
        const rawName = cleanText(mapping?.rawName, 240)
        const rawNormalized = normalizeName(rawName)
        const teacherId = String(mapping?.teacherId || '')
        if (!rawName || !rawNormalized || !/^[0-9a-f-]{36}$/i.test(teacherId)) continue
        const teacher = await client.query('SELECT id FROM lesson_teachers WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, teacherId])
        if (!teacher.rowCount) continue
        await client.query(`INSERT INTO lesson_name_mappings(school_id,raw_name,raw_name_normalized,teacher_id,mapped_by,updated_at)
          VALUES($1,$2,$3,$4,$5,now())
          ON CONFLICT(school_id,raw_name_normalized) DO UPDATE SET raw_name=EXCLUDED.raw_name,teacher_id=EXCLUDED.teacher_id,
            mapped_by=EXCLUDED.mapped_by,updated_at=now()`, [user.school_id, rawName, rawNormalized, teacherId, user.user_id])
        const change = await client.query(`UPDATE lesson_schedule_assignments SET teacher_id=$1,mapping_status='manual'
          WHERE school_id=$2 AND import_id=$3 AND raw_teacher_normalized=$4`, [teacherId, user.school_id, active.id, rawNormalized])
        updated += change.rowCount
      }
      return { updated }
    })
    if (result.noSchedule) { json(res, 409, { error: 'schedule_not_imported' }); return true }
    json(res, 200, { ok: true, updated: result.updated })
    return true
  }

  if (req.method === 'PUT' && url.pathname === '/api/lesson-flow/times') {
    const input = await body(req)
    const source = Array.isArray(input.times) ? input.times : []
    const slots = source.map(value => ({
      weekday: asWeekday(value?.weekday), periodNumber: asPeriod(value?.periodNumber),
      startTime: validTime(value?.startTime), endTime: validTime(value?.endTime),
    })).filter(value => value.weekday && value.periodNumber && value.startTime && value.endTime && value.endTime > value.startTime)
    const keys = new Set()
    if (!slots.length || slots.length > 84 || slots.some(slot => {
      const key = `${slot.weekday}:${slot.periodNumber}`
      if (keys.has(key)) return true
      keys.add(key)
      return false
    })) { json(res, 400, { error: 'invalid_lesson_times' }); return true }
    const result = await scoped(user.school_id, async client => {
      await client.query('DELETE FROM lesson_time_slots WHERE school_id=$1', [user.school_id])
      for (const slot of slots) {
        await client.query(`INSERT INTO lesson_time_slots(school_id,weekday,period_number,starts_at,ends_at,updated_by)
          VALUES($1,$2,$3,$4::time,$5::time,$6)`, [user.school_id, slot.weekday, slot.periodNumber, slot.startTime, slot.endTime, user.user_id])
      }
      return { saved: slots.length }
    })
    json(res, 200, { ok: true, ...result })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/lesson-flow/schedule') {
    const classroomId = String(url.searchParams.get('classroomId') || '')
    if (!/^[0-9a-f-]{36}$/i.test(classroomId)) { json(res, 400, { error: 'invalid_classroom' }); return true }
    const result = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return { noSchedule: true }
      const classroom = await client.query('SELECT id,name FROM lesson_classrooms WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, classroomId])
      if (!classroom.rowCount) return { missing: true }
      const assignments = await client.query(`SELECT a.weekday,a.period_number AS "periodNumber",a.subject_name AS "subjectName",
        a.raw_teacher_name AS "rawTeacherName",a.mapping_status AS "mappingStatus",t.id AS "teacherId",t.full_name AS "teacherName",
        t.identity_number AS "identityNumber"
        FROM lesson_schedule_assignments a LEFT JOIN lesson_teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id
        WHERE a.school_id=$1 AND a.import_id=$2 AND a.classroom_id=$3 ORDER BY a.weekday,a.period_number`, [user.school_id, active.id, classroomId])
      return { classroom: classroom.rows[0], assignments: assignments.rows.map(row => ({ ...row, weekday: Number(row.weekday), periodNumber: Number(row.periodNumber) })) }
    })
    if (result.noSchedule) { json(res, 409, { error: 'schedule_not_imported' }); return true }
    if (result.missing) { json(res, 404, { error: 'classroom_not_found' }); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/lesson-flow/scan') {
    const input = await body(req)
    const code = String(input.code || '').trim()
    const token = /^lesson:([A-Za-z0-9_-]{20,100})$/.exec(code)?.[1]
    if (!token) { json(res, 400, { error: 'invalid_classroom_qr' }); return true }
    const clock = riyadhClock()
    const result = await scoped(user.school_id, async client => {
      const active = await activeImport(client, user.school_id)
      if (!active) return { error: 'schedule_not_imported' }
      const classroom = await client.query('SELECT id,name FROM lesson_classrooms WHERE school_id=$1 AND qr_token=$2 AND active=true', [user.school_id, token])
      if (!classroom.rowCount) return { error: 'classroom_qr_not_found' }
      const slot = await client.query(`SELECT period_number AS "periodNumber",to_char(starts_at,'HH24:MI') AS "startTime",to_char(ends_at,'HH24:MI') AS "endTime"
        FROM lesson_time_slots WHERE school_id=$1 AND weekday=$2 AND starts_at <= $3::time AND ends_at > $3::time ORDER BY period_number LIMIT 1`, [user.school_id, clock.weekday, clock.time])
      if (!slot.rowCount) return { error: 'outside_lesson_time', classroom: classroom.rows[0], clock }
      const assignment = await client.query(`SELECT a.id,a.subject_name AS "subjectName",a.raw_teacher_name AS "rawTeacherName",a.teacher_id AS "teacherId",
        t.full_name AS "teacherName",t.identity_number AS "identityNumber"
        FROM lesson_schedule_assignments a LEFT JOIN lesson_teachers t ON t.id=a.teacher_id AND t.school_id=a.school_id
        WHERE a.school_id=$1 AND a.import_id=$2 AND a.classroom_id=$3 AND a.weekday=$4 AND a.period_number=$5 LIMIT 1`, [
        user.school_id, active.id, classroom.rows[0].id, clock.weekday, slot.rows[0].periodNumber,
      ])
      if (!assignment.rowCount) return { error: 'lesson_not_scheduled', classroom: classroom.rows[0], clock, slot: slot.rows[0] }
      if (!assignment.rows[0].teacherId) return { error: 'teacher_mapping_needed', classroom: classroom.rows[0], clock, slot: slot.rows[0], rawTeacherName: assignment.rows[0].rawTeacherName }
      const existing = await client.query(`SELECT i.id,c.name AS classroom,i.teacher_id AS "teacherId",i.teacher_name AS "teacherName",
        i.identity_number AS "identityNumber",i.subject_name AS subject,to_char(i.incident_date,'YYYY-MM-DD') AS "incidentDate",
        i.weekday,i.period_number AS "periodNumber",to_char(i.start_time,'HH24:MI') AS "startTime",to_char(i.end_time,'HH24:MI') AS "endTime",
        i.status,i.cancel_note AS "cancelNote",i.detected_at AS "detectedAt",i.confirmed_at AS "confirmedAt"
        FROM teacher_incidents i JOIN lesson_classrooms c ON c.id=i.classroom_id
        WHERE i.school_id=$1 AND i.classroom_id=$2 AND i.incident_date=$3 AND i.period_number=$4 AND i.status IN ('draft','confirmed') LIMIT 1`, [
        user.school_id, classroom.rows[0].id, clock.date, slot.rows[0].periodNumber,
      ])
      if (existing.rowCount) return { incident: incidentRow(existing.rows[0]), existing: true }
      const inserted = await client.query(`INSERT INTO teacher_incidents(
        school_id,assignment_id,classroom_id,teacher_id,incident_date,weekday,period_number,start_time,end_time,subject_name,teacher_name,identity_number,detected_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::time,$9::time,$10,$11,$12,$13)
        RETURNING id`, [user.school_id, assignment.rows[0].id, classroom.rows[0].id, assignment.rows[0].teacherId, clock.date,
        clock.weekday, slot.rows[0].periodNumber, slot.rows[0].startTime, slot.rows[0].endTime, assignment.rows[0].subjectName,
        assignment.rows[0].teacherName, assignment.rows[0].identityNumber, user.user_id])
      const incident = await client.query(`SELECT i.id,c.name AS classroom,i.teacher_id AS "teacherId",i.teacher_name AS "teacherName",
        i.identity_number AS "identityNumber",i.subject_name AS subject,to_char(i.incident_date,'YYYY-MM-DD') AS "incidentDate",
        i.weekday,i.period_number AS "periodNumber",to_char(i.start_time,'HH24:MI') AS "startTime",to_char(i.end_time,'HH24:MI') AS "endTime",
        i.status,i.cancel_note AS "cancelNote",i.detected_at AS "detectedAt",i.confirmed_at AS "confirmedAt"
        FROM teacher_incidents i JOIN lesson_classrooms c ON c.id=i.classroom_id WHERE i.school_id=$1 AND i.id=$2`, [user.school_id, inserted.rows[0].id])
      return { incident: incidentRow(incident.rows[0]), existing: false }
    })
    if (result.error) { json(res, 409, result); return true }
    json(res, 200, result)
    return true
  }

  const incidentAction = /^\/api\/lesson-flow\/incidents\/([0-9a-f-]{36})\/(confirm|cancel)$/i.exec(url.pathname)
  if (req.method === 'POST' && incidentAction) {
    const [, id, action] = incidentAction
    const input = await body(req)
    const result = await scoped(user.school_id, async client => {
      if (action === 'confirm') return client.query(`UPDATE teacher_incidents SET status='confirmed',confirmed_by=$1,confirmed_at=now()
        WHERE school_id=$2 AND id=$3 AND status='draft' RETURNING id`, [user.user_id, user.school_id, id])
      return client.query(`UPDATE teacher_incidents SET status='cancelled',cancel_note=$1,cancelled_by=$2,cancelled_at=now()
        WHERE school_id=$3 AND id=$4 AND status IN ('draft','confirmed') RETURNING id`, [cleanText(input.note, 500), user.user_id, user.school_id, id])
    })
    if (!result.rowCount) { json(res, 404, { error: 'incident_not_found_or_locked' }); return true }
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/lesson-flow/incidents') {
    const date = validDate(url.searchParams.get('date'))
    const rows = await scoped(user.school_id, async client => (await client.query(`SELECT i.id,c.id AS "classroomId",c.name AS classroom,
      i.teacher_id AS "teacherId",i.teacher_name AS "teacherName",i.identity_number AS "identityNumber",i.subject_name AS subject,
      to_char(i.incident_date,'YYYY-MM-DD') AS "incidentDate",i.weekday,i.period_number AS "periodNumber",
      to_char(i.start_time,'HH24:MI') AS "startTime",to_char(i.end_time,'HH24:MI') AS "endTime",i.status,i.cancel_note AS "cancelNote",
      i.detected_at AS "detectedAt",i.confirmed_at AS "confirmedAt"
      FROM teacher_incidents i JOIN lesson_classrooms c ON c.id=i.classroom_id
      WHERE i.school_id=$1${date ? ' AND i.incident_date=$2' : ''} ORDER BY i.detected_at DESC LIMIT 200`, date ? [user.school_id, date] : [user.school_id])).rows)
    json(res, 200, { incidents: rows.map(incidentRow) })
    return true
  }

  return false
}
