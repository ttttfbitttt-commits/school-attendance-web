import { wellbeingCanAccessStudent, isVicePrincipal } from './counselorScope.mjs'

export async function migrateAttendanceCorrection(adminPool) {
  await adminPool.query(`CREATE TABLE IF NOT EXISTS attendance_correction_audit (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id text NOT NULL, attendance_date date NOT NULL, original_status text NOT NULL,
    original_recorded_at timestamptz NOT NULL, original_recorded_by uuid,
    corrected_by uuid NOT NULL REFERENCES users(id), corrected_at timestamptz NOT NULL DEFAULT now()
  )`)
}

export async function cancelAttendance({ user, studentId, date, today, scoped }) {
  if (!['admin','vice_principal'].includes(user.role)) return { error:'forbidden', status:403 }
  if (user.role === 'vice_principal' && !isVicePrincipal(user)) return { error:'forbidden', status:403 }
  if (!studentId || date!==today) return { error:'invalid_attendance_date', status:400 }
  return scoped(user.school_id, async client => {
    if (!await wellbeingCanAccessStudent(client,user,studentId)) return { error:'not_found',status:404 }
    const removed=await client.query(`DELETE FROM attendance_logs WHERE school_id=$1 AND student_id=$2 AND attendance_date=$3
      RETURNING status, recorded_at, recorded_by`,[user.school_id,studentId,date])
    if (!removed.rowCount) return { error:'not_found',status:404 }
    const row=removed.rows[0]
    await client.query(`INSERT INTO attendance_correction_audit
      (school_id,student_id,attendance_date,original_status,original_recorded_at,original_recorded_by,corrected_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,[user.school_id,studentId,date,row.status,row.recorded_at,row.recorded_by,user.user_id])
    return {ok:true}
  })
}
