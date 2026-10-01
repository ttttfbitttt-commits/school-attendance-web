export type Account = { email: string; displayName: string; role: 'admin' | 'staff' | 'teacher'; schoolId: string; teacherId?: string; mustChangePassword?: boolean }
export type SchoolPreferences = { attendanceMode: 'auto' | 'present' | 'late'; cutoffTime: string; gradeAliases: Record<string, string> }
export type SchoolProfile = { schoolName: string; principalName: string; academicYear: string; semester: string; preferences: SchoolPreferences }
export type AlmadarAccount = { configured: boolean; senderName?: string; lastBalance?: string | null; verifiedAt?: string | null; updatedAt?: string | null }
export type Excuse = { id: string; studentId: string; name: string; grade: string; classroom: string; category: string; note: string; startDate: string; endDate: string | null; createdAt: string }
export type AbsenceStatus = 'unexcused' | 'excused' | 'special'
export type AbsenceSummaryStatus = AbsenceStatus | 'mixed'
export type AbsenceRow = {
  studentId: string
  id?: string
  name: string
  phone: string
  grade: string
  classroom: string
  absenceDays: number
  unexcusedDays: number
  excusedDays: number
  specialDays: number
  status: AbsenceSummaryStatus
  hasExcuse?: boolean
  excuses?: Array<{ category: string; note: string; startDate: string; endDate: string | null }>
}
export type AbsenceReport = {
  from: string
  to: string
  workingDays: number
  confirmedDays?: number
  summary?: { absenceDays: number; students: number; unexcusedDays: number; excusedDays: number; specialDays: number }
  rows: AbsenceRow[]
}
export type AbsenceDetails = {
  from: string
  to: string
  student: { studentId: string; name: string; phone: string; grade: string; classroom: string }
  days: Array<{ date: string; status: AbsenceStatus; note: string; calculatedAt: string; updatedAt: string }>
  statusCounts: Record<AbsenceStatus, number>
}
export type DailyStudentRow = { id?: string; studentId: string; name: string; grade: string; classroom: string; phone: string; date: string; status: 'unexcused' | 'excused'; note?: string; time?: string }
export type CountStudentRow = { studentId: string; name: string; grade: string; classroom: string; phone: string; days: number; excusedDays: number; unexcusedDays: number }
export type StudentHistory = { student: { studentId: string; name: string; grade: string; classroom: string; phone: string }; type: 'absence' | 'late'; days: Array<{ date: string; status: 'unexcused' | 'excused'; time?: string }> }
export type DetailedStudentReport = {
  from: string
  to: string
  student: { studentId: string; name: string; grade: string; classroom: string; phone: string }
  summary: { schoolAbsenceDays: number; schoolLateDays: number }
  lessons: Array<{ date: string; weekday: number; periodNumber: number; subject: string; teacherName: string; classroom: string; grade: string; classroomValue: string; status: 'present' | 'absent'; note: TeacherNote | '' }>
}
export type MessageLog = { id: string; studentId: string | null; studentName: string; recipient: string; senderName: string; type: 'late' | 'absence' | 'general' | 'test'; body: string; status: 'sent' | 'failed'; errorDetail: string; createdAt: string }
export type LessonTimeSlot = { weekday: number; periodNumber: number; startTime: string; endTime: string }
export type LessonClassroom = { id: string; name: string; qrToken: string }
export type LessonTeacher = { id: string; name: string; identityNumber: string }
export type LessonTeacherCandidate = { id: string; name: string; identityNumber: string; score: number }
export type LessonUnresolvedName = { rawName: string; occurrences: number; candidates: LessonTeacherCandidate[] }
export type LessonFlowOverview = {
  summary: {
    teachers: number
    classrooms: number
    assignments: number
    unresolved: number
    incidents: { drafts: number; confirmed: number; total: number }
  }
  activeImport: { id: string; sourceSchoolName: string; importedAt: string } | null
  teachers: LessonTeacher[]
  classrooms: LessonClassroom[]
  times: LessonTimeSlot[]
  unresolved: LessonUnresolvedName[]
}
export type LessonScheduleAssignment = {
  weekday: number
  periodNumber: number
  subjectName: string
  rawTeacherName: string
  mappingStatus: 'exact' | 'manual' | 'unresolved'
  teacherId: string | null
  teacherName: string | null
  identityNumber: string | null
}
export type LessonSchedule = { classroom: { id: string; name: string }; assignments: LessonScheduleAssignment[] }
export type LessonIncident = {
  id: string
  classroomId: string
  classroom: string
  teacherId: string
  teacherName: string
  identityNumber: string
  subject: string
  incidentDate: string
  weekday: number
  periodNumber: number
  startTime: string
  endTime: string
  status: 'draft' | 'confirmed' | 'cancelled'
  cancelNote: string
  detectedAt: string
  confirmedAt: string | null
}
export type TeacherDayAbsence = { teacherId: string; name: string; identityNumber: string; date: string }
export type LessonScanPreview = {
  confirmationToken: string
  classroomId: string
  classroom: string
  teacherId: string
  teacherName: string
  identityNumber: string
  subject: string
  incidentDate: string
  weekday: number
  periodNumber: number
  startTime: string
  endTime: string
}
export type TeacherPortalScheduleItem = { assignmentId: string; classroomId: string; classroom: string; weekday: number; periodNumber: number; subject: string; startTime: string | null; endTime: string | null }
export type TeacherPortalDashboard = { schoolName: string; teacher: { name: string; identityNumber: string }; date: string; weekday: number; schedule: TeacherPortalScheduleItem[]; weekSchedule: TeacherPortalScheduleItem[] }
export type TeacherNote = 'هروب من الحصة' | 'نائم أثناء الدرس' | 'لم يحل الواجب' | 'لم يشارك' | 'مشارك فعال' | 'لم يحضر الكتاب أو المذكرة' | 'استخدام الجوال أثناء الحصة'
export type TeacherSheetColumn = { id: string; label: string; type: 'score' | 'text' | 'choice' | 'boolean'; maxScore: number | null; choices: string[] }
export type TeacherSheetType = 'followup' | 'homework' | 'tests'
export type TeacherSheetOpenType = TeacherSheetType | 'combined'
export type TeacherSheetConfig = { id?: string; subject: string; sheetType: TeacherSheetType; version: number; columns: TeacherSheetColumn[]; createdAt?: string }
export type TeacherSheetSubject = { subject: string; configs: TeacherSheetConfig[] }
export type TeacherSheetReport = { subject: string; sheetType: TeacherSheetType; version: number; columns: TeacherSheetColumn[]; classroomId: string; classroom: string; grade: string; students: Array<{ id: string; name: string; phone: string; grade: string; classroom: string; values: Record<string, string | number | boolean> }> }
export type TeacherLessonStudent = { id: string; name: string; phone: string; grade: string; classroom: string; status: 'present' | 'absent'; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }
export type TeacherLesson = { assignment: { assignmentId: string; classroomId: string; classroom: string; subject: string }; date: string; periodNumber: number; mapping: { grade: string; classroom: string; mappingSource: 'automatic' | 'manual' }; sheetConfig: TeacherSheetConfig | null; sheetConfigs: TeacherSheetConfig[]; students: TeacherLessonStudent[] }
export type TeacherLessonReport = {
  id: string; date: string; weekday: number; periodNumber: number; teacherId: string; teacherName: string; classroom: string; subject: string; grade: string; classroomValue: string; savedAt: string
  studentsCount: number; presentCount: number; absentCount: number
  records: Array<{ studentId: string; name: string; grade: string; classroom: string; status: 'present' | 'absent'; note: TeacherNote | '' }>
}
export type TeacherAdminOverview = {
  teachers: Array<{ teacherId: string; name: string; identityNumber: string; assignments: number; accountActive: boolean; accountCreated: boolean; mustChangePassword: boolean }>
  classroomMappings: Array<{ classroomId: string; classroom: string; grade: string | null; classroomValue: string | null; mappingSource: 'automatic' | 'manual' | null }>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || 'request_failed') as Error & { code?: string; data?: unknown }
    error.code = data.error || 'request_failed'
    error.data = data
    throw error
  }
  return data as T
}

