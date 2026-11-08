import crypto from 'node:crypto'

const PLATFORM_COOKIE = 'attendance_platform_session'
const PLATFORM_SESSION_SECONDS = 12 * 60 * 60
const platformUsername = String(process.env.PLATFORM_ADMIN_USERNAME || '').trim()
const platformPassword = String(process.env.PLATFORM_ADMIN_PASSWORD || '')

function platformPasswordHash(value, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(String(value), salt, 64).toString('hex')}`
}

function platformPasswordMatches(value, saved) {
  const [salt, expected] = String(saved || '').split(':')
  if (!salt || !expected) return false
  const actual = crypto.scryptSync(String(value), salt, 64).toString('hex')
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}

function canBootstrapPlatformAccount() {
  return platformUsername.length <= 128 && platformUsername && platformPassword.length >= 10 && platformPassword.length <= 200
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function deletionConfirmationUrl(token) {
  const url = new URL(process.env.PUBLIC_APP_URL || 'https://7asr2030.com')
  url.pathname = '/supervisor/delete-confirm'
  url.search = new URLSearchParams([['token', token]]).toString()
  url.hash = ''
  return url.toString()
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function platformAlertEmail(credentials) {
  const email = String(process.env.PLATFORM_ALERT_EMAIL || credentials?.username || platformUsername).trim().toLowerCase()
  return /^\S+@\S+\.\S+$/.test(email) && email.length <= 254 ? email : ''
}

async function sendSchoolDeletionConfirmationEmail(email, schoolName, token) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) throw new Error('email_verification_not_configured')

  const url = deletionConfirmationUrl(token)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  const safeSchoolName = escapeHtml(schoolName)
  const safeUrl = escapeHtml(url)

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'نظام حصر الطلاب <no-reply@7asr2030.com>',
        to: [email],
        subject: `تأكيد حذف مدرسة من نظام الحصر: ${schoolName}`,
        text: `طُلب حذف مدرسة «${schoolName}» وجميع بياناتها نهائيًا من نظام الحصر.\n\nلا يتم الحذف بمجرد هذا الطلب. افتح الرابط التالي ثم اضغط «تأكيد الحذف النهائي» لإتمام العملية:\n${url}\n\nصلاحية الرابط 30 دقيقة ويمكن استخدامه مرة واحدة. إذا لم تكن أنت من طلب الحذف، تجاهل هذه الرسالة.`,
        html: `<div dir="rtl" lang="ar"><h2>تأكيد حذف مدرسة</h2><p>طُلب حذف مدرسة <strong>${safeSchoolName}</strong> وجميع بياناتها نهائيًا من نظام الحصر.</p><p>لن تُحذف أي بيانات بمجرد هذا الطلب. افتح الرابط التالي ثم اضغط <strong>«تأكيد الحذف النهائي»</strong> لإتمام العملية.</p><p><a href="${safeUrl}">مراجعة طلب الحذف</a></p><p>صلاحية الرابط 30 دقيقة ويمكن استخدامه مرة واحدة. إذا لم تكن أنت من طلب الحذف، تجاهل هذه الرسالة.</p></div>`,
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error('email_send_failed')
  } catch (error) {
    if (error instanceof Error && error.message === 'email_verification_not_configured') throw error
    throw new Error('email_send_failed')
  } finally {
    clearTimeout(timeout)
  }
}

export const SCHOOL_STORAGE_TABLES = [
  'students', 'attendance_logs', 'almadar_accounts', 'student_excuses', 'message_logs', 'absence_records', 'absence_corrections', 'absence_follow_up_cases', 'absence_message_logs',
  'lesson_teachers', 'lesson_classrooms', 'lesson_schedule_imports', 'lesson_name_mappings', 'lesson_time_slots', 'lesson_schedule_assignments',
  'teacher_incidents', 'teacher_day_absences', 'teacher_classroom_student_maps', 'teacher_lesson_sessions', 'teacher_lesson_student_records',
  'teacher_sheet_configs', 'teacher_sheet_entries', 'teacher_evidence_records', 'teacher_evidence_images', 'behavior_incidents', 'behavior_student_records', 'behavior_action_steps',
  'behavior_score_movements', 'behavior_audit_logs', 'student_referrals', 'student_referral_events', 'student_leave_requests', 'school_circulars', 'school_circular_acknowledgements', 'teacher_attendance_contributions',
  'administrative_staff', 'student_counselors', 'student_counselor_grade_assignments', 'school_vice_principals', 'vice_principal_grade_assignments', 'school_activity_leaders',
]

export async function migratePlatformDashboard(adminPool) {
  await adminPool.query(`
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS platform_status text NOT NULL DEFAULT 'active'
      CHECK (platform_status IN ('active','suspended'));
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
    ALTER TABLE schools ADD COLUMN IF NOT EXISTS suspension_reason text NOT NULL DEFAULT '';

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
    CREATE TABLE IF NOT EXISTS platform_admin_credentials (
      singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
      username text NOT NULL UNIQUE,
      password_hash text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS platform_audit_logs (
      id bigserial PRIMARY KEY,
      actor_username text NOT NULL,
      action text NOT NULL,
      school_id uuid,
      school_name text NOT NULL DEFAULT '',
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS platform_audit_logs_school_created ON platform_audit_logs(school_id,created_at DESC);
    CREATE TABLE IF NOT EXISTS platform_school_deletion_requests (
      token_hash text PRIMARY KEY,
      school_id uuid NOT NULL UNIQUE REFERENCES schools(id) ON DELETE CASCADE,
      school_name text NOT NULL,
      requested_by text NOT NULL,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS platform_school_deletion_requests_expiry ON platform_school_deletion_requests(expires_at);
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
  const existingCredential = await adminPool.query('SELECT 1 FROM platform_admin_credentials WHERE singleton=true')
  if (!existingCredential.rowCount && canBootstrapPlatformAccount()) {
    await adminPool.query(`INSERT INTO platform_admin_credentials(singleton,username,password_hash)
      VALUES(true,$1,$2)`, [platformUsername, platformPasswordHash(platformPassword)])
  }
}

export async function getPlatformSchools(adminPool) {
  const storageSql = SCHOOL_STORAGE_TABLES.map(table => `SELECT school_id,
      COUNT(*)::bigint AS record_count,
      COALESCE(SUM(octet_length(row_to_json(item)::text)),0)::bigint AS byte_count
    FROM public."${table}" AS item
    GROUP BY school_id`).join('\nUNION ALL\n')

  const [schools, teachers, students, logins, usage, storage, portfolio, schoolRows] = await Promise.all([
    adminPool.query(`SELECT school.id,school.name,school.principal_name,school.created_at,school.platform_status,school.suspended_at,school.suspension_reason,
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
      platformStatus: school.platform_status === 'suspended' ? 'suspended' : 'active',
      suspendedAt: school.suspended_at || null,
      suspensionReason: school.suspension_reason || '',
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

async function platformCredentials(adminPool) {
  const result = await adminPool.query(`SELECT username,password_hash FROM platform_admin_credentials WHERE singleton=true`)
  return result.rows[0] || null
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

async function recordPlatformAudit(adminPool, action, school, details = {}) {
  const actor = (await platformCredentials(adminPool))?.username || platformUsername || 'المشرف العام'
  await adminPool.query(`INSERT INTO platform_audit_logs(actor_username,action,school_id,school_name,details)
    VALUES($1,$2,$3,$4,$5::jsonb)`, [actor, action, school?.id || null, school?.name || '', JSON.stringify(details)])
}

async function changePlatformPassword(req, adminPool, currentPassword, newPassword) {
  const credentials = await platformCredentials(adminPool)
  if (!credentials) return { error: 'platform_login_not_configured' }
  if (!platformPasswordMatches(currentPassword, credentials.password_hash)) return { error: 'current_password_invalid' }
  if (newPassword.length < 10 || newPassword.length > 200) return { error: 'invalid_new_password' }
  await adminPool.query(`UPDATE platform_admin_credentials
    SET password_hash=$1,updated_at=now() WHERE singleton=true`, [platformPasswordHash(newPassword)])
  const currentToken = platformToken(req)
  if (currentToken) await adminPool.query('DELETE FROM platform_sessions WHERE token_hash<>$1', [hashToken(currentToken)])
  await recordPlatformAudit(adminPool, 'change_platform_password', null)
  return { ok: true }
}

async function requestSchoolDeletion(adminPool, schoolId, confirmName) {
  const credentials = await platformCredentials(adminPool)
  const email = platformAlertEmail(credentials)
  if (!email) return { error: 'platform_alert_email_not_configured' }
  const token = crypto.randomBytes(32).toString('base64url')
  const hashedToken = hashToken(token)
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
    await client.query('DELETE FROM platform_school_deletion_requests WHERE expires_at<=now()')
    await client.query(`INSERT INTO platform_school_deletion_requests(token_hash,school_id,school_name,requested_by,expires_at)
      VALUES($1,$2,$3,$4,now()+interval '30 minutes')
      ON CONFLICT(school_id) DO UPDATE SET token_hash=EXCLUDED.token_hash,school_name=EXCLUDED.school_name,
        requested_by=EXCLUDED.requested_by,expires_at=EXCLUDED.expires_at,created_at=now()`, [hashedToken, school.id, school.name, email])
    await client.query('COMMIT')
    try {
      await sendSchoolDeletionConfirmationEmail(email, school.name, token)
    } catch (error) {
      await adminPool.query('DELETE FROM platform_school_deletion_requests WHERE token_hash=$1', [hashedToken])
      return { error: error instanceof Error ? error.message : 'email_send_failed' }
    }
    await recordPlatformAudit(adminPool, 'request_delete_school', school, { confirmationEmail: email })
    return { ok: true, confirmationEmail: email }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function deletionTokenIsValid(token) {
  return /^[A-Za-z0-9_-]{40,50}$/.test(token)
}

async function schoolDeletionRequest(adminPool, token) {
  if (!deletionTokenIsValid(token)) return null
  const request = await adminPool.query(`SELECT school_name,expires_at
    FROM platform_school_deletion_requests WHERE token_hash=$1 AND expires_at>now()`, [hashToken(token)])
  return request.rows[0] || null
}

async function confirmSchoolDeletion(adminPool, token) {
  if (!deletionTokenIsValid(token)) return { error: 'invalid_or_expired_deletion_link' }
  const client = await adminPool.connect()
  try {
    await client.query('BEGIN')
    const selectedRequest = await client.query(`SELECT token_hash,school_id,school_name,requested_by
      FROM platform_school_deletion_requests WHERE token_hash=$1 AND expires_at>now() FOR UPDATE`, [hashToken(token)])
    const request = selectedRequest.rows[0]
    if (!request) {
      await client.query('ROLLBACK')
      return { error: 'invalid_or_expired_deletion_link' }
    }
    const selectedSchool = await client.query('SELECT id,name FROM schools WHERE id=$1 FOR UPDATE', [request.school_id])
    const school = selectedSchool.rows[0]
    if (!school || school.name !== request.school_name) {
      await client.query('ROLLBACK')
      return { error: 'invalid_or_expired_deletion_link' }
    }
    await client.query(`INSERT INTO platform_audit_logs(actor_username,action,school_id,school_name,details)
      VALUES($1,'delete_school',$2,$3,$4::jsonb)`, [request.requested_by, school.id, school.name, JSON.stringify({ confirmedByEmail: true })])
    await client.query('DELETE FROM school_backup_audit WHERE school_id=$1', [school.id])
    await client.query('DELETE FROM schools WHERE id=$1', [school.id])
    await client.query(`DELETE FROM users AS account
      WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE user_id=account.id)`)
    await client.query('COMMIT')
    return { ok: true, schoolName: school.name }
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

async function updateSchoolStatus(adminPool, authPool, schoolId, status, reason = '') {
  const selected = await adminPool.query(`UPDATE schools
    SET platform_status=$1,
        suspended_at=CASE WHEN $1='suspended' THEN now() ELSE NULL END,
        suspension_reason=CASE WHEN $1='suspended' THEN $2 ELSE '' END
    WHERE id=$3
    RETURNING id,name,platform_status,suspended_at,suspension_reason`, [status, String(reason || '').trim().slice(0, 500), schoolId])
  const school = selected.rows[0]
  if (!school) return { error: 'school_not_found' }
  if (status === 'suspended') await authPool.query('DELETE FROM sessions WHERE school_id=$1', [schoolId])
  await recordPlatformAudit(adminPool, status === 'suspended' ? 'suspend_school' : 'resume_school', school, { reason: school.suspension_reason || '' })
  return { school }
}

async function updatePlatformSchoolProfile(adminPool, schoolId, input) {
  const current = await adminPool.query(`SELECT name,principal_name,general_education_administration,education_office,academic_year,semester,preferences
    FROM schools WHERE id=$1`, [schoolId])
  const existing = current.rows[0]
  if (!existing) return { error: 'school_not_found' }

  const schoolName = String(input.schoolName || existing.name || '').trim()
  const principalName = String(input.principalName || existing.principal_name || '').trim()
  const generalEducationAdministration = String(input.generalEducationAdministration || existing.general_education_administration || '').trim()
  const educationOffice = String(input.educationOffice || existing.education_office || '').trim()
  const academicYear = String(input.academicYear || existing.academic_year || '').trim()
  const semester = String(input.semester || existing.semester || '').trim()

  if (!schoolName || !principalName) {
    return { error: 'missing_required_fields' }
  }

  const result = await adminPool.query(`UPDATE schools
    SET name=$1,
        principal_name=$2,
        general_education_administration=$3,
        education_office=$4,
        academic_year=$5,
        semester=$6
    WHERE id=$7
    RETURNING name,principal_name,general_education_administration,education_office,academic_year,semester,preferences`,
  [schoolName, principalName, generalEducationAdministration, educationOffice, academicYear, semester, schoolId])

  const school = result.rows[0]
  if (!school) return { error: 'school_not_found' }

  const preferences = school.preferences && typeof school.preferences === 'object' ? school.preferences : {}
  return {
    school: {
      schoolName: school.name,
      principalName: school.principal_name,
      generalEducationAdministration: school.general_education_administration || '',
      educationOffice: school.education_office || '',
      academicYear: school.academic_year,
      semester: school.semester,
      preferences: {
        attendanceMode: ['auto', 'present', 'late'].includes(preferences.attendanceMode) ? preferences.attendanceMode : 'auto',
        cutoffTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(preferences.cutoffTime || '') ? preferences.cutoffTime : '07:30',
        gradeAliases: preferences.gradeAliases && typeof preferences.gradeAliases === 'object' && !Array.isArray(preferences.gradeAliases) ? preferences.gradeAliases : {},
      },
    },
  }
}

async function openSchoolSupportSession({ adminPool, authPool, createSession, res, schoolId }) {
  const schoolResult = await adminPool.query(`SELECT id,name,platform_status FROM schools WHERE id=$1`, [schoolId])
  const school = schoolResult.rows[0]
  if (!school) return { error: 'school_not_found' }
  if (school.platform_status === 'suspended') return { error: 'school_suspended' }
  const account = await adminPool.query(`SELECT membership.user_id
    FROM memberships AS membership
    WHERE membership.school_id=$1 AND membership.role='admin'
    ORDER BY membership.user_id ASC
    LIMIT 1`, [schoolId])
  if (!account.rowCount) return { error: 'school_admin_not_found' }
  await createSession(res, account.rows[0].user_id, schoolId)
  await recordPlatformAudit(adminPool, 'open_school_support_session', school, { mode: 'full_access' })
  return { ok: true, schoolName: school.name }
}

export async function handlePlatformRequest({
  req,
  res,
  url,
  body,
  json,
  adminPool,
  authPool,
  createSession,
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
    const credentials = await platformCredentials(adminPool)
    if (!credentials) {
      json(res, 503, { error: 'platform_login_not_configured' })
      return true
    }
    const retryAfter = loginRateLimited(req, 'platform', username)
    if (retryAfter) {
      loginThrottleResponse(res, retryAfter)
      return true
    }
    const passwordMatches = platformPasswordMatches(password.slice(0, 200), credentials.password_hash)
    if (username.length > 128 || password.length > 200 ||
        username.toLowerCase() !== credentials.username.toLowerCase() || !passwordMatches) {
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

  if (req.method === 'GET' && url.pathname === '/api/platform/school-deletion-confirmation') {
    const request = await schoolDeletionRequest(adminPool, String(url.searchParams.get('token') || ''))
    if (!request) {
      json(res, 400, { error: 'invalid_or_expired_deletion_link' })
      return true
    }
    json(res, 200, { schoolName: request.school_name, expiresAt: request.expires_at })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/platform/school-deletion-confirmation') {
    const input = await body(req, 10_000)
    const result = await confirmSchoolDeletion(adminPool, String(input.token || ''))
    if (result.error) {
      json(res, 400, { error: result.error })
      return true
    }
    json(res, 200, result)
    return true
  }

  if (!await requirePlatformSession(req, res, json, adminPool)) return true

  if (req.method === 'POST' && url.pathname === '/api/platform/change-password') {
    const input = await body(req, 10_000)
    const result = await changePlatformPassword(req, adminPool, String(input.currentPassword || ''), String(input.newPassword || ''))
    if (result.error) { json(res, result.error === 'current_password_invalid' ? 401 : result.error === 'invalid_new_password' ? 400 : 503, { error: result.error }); return true }
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/platform/schools') {
    json(res, 200, { schools: await getPlatformSchools(adminPool) })
    return true
  }

  const profileMatch = url.pathname.match(/^\/api\/platform\/schools\/([0-9a-f-]{36})\/profile$/i)
  if (req.method === 'PUT' && profileMatch) {
    const input = await body(req, 10_000)
    const result = await updatePlatformSchoolProfile(adminPool, profileMatch[1], input)
    if (result.error) {
      json(res, result.error === 'school_not_found' ? 404 : 400, { error: result.error })
      return true
    }
    json(res, 200, result)
    return true
  }

  const statusMatch = url.pathname.match(/^\/api\/platform\/schools\/([0-9a-f-]{36})\/status$/i)
  if (req.method === 'PATCH' && statusMatch) {
    const input = await body(req, 10_000)
    const status = input.status === 'suspended' ? 'suspended' : input.status === 'active' ? 'active' : ''
    if (!status) { json(res, 400, { error: 'invalid_school_status' }); return true }
    const result = await updateSchoolStatus(adminPool, authPool, statusMatch[1], status, input.reason)
    if (result.error) { json(res, 404, { error: result.error }); return true }
    json(res, 200, { ok: true, school: result.school })
    return true
  }

  const openMatch = url.pathname.match(/^\/api\/platform\/schools\/([0-9a-f-]{36})\/open$/i)
  if (req.method === 'POST' && openMatch) {
    const result = await openSchoolSupportSession({ adminPool, authPool, createSession, res, schoolId: openMatch[1] })
    if (result.error) { json(res, result.error === 'school_not_found' ? 404 : 409, { error: result.error }); return true }
    json(res, 200, result)
    return true
  }

  const deleteMatch = url.pathname.match(/^\/api\/platform\/schools\/([0-9a-f-]{36})\/delete-request$/i)
  if (req.method === 'POST' && deleteMatch) {
    const input = await body(req, 10_000)
    const confirmName = String(input.confirmName || '')
    const result = await requestSchoolDeletion(adminPool, deleteMatch[1], confirmName)
    if (result.error === 'school_not_found') {
      json(res, 404, { error: result.error })
      return true
    }
    if (result.error) {
      json(res, result.error === 'school_name_confirmation_mismatch' ? 409 : 503, { error: result.error })
      return true
    }
    json(res, 200, result)
    return true
  }

  json(res, 404, { error: 'not_found' })
  return true
}
