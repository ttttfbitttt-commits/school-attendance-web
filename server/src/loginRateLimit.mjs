import crypto from 'node:crypto'

const WINDOW_SECONDS = 15 * 60
const IP_LIMIT = 20
const IDENTITY_LIMIT = 10

export async function migrateLoginRateLimit(adminPool) {
  await adminPool.query(`CREATE TABLE IF NOT EXISTS login_rate_limits (
    key_hash text PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 0
  )`)
  await adminPool.query('GRANT SELECT, INSERT, UPDATE, DELETE ON login_rate_limits TO attendance_auth')
}

export function createLoginRateLimiter(pool, clientAddress) {
  function keys(req, scope, identity) {
    const normalized = String(identity || '').trim().toLocaleLowerCase('en').slice(0, 254)
    const hash = value => crypto.createHash('sha256').update(value).digest('hex')
    return [hash(`${scope}:ip:${clientAddress(req)}`), hash(`${scope}:identity:${normalized}`)]
  }

  async function loginRateLimited(req, scope, identity, includeIp = true) {
    const [ipKey, identityKey] = keys(req, scope, identity)
    const result = await pool.query(`SELECT key_hash, attempts,
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM (started_at + interval '15 minutes' - now()))))::int AS retry_after
      FROM login_rate_limits WHERE key_hash = ANY($1::text[]) AND started_at > now() - interval '15 minutes'`,
    [includeIp ? [ipKey, identityKey] : [identityKey]])
    const blocked = result.rows.filter(row => row.attempts >= (row.key_hash === ipKey && includeIp ? IP_LIMIT : IDENTITY_LIMIT))
    return blocked.length ? Math.max(...blocked.map(row => row.retry_after)) : false
  }

  async function recordFailedLogin(req, scope, identity, includeIp = true) {
    const [ipKey, identityKey] = keys(req, scope, identity)
    const selected = includeIp ? [identityKey, ipKey] : [identityKey]
    await pool.query(`INSERT INTO login_rate_limits(key_hash, started_at, attempts)
      SELECT value, now(), 1 FROM unnest($1::text[]) AS value
      ON CONFLICT (key_hash) DO UPDATE SET
        attempts = CASE WHEN login_rate_limits.started_at <= now() - interval '15 minutes' THEN 1 ELSE login_rate_limits.attempts + 1 END,
        started_at = CASE WHEN login_rate_limits.started_at <= now() - interval '15 minutes' THEN now() ELSE login_rate_limits.started_at END`, [selected])
    if (crypto.randomInt(100) === 0) await pool.query(`DELETE FROM login_rate_limits WHERE started_at < now() - interval '1 day'`)
  }

  async function clearLoginAttempts(req, scope, identity) {
    const [, identityKey] = keys(req, scope, identity)
    await pool.query('DELETE FROM login_rate_limits WHERE key_hash=$1', [identityKey])
  }

  return { loginRateLimited, recordFailedLogin, clearLoginAttempts, windowSeconds: WINDOW_SECONDS }
}