export const api = {
  me: () => request<{ user: Account }>('/me'),
  login: (email: string, password: string) => request<{ user: Account }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  teacherLogin: (identityNumber: string, password: string, schoolId = '') => request<{ user: Account }>('/auth/teacher-login', { method: 'POST', body: JSON.stringify({ identityNumber, password, schoolId: schoolId || undefined }) }),
  register: (displayName: string, schoolName: string, email: string, password: string) => request<{ ok: boolean }>('/auth/register', { method: 'POST', body: JSON.stringify({ displayName, schoolName, email, password }) }),
  verifySchoolEmail: (token: string) => request<{ user: Account; school: { id: string; name: string } }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  school: () => request<{ school: SchoolProfile }>('/school'),
  saveSchool: (school: SchoolProfile) => request<{ school: SchoolProfile }>('/school', { method: 'PUT', body: JSON.stringify(school) }),
  students: () => request<{ students: unknown[] }>('/students'),
  saveStudents: (students: unknown[]) => request<{ ok: boolean }>('/students', { method: 'PUT', body: JSON.stringify({ students }) }),
  attendance: () => request<{ records: unknown[] }>('/attendance'),
  markAttendance: (studentId: string, status: 'present' | 'late') => request<{ ok: boolean }>('/attendance', { method: 'POST', body: JSON.stringify({ studentId, status }) }),
  markAttendanceBulk: (studentIds: string[], status: 'present' | 'late') => request<{ ok: boolean; created: string[]; duplicates: string[]; missing: string[] }>('/attendance/bulk', { method: 'POST', body: JSON.stringify({ studentIds, status }) }),
  clearAttendance: (date: string) => request<{ ok: boolean }>(`/attendance?date=${encodeURIComponent(date)}`, { method: 'DELETE' }),
  almadar: () => request<{ account: AlmadarAccount }>('/almadar'),
  saveAlmadar: (settings: { username: string; password: string; apiKey: string; senderName: string }) => request<{ ok: boolean }>('/almadar', { method: 'PUT', body: JSON.stringify(settings) }),
  verifyAlmadar: () => request<{ ok: boolean; balance: string | number | null }>('/almadar/verify', { method: 'POST' }),
  testAlmadar: (phone: string) => request<{ ok: boolean; recipientSuffix: string }>('/almadar/test-send', { method: 'POST', body: JSON.stringify({ phone }) }),
  excuses: () => request<{ excuses: Excuse[] }>('/excuses'),
  addExcuse: (excuse: { studentId: string; category: string; note: string; startDate: string; endDate: string }) => request<{ ok: boolean; id: string }>('/excuses', { method: 'POST', body: JSON.stringify(excuse) }),
  deleteExcuse: (id: string) => request<{ ok: boolean }>(`/excuses?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  absenceReport: (from: string, to: string, studentId = '') => request<AbsenceReport>(`/reports/absences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${studentId ? `&studentId=${encodeURIComponent(studentId)}` : ''}`),
  calculateAbsences: (date: string) => request<{ ok: boolean; date: string; created: number; confirmed: number }>('/absences/calculate', { method: 'POST', body: JSON.stringify({ date }) }),
  cancelAbsences: (date: string) => request<{ ok: boolean; date: string; deleted: number }>('/absences/cancel', { method: 'POST', body: JSON.stringify({ date }) }),
  absenceDetails: (studentId: string, from: string, to: string) => request<AbsenceDetails>(`/absences/details?studentId=${encodeURIComponent(studentId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  setAbsenceStatus: (payload: { studentIds: string[]; from: string; to: string; status: AbsenceStatus; note?: string }) => request<{ ok: boolean; updatedDays: number; affectedStudents: number }>('/absences/status/bulk', { method: 'PATCH', body: JSON.stringify(payload) }),
  correctAbsences: (payload: { studentIds: string[]; from: string; to: string; time: string; dates?: string[]; status?: 'present' | 'late' }) => request<{ ok: boolean; correctedDays: number; affectedStudents: number }>('/absences/correct-present/bulk', { method: 'POST', body: JSON.stringify({ ...payload, attendanceStatus: payload.status || 'present' }) }),
  missingAttendance: (date: string) => request<{ date: string; count: number }>(`/reports/missing-attendance?date=${encodeURIComponent(date)}`),
  dailyAbsences: (date: string) => request<{ date: string; rows: DailyStudentRow[] }>(`/reports/daily-absences?date=${encodeURIComponent(date)}`),
  dailyLates: (date: string) => request<{ date: string; rows: DailyStudentRow[] }>(`/reports/daily-lates?date=${encodeURIComponent(date)}`),
  setDailyLateStatus: (payload: { date: string; studentIds: string[]; status: 'unexcused' | 'excused' }) => request<{ ok: boolean; updated: number }>('/reports/daily-lates/status', { method: 'PATCH', body: JSON.stringify(payload) }),
  absenceSummary: (studentIds: string[] = []) => request<{ type: 'absence'; rows: CountStudentRow[] }>(`/reports/absence-summary${studentIds.length ? `?studentIds=${encodeURIComponent(studentIds.join(','))}` : ''}`),
  lateSummary: (studentIds: string[] = []) => request<{ type: 'late'; rows: CountStudentRow[] }>(`/reports/late-summary${studentIds.length ? `?studentIds=${encodeURIComponent(studentIds.join(','))}` : ''}`),
  studentHistory: (type: 'absence' | 'late', studentId: string) => request<StudentHistory>(`/reports/student-history?type=${type}&studentId=${encodeURIComponent(studentId)}`),
  detailedStudentReport: (studentId: string, from: string, to: string) => request<DetailedStudentReport>(`/reports/student-detail?studentId=${encodeURIComponent(studentId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  messages: (type?: MessageLog['type']) => request<{ messages: MessageLog[] }>(`/messages${type ? `?type=${encodeURIComponent(type)}` : ''}`),
  sendMessages: (payload: { studentIds: string[]; type: 'late' | 'absence' | 'general'; message?: string }) => request<{ ok: boolean; sent: number; failed: number }>('/messages/send', { method: 'POST', body: JSON.stringify(payload) }),
  lessonOverview: () => request<LessonFlowOverview>('/lesson-flow/overview'),
  teacherDayAbsences: () => request<{ date: string; teachers: TeacherDayAbsence[] }>('/lesson-flow/teacher-day-absences'),
  addTeacherDayAbsences: (teacherIds: string[]) => request<{ date: string; added: number; teachers: TeacherDayAbsence[] }>('/lesson-flow/teacher-day-absences', { method: 'POST', body: JSON.stringify({ teacherIds }) }),
  removeTeacherDayAbsence: (teacherId: string) => request<{ ok: boolean; removed: number }>(`/lesson-flow/teacher-day-absences?teacherId=${encodeURIComponent(teacherId)}`, { method: 'DELETE' }),
  importLessonTeachers: (teachers: Array<{ name: string; identityNumber: string; phone?: string }>) =>
    request<{ ok: boolean; imported: number; exactResolved: number }>('/lesson-flow/teachers', { method: 'POST', body: JSON.stringify({ teachers }) }),
  importLessonSchedule: (payload: {
    sourceSchoolName?: string
    classrooms: Array<{ name: string } | string>
    assignments: Array<{ classroomName: string; weekday: number; periodNumber: number; subjectName?: string; rawTeacherName?: string }>
    times: LessonTimeSlot[]
  }) => request<{ ok: boolean; importedClassrooms: number; importedAssignments: number; resolved: number; seededTimes: number }>('/lesson-flow/schedule', { method: 'POST', body: JSON.stringify(payload) }),
  saveLessonMappings: (mappings: Array<{ rawName: string; teacherId: string }>) =>
    request<{ ok: boolean; updated: number }>('/lesson-flow/mappings', { method: 'POST', body: JSON.stringify({ mappings }) }),
  saveLessonTimes: (times: LessonTimeSlot[]) =>
    request<{ ok: boolean; saved: number }>('/lesson-flow/times', { method: 'PUT', body: JSON.stringify({ times }) }),
  lessonSchedule: (classroomId: string) => request<LessonSchedule>(`/lesson-flow/schedule?classroomId=${encodeURIComponent(classroomId)}`),
  scanLessonClass: (code: string) => request<{ incident?: LessonIncident; preview?: LessonScanPreview; existing: boolean }>('/lesson-flow/scan', { method: 'POST', body: JSON.stringify({ code }) }),
  confirmLessonScan: (confirmationToken: string) => request<{ incident: LessonIncident; existing: boolean }>('/lesson-flow/scan/confirm', { method: 'POST', body: JSON.stringify({ confirmationToken }) }),
  createManualLessonIncident: (payload: { classroomId: string; periodNumber: number; teacherId: string; incidentDate: string }) =>
    request<{ incident: LessonIncident; existing: boolean }>('/lesson-flow/incidents/manual', { method: 'POST', body: JSON.stringify(payload) }),
  lessonIncidents: (date?: string) => request<{ incidents: LessonIncident[] }>(`/lesson-flow/incidents${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  confirmLessonIncident: (id: string) => request<{ ok: boolean }>(`/lesson-flow/incidents/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({}) }),
  cancelLessonIncident: (id: string, note = '') => request<{ ok: boolean }>(`/lesson-flow/incidents/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ note }) }),
  deleteLessonIncident: (id: string) => request<{ ok: boolean }>(`/lesson-flow/incidents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  teacherDashboard: (date: string) => request<TeacherPortalDashboard>(`/teacher-portal/teacher/dashboard?date=${encodeURIComponent(date)}`),
  teacherLesson: (classroomId: string, date: string, periodNumber: number, sheetType: TeacherSheetOpenType) => request<TeacherLesson>(`/teacher-portal/teacher/lesson?classroomId=${encodeURIComponent(classroomId)}&date=${encodeURIComponent(date)}&periodNumber=${periodNumber}&sheetType=${sheetType}`),
  saveTeacherLesson: (payload: { classroomId: string; date: string; periodNumber: number; sheetType: TeacherSheetOpenType; students: Array<{ studentId: string; status: 'present' | 'absent'; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }> }) => request<{ ok: boolean; saved: number }>('/teacher-portal/teacher/lesson', { method: 'PUT', body: JSON.stringify(payload) }),
  teacherReports: (filters: { date?: string; from?: string; to?: string; studentId?: string; note?: string } = {}) => request<{ reports: TeacherLessonReport[] }>(`/teacher-portal/teacher/reports?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
  changeTeacherPassword: (password: string) => request<{ ok: boolean }>('/teacher-portal/teacher/password', { method: 'POST', body: JSON.stringify({ password }) }),
  teacherSheets: () => request<{ sheets: TeacherSheetSubject[] }>('/teacher-portal/teacher/sheets'),
  saveTeacherSheetConfig: (subjectName: string, sheetType: TeacherSheetType, columns: TeacherSheetColumn[]) => request<{ config: TeacherSheetConfig }>('/teacher-portal/teacher/sheets/config', { method: 'PUT', body: JSON.stringify({ subjectName, sheetType, columns }) }),
  deleteTeacherSheetConfig: (subjectName: string, sheetType: TeacherSheetType) => request<{ ok: boolean }>(`/teacher-portal/teacher/sheets/config?subjectName=${encodeURIComponent(subjectName)}&sheetType=${sheetType}`, { method: 'DELETE' }),
  teacherSheetReport: (subjectName: string, classroomId: string, sheetType: TeacherSheetType) => request<TeacherSheetReport>(`/teacher-portal/teacher/sheet-report?subjectName=${encodeURIComponent(subjectName)}&classroomId=${encodeURIComponent(classroomId)}&sheetType=${sheetType}`),
  teacherAdminOverview: () => request<TeacherAdminOverview>('/teacher-portal/admin/overview'),
  teacherAdminCredentials: () => request<{ credentials: Array<{ teacherId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/teacher-portal/admin/credentials'),
  teacherMappingOptions: () => request<{ options: Array<{ grade: string; classroom: string; count: number }> }>('/teacher-portal/admin/mapping-options'),
  saveTeacherClassroomMapping: (payload: { classroomId: string; grade: string; classroom: string }) => request<{ ok: boolean }>('/teacher-portal/admin/classroom-mapping', { method: 'PUT', body: JSON.stringify(payload) }),
  generateTeacherAccounts: (teacherIds: string[]) => request<{ ok: boolean; created: number; credentials: Array<{ teacherId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/teacher-portal/admin/accounts/generate', { method: 'POST', body: JSON.stringify({ teacherIds }) }),
  resetTeacherAccount: (teacherId: string) => request<{ ok: boolean; temporaryPassword: string }>('/teacher-portal/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ teacherId }) }),
  resetTeacherAccounts: (teacherIds: string[]) => request<{ ok: boolean; reset: number; credentials: Array<{ teacherId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/teacher-portal/admin/accounts/bulk-reset', { method: 'POST', body: JSON.stringify({ teacherIds }) }),
  setTeacherAccountStatus: (teacherId: string, active: boolean) => request<{ ok: boolean }>('/teacher-portal/admin/accounts/status', { method: 'PATCH', body: JSON.stringify({ teacherId, active }) }),
  teacherAdminReports: (filters: { date?: string; teacherId?: string; note?: string; classroomId?: string } = {}) => request<{ reports: TeacherLessonReport[] }>(`/teacher-portal/admin/reports?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
}
