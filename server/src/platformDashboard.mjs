import crypto from 'node:crypto'

const PLATFORM_COOKIE = 'attendance_platform_session'
const PLATFORM_SESSION_SECONDS = 12 * 60 * 60
const platformUsername = String(process.env.PLATFORM_ADMIN_USERNAME || '').trim()
const platformPassword = String(process.env.PLATFORM_ADMIN_PASSWORD || '')
const platformPasswordHash = platformUsername.length <= 128 && platformUsername && platformPassword.length >= 16 && platformPassword.length <= 200
  ? crypto.scryptSync(platformPassword, process.env.PLATFORM_ADMIN_USERNAME, 64)
  : null

export const SCHOOL_STORAGE_TABLES = [
  'students', 'attendance_logs', 'almadar_accounts', 'student_excuses', 'message_logs', 'absence_records', 'absence_corrections', 'absence_follow_up_cases', 'absence_message_logs',
  'lesson_teachers', 'lesson_classrooms', 'lesson_schedule_imports', 'lesson_name_mappings', 'lesson_time_slots', 'lesson_schedule_assignments',
  'teacher_incidents', 'teacher_day_absences', 'teacher_classroom_student_maps', 'teacher_lesson_sessions', 'teacher_lesson_student_records',
  'teacher_sheet_configs', 'teacher_sheet_entries', 'teacher_evidence_records', 'teacher_evidence_images', 'behavior_incidents', 'behavior_student_records', 'behavior_action_steps',
  'behavior_score_movements', 'behavior_audit_logs', 'student_referrals', 'student_referral_events', 'teacher_attendance_contributions',
  'administrative_staff', 'student_counselors', 'student_counselor_grade_assignments', 'school_vice_principals', 'vice_principal_grade_assignments', 'school_activity_leaders',
]

