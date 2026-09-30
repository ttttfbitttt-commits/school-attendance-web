import crypto from 'node:crypto'
import { URL } from 'node:url'

const HOUR_MS = 60 * 60 * 1000

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function verificationUrl(token) {
  const url = new URL(process.env.PUBLIC_APP_URL || 'https://7asr2030.com')
  url.hash = new URLSearchParams([['verify-email', token]]).toString()
  return url.toString()
}

async function sendVerificationEmail(email, token) {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim()
  if (!apiKey) throw new Error('email_verification_not_configured')

  const url = verificationUrl(token)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)

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
        subject: 'تأكيد البريد الإلكتروني لتسجيل المدرسة',
        text: `لإكمال تسجيل المدرسة، افتح الرابط التالي ثم اضغط زر التأكيد:\n${url}\n\nصلاحية الرابط 30 دقيقة، ويمكن استخدامه مرة واحدة.`,
        html: `<div dir="rtl" lang="ar"><h2>تأكيد البريد الإلكتروني</h2><p>لإكمال تسجيل المدرسة، افتح الرابط واضغط زر التأكيد.</p><p><a href="${url}">متابعة تأكيد البريد</a></p><p>صلاحية الرابط 30 دقيقة، ويمكن استخدامه مرة واحدة.</p></div>`,
      }),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error('email_send_failed')
  } catch {
    throw new Error('email_send_failed')
  } finally {
    clearTimeout(timeout)
  }
}

export async function migrateEmailVerification(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS pending_school_registrations (
      email citext PRIMARY KEY,
      display_name text NOT NULL,
      school_name text NOT NULL,
      password_hash text NOT NULL,
      token_hash text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      last_sent_at timestamptz NOT NULL DEFAULT now(),
      rate_window_started_at timestamptz NOT NULL DEFAULT now(),
      send_count integer NOT NULL DEFAULT 1 CHECK (send_count BETWEEN 1 AND 5)
    );
    CREATE INDEX IF NOT EXISTS pending_school_registrations_expiry ON pending_school_registrations(expires_at);
  `)
}

export async function requestSchoolRegistration({ req, res, authPool, body, json, passwordHash }) {
  const input = await body(req)
  const email = String(input.email || '').trim().toLowerCase()
  const password = String(input.password || '')
  const displayName = String(input.displayName || '').trim()
  const schoolName = String(input.schoolName || '').trim()

  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || password.length < 12 || password.length > 200 ||
      !displayName || displayName.length > 160 || schoolName.length < 2 || schoolName.length > 160) {
    json(res, 400, { error: 'invalid_registration' })
    return true
  }
  const genericResponse = { ok: true }
  const existingUser = await authPool.query('SELECT 1 FROM users WHERE email=lower($1)', [email])
  if (existingUser.rowCount) {
    json(res, 202, genericResponse)
    return true
  }

  await authPool.query('DELETE FROM pending_school_registrations WHERE expires_at <= now()')
  const previous = await authPool.query(`SELECT last_sent_at,rate_window_started_at,send_count
    FROM pending_school_registrations WHERE email=lower($1)`, [email])
  const pending = previous.rows[0]
  if (pending && (Date.now() - new Date(pending.last_sent_at).getTime() < 60_000 ||
      (Date.now() - new Date(pending.rate_window_started_at).getTime() < 24 * HOUR_MS && pending.send_count >= 5))) {
    json(res, 202, genericResponse)
    return true
  }

  const token = crypto.randomBytes(32).toString('base64url')
  const hashedToken = tokenHash(token)
  const hashedPassword = passwordHash(password)

  try {
    await sendVerificationEmail(email, token)
  } catch (error) {
    json(res, error.message === 'email_verification_not_configured' ? 503 : 502, {
      error: error.message === 'email_verification_not_configured' ? error.message : 'email_send_failed',
    })
    return true
  }

  await authPool.query(`INSERT INTO pending_school_registrations(
      email,display_name,school_name,password_hash,token_hash,expires_at,created_at,last_sent_at,rate_window_started_at,send_count
    ) VALUES($1,$2,$3,$4,$5,now()+interval '30 minutes',now(),now(),now(),1)
    ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name,school_name=EXCLUDED.school_name,
      password_hash=EXCLUDED.password_hash,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,
      send_count=CASE WHEN pending_school_registrations.rate_window_started_at <= now()-interval '24 hours'
        THEN 1 ELSE pending_school_registrations.send_count+1 END,
      rate_window_started_at=CASE WHEN pending_school_registrations.rate_window_started_at <= now()-interval '24 hours'
        THEN now() ELSE pending_school_registrations.rate_window_started_at END,
      last_sent_at=now()`, [email, displayName, schoolName, hashedPassword, hashedToken])

  json(res, 202, genericResponse)
  return true
}

export async function verifySchoolRegistration({ req, res, authPool, body, json, scopedOn, createSession }) {
  const input = await body(req)
  const token = String(input.token || '')
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
    json(res, 400, { error: 'invalid_or_expired_verification_link' })
    return true
  }

  const registration = await authPool.query(`SELECT email,display_name,school_name,password_hash
    FROM pending_school_registrations WHERE token_hash=$1 AND expires_at > now()`, [tokenHash(token)])
  if (!registration.rows[0]) {
    json(res, 400, { error: 'invalid_or_expired_verification_link' })
    return true
  }

  const pending = registration.rows[0]
  const schoolId = crypto.randomUUID()

  try {
    const verified = await scopedOn(authPool, schoolId, async client => {
      const school = await client.query(`INSERT INTO schools(id,name,principal_name,academic_year,semester)
        VALUES($1,$2,$3,$4,$5) RETURNING id,name`, [schoolId, pending.school_name, pending.display_name, '1448 / 1449', 'الفصل الأول'])
      const user = await client.query(`INSERT INTO users(email,password_hash,display_name)
        VALUES(lower($1),$2,$3) RETURNING id,email,display_name`, [pending.email, pending.password_hash, pending.display_name])
      await client.query('INSERT INTO memberships(school_id,user_id,role) VALUES($1,$2,\'admin\')', [schoolId, user.rows[0].id])
      await client.query('DELETE FROM pending_school_registrations WHERE email=$1 AND token_hash=$2', [pending.email, tokenHash(token)])
      return { school: school.rows[0], user: user.rows[0] }
    })

    await createSession(res, verified.user.id, schoolId)
    json(res, 200, { user: { ...verified.user, role: 'admin', schoolId }, school: verified.school })
  } catch (error) {
    if (error.code === '23505') {
      json(res, 400, { error: 'invalid_or_expired_verification_link' })
      return true
    }
    throw error
  }

  return true
}