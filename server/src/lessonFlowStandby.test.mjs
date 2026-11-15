import test from 'node:test'
import assert from 'node:assert/strict'
import { syncVoiceTimetableCoverages } from './lessonFlow.mjs'

function fixture(existing = []) {
  const calls = []
  const client = { query: async (sql, params) => {
    calls.push({ sql, params })
    if (sql.includes('FROM lesson_schedule_imports')) return { rows: [{ id: 'import' }], rowCount: 1 }
    if (sql.includes('source_record_id AS')) return { rows: existing, rowCount: existing.length }
    if (sql.includes('FROM lesson_classrooms')) return { rows: [{ id: 'class' }], rowCount: 1 }
    if (sql.includes('FROM lesson_teachers')) return { rows: [{ id: 'teacher', full_name: 'عبدالله بن وصل الله الصاعدي' }], rowCount: 1 }
    return { rows: [], rowCount: 1 }
  } }
  return { calls, scoped: async (schoolId, fn) => { assert.equal(schoolId, 'school-a'); return fn(client) } }
}

test('coverage maps equivalent teacher names within the current school', async () => {
  const { calls, scoped } = fixture()
  const result = await syncVoiceTimetableCoverages({ scoped, schoolId: 'school-a', date: '2026-11-15', entries: [{ recordId:'r', entryKey:'a:1', period:1, className:'فصل', replacementName:'عبد الله وصل الله الصاعدي' }] })
  assert.equal(result.mapped, 1)
  const insert = calls.find(call => call.sql.includes('INSERT INTO voice_timetable_coverages'))
  assert.equal(insert.params[0], 'school-a')
  assert.equal(insert.params[8], 'teacher')
})

test('cancelling a coverage removes its standby sheet only in the same school', async () => {
  const { calls, scoped } = fixture([{ id:'coverage', recordId:'r', entryKey:'a:1', teacherId:'teacher' }])
  await syncVoiceTimetableCoverages({ scoped, schoolId:'school-a', date:'2026-11-15', entries:[] })
  const deletes = calls.filter(call => call.sql.includes('DELETE FROM'))
  assert.equal(deletes.length, 2)
  for (const call of deletes) assert.equal(call.params[0], 'school-a')
})