export async function migratePlatformDashboard(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS school_login_activity (
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      activity_date date NOT NULL,
      login_count integer NOT NULL DEFAULT 0 CHECK (login_count >= 0),
      PRIMARY KEY (school_id, activity_date)
    );
    CREATE INDEX IF NOT EXISTS school_login_activity_date ON school_login_activity(activity_date DESC);
    CREATE TABLE IF NOT EXISTS platform_sessions (
      token_hash text PRIMARY KEY,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE school_login_activity ENABLE ROW LEVEL SECURITY;
    ALTER TABLE school_login_activity FORCE ROW LEVEL SECURITY;
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname='public' AND tablename='school_login_activity' AND policyname='school_login_activity_scope'
      ) THEN
        CREATE POLICY school_login_activity_scope ON school_login_activity
          USING (school_id=current_setting('app.school_id',true)::uuid)
          WITH CHECK (school_id=current_setting('app.school_id',true)::uuid);
      END IF;
    END $$;
  `)
}

export async function getPlatformSchools(adminPool) {
  const storageSql = SCHOOL_STORAGE_TABLES.map(table => `SELECT school_id,
      COUNT(*)::bigint AS record_count,
      COALESCE(SUM(octet_length(row_to_json(item)::text)),0)::bigint AS byte_count
    FROM public."${table}" AS item
    GROUP BY school_id`).join('\nUNION ALL\n')

  const [schools, teachers, students, logins, usage, storage, portfolio, schoolRows] = await Promise.all([
    adminPool.query(`SELECT school.id,school.name,school.principal_name,school.created_at,
        creator.display_name AS activated_by_name,creator.email AS activated_by_email,
        COALESCE(accounts.registered_emails,'[]'::json) AS registered_emails
      FROM schools AS school
      LEFT JOIN LATERAL (
        SELECT u.display_name,u.email
        FROM memberships AS membership
        JOIN users AS u ON u.id=membership.user_id
        WHERE membership.school_id=school.id AND membership.role='admin'
        ORDER BY u.created_at ASC
        LIMIT 1
      ) AS creator ON true
      LEFT JOIN LATERAL (
        SELECT json_agg(DISTINCT u.email::text ORDER BY u.email::text) AS registered_emails
        FROM memberships AS membership
        JOIN users AS u ON u.id=membership.user_id
        WHERE membership.school_id=school.id AND membership.role IN ('admin','staff')
      ) AS accounts ON true
      ORDER BY school.created_at DESC,school.name`),
    adminPool.query(`SELECT teacher.school_id,
        COUNT(*) FILTER (WHERE teacher.active)::int AS teacher_count,
        COUNT(*) FILTER (WHERE teacher.active AND account.active)::int AS teacher_accounts,
        COALESCE(json_agg(teacher.full_name ORDER BY teacher.full_name)
          FILTER (WHERE teacher.active),'[]'::json) AS teacher_names
      FROM lesson_teachers AS teacher
      LEFT JOIN teacher_login_accounts AS account
        ON account.school_id=teacher.school_id AND account.teacher_id=teacher.id
      GROUP BY teacher.school_id`),
    adminPool.query(`SELECT student.school_id,
        COUNT(*) FILTER (WHERE student.active)::int AS student_count,
        COUNT(*) FILTER (WHERE student.active AND account.active)::int AS student_accounts
      FROM students AS student
      LEFT JOIN student_login_accounts AS account
        ON account.school_id=student.school_id AND account.student_id=student.id
      GROUP BY student.school_id`),
    adminPool.query(`SELECT school_id,
        COALESCE(SUM(login_count),0)::int AS total_logins,
        COALESCE(SUM(login_count) FILTER (WHERE activity_date >=
          (now() AT TIME ZONE 'Asia/Riyadh')::date - 29),0)::int AS logins_30_days,
        MAX(activity_date) AS last_login_date
      FROM school_login_activity
      GROUP BY school_id`),
    adminPool.query(`SELECT school_id,
        COUNT(*)::int AS total_records,
        COUNT(*) FILTER (WHERE activity_at >= now()-interval '90 days')::int AS records_90_days,
        COUNT(*) FILTER (WHERE activity_at >= now()-interval '30 days')::int AS records_30_days,
        COUNT(*) FILTER (WHERE activity_type='attendance' AND activity_at >= now()-interval '30 days')::int AS attendance_30_days,
        COUNT(*) FILTER (WHERE activity_type='absence' AND activity_at >= now()-interval '30 days')::int AS absences_30_days,
        COUNT(*) FILTER (WHERE activity_type='message' AND activity_at >= now()-interval '30 days')::int AS messages_30_days,
        MAX(activity_at) AS last_actual_use,
        COUNT(*) FILTER (WHERE activity_type='attendance')::int AS attendance_total
      FROM (
        SELECT school_id,recorded_at AS activity_at,'attendance' AS activity_type FROM attendance_logs
        UNION ALL
        SELECT school_id,calculated_at AS activity_at,'absence' AS activity_type FROM absence_records
        UNION ALL
        SELECT school_id,created_at AS activity_at,'message' AS activity_type FROM message_logs
        UNION ALL
        SELECT school_id,updated_at AS activity_at,'other' AS activity_type FROM teacher_lesson_student_records
        UNION ALL
        SELECT school_id,created_at AS activity_at,'other' AS activity_type FROM behavior_student_records
        UNION ALL
        SELECT school_id,created_at AS activity_at,'other' AS activity_type FROM student_referrals
        UNION ALL
        SELECT school_id,created_at AS activity_at,'other' AS activity_type FROM teacher_evidence_records
        UNION ALL
        SELECT school_id,uploaded_at AS activity_at,'other' AS activity_type FROM student_portfolio_files
      ) AS activity
      GROUP BY school_id`),
    adminPool.query(`SELECT school_id,
        SUM(record_count)::bigint AS records,
        SUM(byte_count)::bigint AS records_bytes
      FROM (${storageSql}) AS records_by_table
      GROUP BY school_id`),
    adminPool.query(`SELECT school_id,COUNT(*)::int AS files,
        COALESCE(SUM(octet_length(row_to_json(file)::text)),0)::bigint AS bytes
      FROM student_portfolio_files AS file
      GROUP BY school_id`),
    adminPool.query(`SELECT id AS school_id,
        octet_length(row_to_json(school)::text)::bigint AS bytes
      FROM schools AS school`),
  ])

  const bySchool = rows => new Map(rows.map(row => [row.school_id, row]))
  const teachersBySchool = bySchool(teachers.rows)
  const studentsBySchool = bySchool(students.rows)
  const loginsBySchool = bySchool(logins.rows)
  const usageBySchool = bySchool(usage.rows)
  const storageBySchool = bySchool(storage.rows)
  const portfolioBySchool = bySchool(portfolio.rows)
  const schoolBytesBySchool = bySchool(schoolRows.rows)

  return schools.rows.map(school => {
    const teacherData = teachersBySchool.get(school.id)
    const studentData = studentsBySchool.get(school.id)
    const loginData = loginsBySchool.get(school.id)
    const usageData = usageBySchool.get(school.id)
    const recordsData = storageBySchool.get(school.id)
    const portfolioData = portfolioBySchool.get(school.id)
    const schoolBytes = Number(schoolBytesBySchool.get(school.id)?.bytes || 0)
    const portfolioBytes = Number(portfolioData?.bytes || 0)
    const actualActivityCount = Number(usageData?.total_records || 0)
    const recentActivityCount = Number(usageData?.records_90_days || 0)
    const recentLoginCount = Number(loginData?.logins_30_days || 0)
    const totalLoginCount = Number(loginData?.total_logins || 0)

    return {
      id: school.id,
      name: school.name,
      activatedAt: school.created_at,
      activatedBy: {
        name: school.activated_by_name || school.principal_name || 'غير مسجل',
        email: school.activated_by_email || '',
      },
      teacherCount: Number(teacherData?.teacher_count || 0),
      teacherAccounts: Number(teacherData?.teacher_accounts || 0),
      teachers: teacherData?.teacher_names || [],
      studentCount: Number(studentData?.student_count || 0),
      studentAccounts: Number(studentData?.student_accounts || 0),
      loginCount30Days: recentLoginCount,
      lastLoginDate: loginData?.last_login_date || null,
      attendanceCount: Number(usageData?.attendance_total || 0),
      registeredEmails: school.registered_emails || [],
      usage: {
        status: recentActivityCount > 0
          ? 'active'
          : actualActivityCount > 0
            ? 'used_before'
            : totalLoginCount > 0
              ? 'login_only'
              : 'not_started',
        records90Days: recentActivityCount,
        records30Days: Number(usageData?.records_30_days || 0),
        attendance30Days: Number(usageData?.attendance_30_days || 0),
        absences30Days: Number(usageData?.absences_30_days || 0),
        messages30Days: Number(usageData?.messages_30_days || 0),
        totalRecords: actualActivityCount,
        lastActualUse: usageData?.last_actual_use || null,
      },
      storage: {
        totalBytes: Number(recordsData?.records_bytes || 0) + schoolBytes + portfolioBytes,
        recordsBytes: Number(recordsData?.records_bytes || 0) + schoolBytes,
        portfolioBytes,
        portfolioFiles: Number(portfolioData?.files || 0),
        records: Number(recordsData?.records || 0) + Number(portfolioData?.files || 0) + 1,
      },
    }
  })
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function platformCookie(token, maxAge = PLATFORM_SESSION_SECONDS) {
  return `${PLATFORM_COOKIE}=${encodeURIComponent(token)}; Path=/api/platform; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`
}

function platformToken(req) {
  const cookie = String(req.headers.cookie || '')
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${PLATFORM_COOKIE}=([^;]*)`))
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    return ''
  }
}

