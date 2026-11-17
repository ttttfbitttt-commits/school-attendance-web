import test from 'node:test'
import assert from 'node:assert/strict'
import { gradeDisplayName, assignedGradeLabel } from '../src/gradeDisplay.ts'

test('shows the saved display alias while leaving the original key untouched', () => {
  const aliases = { 'الأول المتوسط_التعليم العام': 'الأول المتوسط' }
  assert.equal(gradeDisplayName('الأول المتوسط_التعليم العام', aliases), 'الأول المتوسط')
  assert.equal(assignedGradeLabel('الأول المتوسط_التعليم العام', aliases, 302), 'الأول المتوسط')
  assert.equal(gradeDisplayName('الثاني', aliases), 'الثاني')
})

test('clearly marks an assignment that has no students in the original grade', () => {
  const result = assignedGradeLabel('0730', { '0730': 'الأول المتوسط' }, 0)
  assert.ok(result.includes('الأول المتوسط'))
  assert.ok(result.includes('0730'))
  assert.ok(result.includes('لا يوجد طلاب'))
})
