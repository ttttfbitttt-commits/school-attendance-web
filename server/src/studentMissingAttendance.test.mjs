import test from 'node:test'
import assert from 'node:assert/strict'
import { handleFeatureRequest } from './features.mjs'

function context(path, role = 'admin') {
  const calls = []
  const result = {}
  const client = { query: async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('FROM student_counselor_grade_assignments')) return { rows: [{ grade: 'grade-a' }] }
    if (sql.includes('FROM vice_principal_grade_assignments')) return { rows: [{ grade: 'grade-b' }] }
    if (sql.includes('SELECT s.id,s.name')) return { rows: [{ id: 'student', name: 'Student', grade: 'grade-a', classroom: '1' }] }
    if (sql.includes('WITH school_days')) return { rows: [{ date: '2026-11-15', status: null }] }
    if (sql.includes('min(attendance_date)')) return { rows: [{ date: '2026-11-01' }] }
    throw new Error('unexpected query')
  } }
  const user = { school_id: 'school', role, counselor_id: '11111111-1111-1111-1111-111111111111', vice_principal_id: '22222222-2222-2222-2222-222222222222' }
  return { calls, result, ctx: { req: { method: 'GET' }, res: {}, url: new URL('http://localhost' + path), user, json: (_res, code, body) => Object.assign(result, { code, body }), scoped: async (_school, fn) => fn(client), todayRiyadh: () => '2026-11-17' } }
}

test('reports school attendance days missing the selected student, with grade scope', async () => {
  const { ctx, calls, result } = context('/api/reports/student-missing-attendance?studentId=student', 'counselor')
  assert.equal(await handleFeatureRequest(ctx), true)
  assert.equal(result.code, 200)
  assert.equal(result.body.from, '2026-11-01')
  assert.equal(result.body.days[0].status, null)
  const studentQuery = calls.find(call => call.sql.includes('SELECT s.id,s.name'))
  assert.deepEqual(studentQuery.params, ['school', 'student', ['grade-a']])
  const daysQuery = calls.find(call => call.sql.includes('WITH school_days'))
  assert.match(daysQuery.sql, /NOT EXISTS/)
  assert.deepEqual(daysQuery.params, ['school', 'student', null, '2026-11-17'])
})

test('rejects invalid and future ranges before querying', async () => {
  for (const suffix of ['&from=2026-11-18&to=2026-11-19', '&from=2026-11-16', '&from=2026-11-17&to=2026-11-01']) {
    const { ctx, calls, result } = context('/api/reports/student-missing-attendance?studentId=student' + suffix)
    await handleFeatureRequest(ctx)
    assert.equal(result.code, 400)
    assert.equal(calls.length, 0)
  }
})

test('limits vice principals to their assigned grades', async () => {
  const { ctx, calls } = context('/api/reports/student-missing-attendance?studentId=student&from=2026-11-01&to=2026-11-15', 'vice_principal')
  await handleFeatureRequest(ctx)
  assert.deepEqual(calls.find(call => call.sql.includes('SELECT s.id,s.name')).params, ['school', 'student', ['grade-b']])
  assert.deepEqual(calls.find(call => call.sql.includes('WITH school_days')).params, ['school', 'student', '2026-11-01', '2026-11-15'])
})