async function validPlatformSession(req, adminPool) {
  const token = platformToken(req)
  if (!token) return false
  const session = await adminPool.query(
    'SELECT 1 FROM platform_sessions WHERE token_hash=$1 AND expires_at>now()',
    [hashToken(token)],
  )
  return Boolean(session.rowCount)
}

async function requirePlatformSession(req, res, json, adminPool) {
  if (await validPlatformSession(req, adminPool)) return true
  json(res, 401, { error: 'unauthorized' })
  return false
}

async function schoolHasRecentUsage(client, schoolId) {
  const result = await client.query(`SELECT EXISTS(
    SELECT 1 FROM (
      SELECT recorded_at AS activity_at FROM attendance_logs WHERE school_id=$1
      UNION ALL SELECT calculated_at FROM absence_records WHERE school_id=$1
      UNION ALL SELECT created_at FROM message_logs WHERE school_id=$1
      UNION ALL SELECT updated_at FROM teacher_lesson_student_records WHERE school_id=$1
      UNION ALL SELECT created_at FROM behavior_student_records WHERE school_id=$1
      UNION ALL SELECT created_at FROM student_referrals WHERE school_id=$1
      UNION ALL SELECT created_at FROM teacher_evidence_records WHERE school_id=$1
      UNION ALL SELECT uploaded_at FROM student_portfolio_files WHERE school_id=$1
    ) AS activity
    WHERE activity_at >= now()-interval '90 days'
  ) AS active`, [schoolId])
  return Boolean(result.rows[0]?.active)
}

