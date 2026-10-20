const validUuid = value => /^[0-9a-f-]{36}$/i.test(String(value || ''))

export const isStudentGuide = user => user?.role === 'counselor' && validUuid(user?.counselor_id)
export const isVicePrincipal = user => user?.role === 'vice_principal' && validUuid(user?.vice_principal_id)

export async function studentGuideGrades(client, user) {
  if (!isStudentGuide(user)) return null
  const result = await client.query(`SELECT grade
    FROM student_counselor_grade_assignments
    WHERE school_id=$1 AND counselor_id=$2
    ORDER BY grade`, [user.school_id, user.counselor_id])
  return result.rows.map(row => row.grade)
}

export async function studentWellbeingGrades(client, user) {
  if (isStudentGuide(user)) return studentGuideGrades(client, user)
  if (!isVicePrincipal(user)) return null
  const result = await client.query(`SELECT grade
    FROM vice_principal_grade_assignments
    WHERE school_id=$1 AND vice_principal_id=$2
    ORDER BY grade`, [user.school_id, user.vice_principal_id])
  return result.rows.map(row => row.grade)
}

export function gradeScope(values, grades, column = 's.grade') {
  if (grades === null) return ''
  values.push(grades)
  return ` AND ${column}=ANY($${values.length}::text[])`
}

export async function guideCanAccessStudent(client, user, studentId) {
  if (!isStudentGuide(user)) return true
  const grades = await studentGuideGrades(client, user)
  if (!grades.length) return false
  const result = await client.query(`SELECT 1 FROM students
    WHERE school_id=$1 AND id=$2 AND grade=ANY($3::text[])`, [user.school_id, studentId, grades])
  return result.rowCount > 0
}

export async function wellbeingCanAccessStudent(client, user, studentId) {
  const grades = await studentWellbeingGrades(client, user)
  if (grades === null) return true
  if (!grades.length) return false
  const result = await client.query(`SELECT 1 FROM students
    WHERE school_id=$1 AND id=$2 AND grade=ANY($3::text[])`, [user.school_id, studentId, grades])
  return result.rowCount > 0
}