async function deleteInactiveSchool(adminPool, schoolId, confirmName) {
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    const selected = await client.query('SELECT id,name FROM schools WHERE id=$1 FOR UPDATE', [schoolId])
    const school = selected.rows[0]
    if (!school) {
      await client.query('ROLLBACK')
      return { error: 'school_not_found' }
    }
    if (school.name !== confirmName) {
      await client.query('ROLLBACK')
      return { error: 'school_name_confirmation_mismatch' }
    }
    if (await schoolHasRecentUsage(client, schoolId)) {
      await client.query('ROLLBACK')
      return { error: 'school_is_active' }
    }
    await client.query('DELETE FROM school_backup_audit WHERE school_id=$1', [schoolId])
    await client.query('DELETE FROM schools WHERE id=$1', [schoolId])
    await client.query(`DELETE FROM users AS account
      WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=account.id)`)
    await client.query('COMMIT')
    return { ok: true }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function handlePlatformRequest({
  req,
  res,
  url,
  body,
  json,
  adminPool,
  loginRateLimited,
  recordFailedLogin,
  clearLoginAttempts,
  loginThrottleResponse,
}) {
  if (!url.pathname.startsWith('/api/platform/')) return false

  if (req.method === 'POST' && url.pathname === '/api/platform/login') {
    const input = await body(req)
    const username = String(input.username || '').trim()
    const password = String(input.password || '')
    if (!platformPasswordHash) {
      json(res, 503, { error: 'platform_login_not_configured' })
      return true
    }
    const retryAfter = loginRateLimited(req, 'platform', username)
    if (retryAfter) {
      loginThrottleResponse(res, retryAfter)
      return true
    }
    const attemptedPassword = crypto.scryptSync(password.slice(0, 200), process.env.PLATFORM_ADMIN_USERNAME, 64)
    const passwordMatches = crypto.timingSafeEqual(platformPasswordHash, attemptedPassword)
    if (username.length > 128 || password.length > 200 ||
        username.toLowerCase() !== platformUsername.toLowerCase() || !passwordMatches) {
      recordFailedLogin(req, 'platform', username)
      json(res, 401, { error: 'invalid_login' })
      return true
    }
    clearLoginAttempts(req, 'platform', username)
    const token = crypto.randomBytes(32).toString('base64url')
    await adminPool.query('DELETE FROM platform_sessions WHERE expires_at <= now()')
    await adminPool.query(`INSERT INTO platform_sessions(token_hash,expires_at)
      VALUES($1,now()+interval '12 hours')`, [hashToken(token)])
    res.setHeader('set-cookie', platformCookie(token))
    json(res, 200, { authenticated: true })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/platform/logout') {
    const token = platformToken(req)
    if (token) await adminPool.query('DELETE FROM platform_sessions WHERE token_hash=$1', [hashToken(token)])
    res.setHeader('set-cookie', platformCookie('', 0))
    json(res, 200, { ok: true })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/platform/me') {
    if (!await requirePlatformSession(req, res, json, adminPool)) return true
    json(res, 200, { authenticated: true })
    return true
  }

  if (!await requirePlatformSession(req, res, json, adminPool)) return true

  if (req.method === 'GET' && url.pathname === '/api/platform/schools') {
    json(res, 200, { schools: await getPlatformSchools(adminPool) })
    return true
  }

  const deleteMatch = url.pathname.match(/^\/api\/platform\/schools\/([0-9a-f-]{36})\/delete$/i)
  if (req.method === 'POST' && deleteMatch) {
    const input = await body(req, 10_000)
    const confirmName = String(input.confirmName || '')
    const result = await deleteInactiveSchool(adminPool, deleteMatch[1], confirmName)
    if (result.error === 'school_not_found') {
      json(res, 404, { error: result.error })
      return true
    }
    if (result.error) {
      json(res, 409, { error: result.error })
      return true
    }
    json(res, 200, result)
    return true
  }

  json(res, 404, { error: 'not_found' })
  return true
}
