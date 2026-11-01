export type Account = { email: string; displayName: string; role: 'admin' | 'staff' | 'teacher' | 'administrator' | 'student' | 'counselor' | 'vice_principal' | 'activity_leader'; schoolId: string; teacherId?: string; administratorId?: string; studentId?: string; counselorId?: string; vicePrincipalId?: string; activityLeaderId?: string; lessonFlowAccess?: boolean; studentAttendanceCooperationAccess?: boolean; mustChangePassword?: boolean }
export type LoginChoice = { userId: string; schoolId: string; role: Account['role']; schoolName: string }
export type StudentPortalAccount = { studentId: string; name: string; grade: string; classroom: string; phone: string; identityNumber: string; eligible: boolean; accountCreated: boolean; accountActive: boolean; mustChangePassword: boolean; attendanceCooperationAccess: boolean }
export type StudentPortfolioCorrection = { assignmentId: string; studentId: string; slotNumber: number; teacherName: string; note: string; color: string; correctedAt: string; signatureMode?: 'uploaded' | 'generated'; signatureData?: string }
export type TeacherPortfolioCorrectionSettings = { signatureMode: 'uploaded' | 'generated'; signatureData: string; signatureIsDefault?: boolean; correctionColor: string }
export type StudentPortfolioSlot = { slotNumber: number; fileUrl: string; fileName: string; fileType: string; uploadedAt: string | null; correction?: StudentPortfolioCorrection | null }
export type StudentAccountGeneration = { ok: boolean; jobId: string; total: number; processed: number; created: number; skipped: number; failed: number; status: 'running' | 'completed' | 'failed'; defaultPassword: string }
export type StudentPortfolioSubject = { assignmentId: string; subject: string; teacherName: string; grade: string; classroom: string; slots: StudentPortfolioSlot[] }
export type StudentPortfolioGroup = { assignmentId: string; subject: string; teacherName: string; grade: string; classroom: string; studentCount: number; submittedFiles: number }
export type StudentPortfolioEntries = { assignmentId: string; subject: string; teacherName: string; grade: string; classroom: string; students: Array<{ id: string; name: string; grade: string; classroom: string; identityNumber: string; slots: StudentPortfolioSlot[] }> }
export type StudentCooperationStatus = { authorized: boolean; configured: boolean; available: boolean; date: string; windowStart: string; windowEnd: string; classroom: { grade: string; classroom: string } | null }
export type StudentCooperationScan = { outcome: 'created' | 'duplicate'; student: { id: string; name: string; grade: string; classroom: string }; attendance: { status: 'present'; time: string } }
export type StudentPortalDashboard = { schoolName: string; mustChangePassword: boolean; attendanceCooperation: StudentCooperationStatus; student: { id: string; name: string; grade: string; classroom: string; phone: string; identityNumber: string; qrValue: string }; subjects: StudentPortfolioSubject[]; schedule: Array<{ assignmentId: string; weekday: number; periodNumber: number; subject: string; teacherName: string; classroom: string; startTime: string | null; endTime: string | null }> }
export type AdministrativeStaff = { administratorId: string; name: string; identityNumber: string; phone: string; active: boolean; accountCreated: boolean; accountActive: boolean; mustChangePassword: boolean; lessonFlowAccess: boolean; credentialsAvailable: boolean }
export type CounselorGradeOption = { grade: string; counselorId: string | null }
export type StudentCounselor = { counselorId: string; name: string; identityNumber: string; phone: string; active: boolean; accountCreated: boolean; accountActive: boolean; mustChangePassword: boolean; assignedGrades: string[] }
export type VicePrincipalGradeOption = { grade: string; vicePrincipalId: string | null }
export type SchoolVicePrincipal = { vicePrincipalId: string; name: string; identityNumber: string; phone: string; grade: string; active: boolean; accountCreated: boolean; accountActive: boolean; mustChangePassword: boolean }
export type SchoolActivityLeader = { activityLeaderId: string; name: string; identityNumber: string; phone: string; active: boolean; accountCreated: boolean; accountActive: boolean; mustChangePassword: boolean }
export type CounselorPortalDashboard = { schoolName: string; mustChangePassword: boolean; counselor: { name: string; identityNumber: string; phone: string }; assignedGrades: string[]; students: Array<{ id: string; name: string; phone: string; grade: string; classroom: string }>; teachers: Array<{ teacherId: string; name: string; identityNumber: string; phone: string }> }
export type AdministratorAttendanceStudent = { id: string; name: string; phone: string; grade: string; classroom: string }
export type AdministratorAttendanceRecord = { studentId: string; date: string; time: string; status: 'present' | 'late'; name: string; grade: string; classroom: string; phone: string; recordedBy?: string }
export type SchoolPreferences = { attendanceMode: 'auto' | 'present' | 'late'; cutoffTime: string; gradeAliases: Record<string, string> }
export type ReportSchoolBrand = { schoolName: string; generalEducationAdministration: string; educationOffice: string }
export type SchoolProfile = { schoolName: string; principalName: string; generalEducationAdministration: string; educationOffice: string; academicYear: string; semester: string; preferences: SchoolPreferences }
export type SchoolStorageUsage = { totalBytes: number; recordsBytes: number; portfolioBytes: number; portfolioFiles: number; records: number }
export type PlatformSchoolUsage = {
  id: string
  name: string
  activatedAt: string
  activatedBy: { name: string; email: string }
  registeredEmails: string[]
  teacherCount: number
  teacherAccounts: number
  teachers: string[]
  studentCount: number
  studentAccounts: number
  loginCount30Days: number
  lastLoginDate: string | null
  attendanceCount: number
  usage: {
    status: 'active' | 'used_before' | 'login_only' | 'not_started'
    records90Days: number
    records30Days: number
    attendance30Days: number
    absences30Days: number
    messages30Days: number
    totalRecords: number
    lastActualUse: string | null
  }
  storage: { totalBytes: number; recordsBytes: number; portfolioBytes: number; portfolioFiles: number; records: number }
}
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
export type DailyStudentRow = { id?: string; studentId: string; name: string; grade: string; classroom: string; phone: string; date: string; status: 'unexcused' | 'excused'; note?: string; time?: string; recordState?: 'pending' | 'approved' }
export type PendingAbsenceStudent = { studentId: string; name: string; grade: string; classroom: string; phone: string }
export type CountStudentRow = { studentId: string; name: string; grade: string; classroom: string; phone: string; days: number; excusedDays: number; unexcusedDays: number }
export type StudentHistory = { student: { studentId: string; name: string; grade: string; classroom: string; phone: string }; type: 'absence' | 'late'; days: Array<{ date: string; status: 'unexcused' | 'excused'; time?: string }> }
export type DetailedStudentReport = {
  from: string
  to: string
  student: { studentId: string; name: string; grade: string; classroom: string; phone: string }
  summary: { schoolAbsenceDays: number; schoolLateDays: number }
  subjects: Array<{ subject: string; teacherName: string; grade: string; classroomValue: string }>
  grades: Array<{ date: string; subject: string; teacherName: string; grade: string; classroomValue: string; sheetType: TeacherSheetType; columns: TeacherSheetColumn[]; values: Record<string, string | number | boolean> }>
  lessons: Array<{ date: string; weekday: number; periodNumber: number; subject: string; teacherName: string; classroom: string; grade: string; classroomValue: string; status: 'present' | 'absent' | 'late' | 'excused'; note: TeacherNote | '' }>
}
export type MessageLog = { id: string; studentId: string | null; studentName: string; recipient: string; senderName: string; type: 'late' | 'absence' | 'general' | 'teacher' | 'test'; body: string; status: 'sent' | 'failed'; errorDetail: string; createdAt: string }
export type MessageTeacher = { id: string; name: string; identityNumber: string; phone: string }
export type StudentRecord = { id: string; name: string; phone: string; grade: string; classroom: string; sheet: string; row: number }
export type StudentInput = Pick<StudentRecord, 'id' | 'name' | 'phone' | 'grade' | 'classroom'>
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
export type LessonIncidentReportRow = {
  id: string
  teacherName: string
  incidentDate: string
  weekday: number
  classroomId: string
  classroom: string
  periodNumber: number
  schoolResponseStatus: 'replied' | 'not_replied' | 'unrecorded'
  schoolResponseUpdatedAt: string | null
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
export type TeacherPortalDashboard = { schoolName: string; teacher: { name: string; identityNumber: string }; date: string; weekday: number; schedule: TeacherPortalScheduleItem[]; weekSchedule: TeacherPortalScheduleItem[]; periodNumbers: number[]; activityEvidenceCount?: number }
export type TeacherEvidenceClass = { grade: string; classrooms: string[] }
export type TeacherEvidenceImage = { slotNumber: number; fileUrl: string; updatedAt: string }
export type TeacherEvidenceRecord = { id: string; slotNumber: number; activityId: string | null; grade: string; classroom: string; title: string; strategy: string; visitTeacherId: string | null; visitTeacherName: string; vicePrincipalId: string | null; vicePrincipalName: string; activityLeaderName: string; notes: string; createdAt: string; updatedAt: string; images: TeacherEvidenceImage[] }
export type TeacherRequiredActivity = { activityId: string; slotNumber: number; title: string; description: string; attachmentName: string; attachmentType: string; attachmentUrl: string; record: TeacherEvidenceRecord | null }
export type TeacherEvidenceOverview = { options: { classes: TeacherEvidenceClass[]; teachers: Array<{ teacherId: string; name: string }>; vicePrincipals: Array<{ vicePrincipalId: string; name: string }> }; records: TeacherEvidenceRecord[]; unseenActivityCount: number; requiredActivities: TeacherRequiredActivity[] }
export type ActivityLeaderActivity = { id: string; slotNumber: number; title: string; description: string; attachmentName: string; attachmentType: string; attachmentUrl: string; teacherCount: number; completedCount: number; teacherIds?: string[]; createdAt: string }
export type ActivityLeaderActivities = { activities: ActivityLeaderActivity[]; teachers: Array<{ teacherId: string; name: string; identityNumber: string }> }
export type ActivityLeaderActivityReport = { activity: ActivityLeaderActivity; recipients: Array<{ teacherId: string; name: string; identityNumber: string; seenAt: string | null; completedAt: string | null; evidenceId: string | null; grade: string; classroom: string; title: string; strategy: string; notes: string; completed: boolean; images: TeacherEvidenceImage[] }> }
export type TeacherEvidenceAdminTeacher = { teacherId: string; name: string; identityNumber: string; evidenceCount: number }
export type TeacherEvidenceAdminRecords = { teacher: { teacherId: string; name: string; identityNumber: string }; records: TeacherEvidenceRecord[] }
export type TeacherCooperationContributor = { teacherId: string; name: string; count: number; firstTime: string; lastTime: string }
export type TeacherCooperationScan = { id: string; studentId: string; studentName: string; grade: string; classroom: string; periodNumber: number; status: 'present' | 'late'; time: string }
export type TeacherCooperationStudent = { id: string; name: string; grade: string; classroom: string }
export type TeacherCooperationStatus = {
  date: string; configured: boolean; available: boolean; activePeriod: 1 | 2 | null; windowStart: string; windowEnd: string
  periods: Array<{ periodNumber: 1 | 2; startTime: string; endTime: string }>
  contributors: TeacherCooperationContributor[]; ownCount: number; recent: TeacherCooperationScan[]
}
export type TeacherCooperationEntry = {
  id: string; teacherId: string; teacherName: string; studentId: string; studentName: string; grade: string; classroom: string
  date: string; periodNumber: 1 | 2; status: 'present' | 'late'; time: string
}
export type TeacherNote = 'هروب من الحصة' | 'نائم أثناء الدرس' | 'لم يحل الواجب' | 'عدم التفاعل والمشاركة' | 'مشارك فعال' | 'لم يحضر الكتاب أو أوراق العمل' | 'استخدام الجوال أثناء الحصة' | 'الحديث مع زملائه أثناء الدرس'
export type TeacherSheetColumn = { id: string; label: string; type: 'score' | 'text' | 'choice' | 'boolean'; maxScore: number | null; choices: string[] }
export type TeacherSheetType = 'followup' | 'homework' | 'tests' | 'noor'
export type TeacherSheetOpenType = TeacherSheetType | 'combined'
export type TeacherAssessmentPeriod = 'period1' | 'period2' | 'period3' | 'period4' | 'final'
export type NoorSheetMappingSource = { sheetType: Exclude<TeacherSheetType, 'noor'>; columnId: string; scores?: Record<string, number> }
export type NoorSheetMapping = { targetColumnId: string; sources: NoorSheetMappingSource[] }
export type TeacherSheetConfig = { id?: string; subject: string; sheetType: TeacherSheetType; assessmentPeriod: TeacherAssessmentPeriod; version: number; columns: TeacherSheetColumn[]; noorMappings?: NoorSheetMapping[]; createdAt?: string }
export type NoorSheetScan = { columns: Array<{ label: string; maxScore: number }>; metadata: { subject: string; period: string } }
export type TeacherSheetSubject = { subject: string; configs: TeacherSheetConfig[] }
export type TeacherSheetReport = { subject: string; sheetType: TeacherSheetOpenType; assessmentPeriod: TeacherAssessmentPeriod; sections: Array<{ sheetType: TeacherSheetType; version: number; columns: TeacherSheetColumn[] }>; classroomId: string; classroom: string; grade: string; students: Array<{ id: string; name: string; phone: string; grade: string; classroom: string; values: Record<string, string | number | boolean> }> }
export type TeacherLessonStudent = { id: string; name: string; phone: string; grade: string; classroom: string; status: 'present' | 'absent' | 'late' | 'excused'; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }
export type TeacherLesson = { assignment: { assignmentId: string; classroomId: string; classroom: string; subject: string }; date: string; periodNumber: number; assessmentPeriod: TeacherAssessmentPeriod; mapping: { grade: string; classroom: string; mappingSource: 'automatic' | 'manual' }; sheetConfig: TeacherSheetConfig | null; sheetConfigs: TeacherSheetConfig[]; noorCalculated?: boolean; students: TeacherLessonStudent[] }
export type TeacherLessonReport = {
  id: string; date: string; weekday: number; periodNumber: number; teacherId: string; teacherName: string; classroom: string; subject: string; grade: string; classroomValue: string; savedAt: string
  studentsCount: number; presentCount: number; absentCount: number; lateCount: number; excusedCount: number
  records: Array<{ studentId: string; name: string; grade: string; classroom: string; status: 'present' | 'absent' | 'late' | 'excused'; note: TeacherNote | '' }>
}
export type TeacherComprehensiveReportType = 'absence' | 'late' | 'notes'
export type TeacherComprehensiveReportOption = { subject: string; grade: string; classroom: string; classroomId: string }
export type TeacherComprehensiveReport = {
  type: TeacherComprehensiveReportType; subject: string; grade: string; classroom: string; classroomId: string
  students: Array<{ id: string; name: string; grade: string; classroom: string; events: Array<{ date: string; note?: TeacherNote }> }>
}
export type SchoolComprehensiveReportType = 'absence' | 'late'
export type SchoolComprehensiveReportOptions = { grades: Array<{ grade: string; classrooms: string[] }> }
export type SchoolComprehensiveReport = {
  type: SchoolComprehensiveReportType; grade: string; classroom: string
  students: Array<{ id: string; name: string; phone: string; grade: string; classroom: string; events: Array<{ date: string; subject?: string; period?: number; teacherName?: string; time?: string; excuseStatus?: 'unexcused' | 'excused' }> }>
}

export type TeacherAdminOverview = {
  teachers: Array<{ teacherId: string; name: string; identityNumber: string; assignments: number; accountActive: boolean; accountCreated: boolean; mustChangePassword: boolean; credentialsAvailable: boolean }>
  classroomMappings: Array<{ classroomId: string; classroom: string; grade: string | null; classroomValue: string | null; mappingSource: 'automatic' | 'manual' | null }>
}
export type StudentReferralReason = 'homework' | 'disruption' | 'late' | 'academic_weakness' | 'other'
export type StudentReferralStatus = 'submitted' | 'viewed' | 'under_review' | 'referred_to_counselor' | 'completed' | 'cancelled'
export type StudentReferral = {
  id: string; referenceNumber: string; teacherId: string; teacherName: string; studentId: string; studentName: string
  grade: string; classroom: string; classroomId: string; classroomName: string; assignmentId: string; subject: string
  date: string; weekday: number; periodNumber: number; reason: StudentReferralReason; otherReason: string; problemDescription: string
  status: StudentReferralStatus; referredToCounselor: boolean; viceAction: string; vicePrincipalName: string
  counselorAction: string; counselorName: string; createdAt: string; viewedAt: string | null; viceActionAt: string | null
  counselorActionAt: string | null; completedAt: string | null; cancelledAt: string | null
  events: Array<{ id: number; type: string; actorRole: string; note: string; createdAt: string }>
}

export type BehaviorCategory = 'violation' | 'distinguished'
export type BehaviorStatus = 'pending' | 'approved' | 'cancelled'
export type BehaviorRule = {
  code: string
  version: string
  category: BehaviorCategory
  title: string
  degree: number | null
  stageScope: string[]
  mode: 'in_person' | 'remote'
  deduction: number
  distinguishedScore: number
  article: number | null
  page: number | null
  procedures: Array<{ name: string; deduct: boolean; items: string[] }>
  sensitive: boolean
}
export type BehaviorStudent = {
  id: string
  name: string
  grade: string
  classroom: string
  phone?: string
  stage: 'primary' | 'middle' | 'secondary' | 'unknown'
  violationCount?: number
  pendingCount?: number
  descriptiveOnly: boolean
}
export type BehaviorPreviewStudent = BehaviorStudent & {
  applicable: boolean
  recurrence: number
  exhausted: boolean
  procedureName: string
  actions: string[]
  deduction: number
  distinguishedScore: number
}
export type BehaviorActionStep = { id: string; sequence: number; label: string; state: 'required' | 'executed' | 'not_executed'; reason: string; evidence: string }
export type BehaviorRecord = {
  id: string
  studentId: string
  name: string
  grade: string
  classroom: string
  ruleCode: string
  ruleTitle: string
  category: BehaviorCategory
  degree: number | null
  recurrence: number
  procedureName: string
  actions?: string[]
  actionSteps?: BehaviorActionStep[]
  descriptiveOnly: boolean
  amount: number
  status: BehaviorStatus
  cancellationReason?: string
  date: string
  mode: 'in_person' | 'remote'
  stage: 'primary' | 'middle' | 'secondary' | 'unspecified'
  location?: string
  description?: string
  sensitive: boolean
  createdAt?: string
}
export type BehaviorOverview = {
  counts: { pending: number; violations: number; distinguished: number; students: number }
  recent: BehaviorRecord[]
}
export type BehaviorStudentProfile = {
  student: BehaviorStudent
  scores: { positiveScore: number; distinguishedScore: number; totalScore: number } | null
  records: Array<Pick<BehaviorRecord, 'id' | 'ruleTitle' | 'ruleCode' | 'category' | 'degree' | 'recurrence' | 'procedureName' | 'status' | 'date'>>
  movements: Array<{ id: string; type: 'deduction' | 'compensation' | 'distinguished' | 'reversal'; bucket: 'positive' | 'distinguished'; amount: number; reason: string; evidence: string; sourceMovementId: string | null; createdAt: string }>
}

export type SchoolBackupSnapshot = {
  createdAt: string
  schoolName: string
  schoolId: string
  totalRows: number
  students: number
  attendance: number
  teachers: number
  administrators: number
  lessonRecords: number
  sheets: number
  behavior: number
  referrals: number
  tableCounts: Record<string, number>
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

async function schoolBackupDownload(currentPassword: string, backupPassword: string) {
  const response = await fetch('/api/school-backup/export', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ currentPassword, backupPassword }),
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const error = new Error(data.error || 'request_failed') as Error & { code?: string }
    error.code = data.error || 'request_failed'
    throw error
  }
  return {
    blob: await response.blob(),
    filename: response.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/i)?.[1] || 'school-backup.7asrbackup',
  }
}

export const api = {
  me: () => request<{ user: Account }>('/me'),
  unifiedLogin: (identifier: string, password: string, choice?: Pick<LoginChoice, 'userId' | 'schoolId' | 'role'>) => request<{ user: Account }>('/auth/unified-login', { method: 'POST', body: JSON.stringify({ identifier, password, ...choice }) }),
  login: (email: string, password: string) => request<{ user: Account }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  teacherLogin: (identityNumber: string, password: string, schoolId = '') => request<{ user: Account }>('/auth/teacher-login', { method: 'POST', body: JSON.stringify({ identityNumber, password, schoolId: schoolId || undefined }) }),
  administratorLogin: (identityNumber: string, password: string, schoolId = '') => request<{ user: Account }>('/auth/administrator-login', { method: 'POST', body: JSON.stringify({ identityNumber, password, schoolId: schoolId || undefined }) }),
  studentLogin: (identityNumber: string, password: string, schoolId = '') => request<{ user: Account }>('/auth/student-login', { method: 'POST', body: JSON.stringify({ identityNumber, password, schoolId: schoolId || undefined }) }),
  counselorLogin: (identityNumber: string, password: string, schoolId = '') => request<{ user: Account }>('/auth/counselor-login', { method: 'POST', body: JSON.stringify({ identityNumber, password, schoolId: schoolId || undefined }) }),
  register: (displayName: string, schoolName: string, email: string, password: string, details: { generalEducationAdministration?: string; educationOffice?: string } = {}) => request<{ ok: boolean }>('/auth/register', { method: 'POST', body: JSON.stringify({ displayName, schoolName, email, password, ...details }) }),
  verifySchoolEmail: (token: string) => request<{ user: Account; school: { id: string; name: string } }>('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  changeSchoolPassword: (currentPassword: string, newPassword: string) => request<{ ok: boolean }>('/auth/school-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  reportSchoolBrand: () => request<{ school: ReportSchoolBrand }>('/report-header'),
  downloadSchoolBackup: schoolBackupDownload,
  previewSchoolBackup: (currentPassword: string, backupPassword: string, archive: string) => request<{ snapshot: SchoolBackupSnapshot }>('/school-backup/preview', { method: 'POST', body: JSON.stringify({ currentPassword, backupPassword, archive }) }),
  restoreSchoolBackup: (currentPassword: string, backupPassword: string, archive: string, confirmSchoolName: string) => request<{ ok: boolean; snapshot: SchoolBackupSnapshot; reloginRequired: boolean }>('/school-backup/restore', { method: 'POST', body: JSON.stringify({ currentPassword, backupPassword, archive, confirmSchoolName }) }),
  school: () => request<{ school: SchoolProfile }>('/school'),
  saveSchool: (school: SchoolProfile) => request<{ school: SchoolProfile }>('/school', { method: 'PUT', body: JSON.stringify(school) }),
  schoolStorageUsage: () => request<{ usage: SchoolStorageUsage }>('/school/storage-usage'),
  platformSchools: () => request<{ schools: PlatformSchoolUsage[] }>('/platform/schools'),
  platformMe: () => request<{ authenticated: true }>('/platform/me'),
  platformLogin: (username: string, password: string) => request<{ authenticated: true }>('/platform/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  platformLogout: () => request<{ ok: true }>('/platform/logout', { method: 'POST' }),
  deletePlatformSchool: (schoolId: string, confirmName: string) => request<{ ok: true }>(`/platform/schools/${encodeURIComponent(schoolId)}/delete`, { method: 'POST', body: JSON.stringify({ confirmName }) }),
  students: () => request<{ students: StudentRecord[] }>('/students'),
  saveStudents: (students: unknown[]) => request<{ ok: boolean }>('/students', { method: 'PUT', body: JSON.stringify({ students }) }),
  createStudent: (student: StudentInput) => request<{ ok: boolean; student: StudentRecord }>('/students', { method: 'POST', body: JSON.stringify(student) }),
  updateStudent: (studentId: string, student: StudentInput) => request<{ ok: boolean; student: StudentRecord }>(`/students/${encodeURIComponent(studentId)}`, { method: 'PATCH', body: JSON.stringify(student) }),
  studentAdminOverview: () => request<{ defaultPassword: string; students: StudentPortalAccount[] }>('/student-portal/admin/overview'),
  startStudentAccountGeneration: (studentIds: string[] = []) => request<StudentAccountGeneration>('/student-portal/admin/accounts/generate', { method: 'POST', body: JSON.stringify({ ...(studentIds.length ? { studentIds } : {}) }) }),
  studentAccountGenerationProgress: (jobId: string) => request<StudentAccountGeneration>(`/student-portal/admin/accounts/generate/progress?jobId=${encodeURIComponent(jobId)}`),
  resetStudentAccount: (studentId: string) => request<{ ok: boolean; temporaryPassword: string }>('/student-portal/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ studentId }) }),
  setStudentAccountStatus: (studentId: string, active: boolean) => request<{ ok: boolean }>('/student-portal/admin/accounts/status', { method: 'PATCH', body: JSON.stringify({ studentId, active }) }),
  setStudentAttendanceCooperationAccess: (studentId: string, attendanceCooperationAccess: boolean) => request<{ ok: boolean; attendanceCooperationAccess: boolean }>('/student-portal/admin/accounts/cooperation-access', { method: 'PATCH', body: JSON.stringify({ studentId, attendanceCooperationAccess }) }),
  schoolPortfolioGroups: () => request<{ groups: StudentPortfolioGroup[] }>('/student-portal/admin/portfolio/groups'),
  schoolPortfolioEntries: (assignmentId: string) => request<StudentPortfolioEntries>(`/student-portal/admin/portfolio/entries?assignmentId=${encodeURIComponent(assignmentId)}`),
  activityLeaderPortfolioGroups: () => request<{ groups: StudentPortfolioGroup[] }>('/student-portal/activity-leader/portfolio/groups'),
  activityLeaderPortfolioEntries: (assignmentId: string) => request<StudentPortfolioEntries>(`/student-portal/activity-leader/portfolio/entries?assignmentId=${encodeURIComponent(assignmentId)}`),
  teacherPortfolioGroups: () => request<{ groups: StudentPortfolioGroup[] }>('/student-portal/teacher/portfolio/groups'),
  teacherPortfolioEntries: (assignmentId: string) => request<StudentPortfolioEntries>(`/student-portal/teacher/portfolio/entries?assignmentId=${encodeURIComponent(assignmentId)}`),
  teacherPortfolioCorrectionSettings: () => request<TeacherPortfolioCorrectionSettings>('/student-portal/teacher/portfolio/correction-settings'),
  saveTeacherPortfolioCorrectionSettings: (settings: TeacherPortfolioCorrectionSettings) => request<TeacherPortfolioCorrectionSettings>('/student-portal/teacher/portfolio/correction-settings', { method: 'PUT', body: JSON.stringify({ ...settings, signatureData: settings.signatureIsDefault ? '' : settings.signatureData }) }),
  correctTeacherPortfolioFiles: (assignmentId: string, input: { note: string; studentId?: string; slotNumber?: number; assignmentIds?: string[] }) => request<{ corrections: StudentPortfolioCorrection[] }>('/student-portal/teacher/portfolio/corrections', { method: 'POST', body: JSON.stringify({ assignmentId, ...input }) }),
  cancelTeacherPortfolioCorrections: (assignmentId: string, input: { studentId?: string; slotNumber?: number; assignmentIds?: string[] }) => request<{ cleared: number }>('/student-portal/teacher/portfolio/corrections/cancel', { method: 'POST', body: JSON.stringify({ assignmentId, ...input }) }),
  studentPortalDashboard: () => request<StudentPortalDashboard>('/student-portal/student/dashboard'),
  studentCooperationStatus: () => request<StudentCooperationStatus>('/student-portal/student/cooperation/status'),
  scanStudentCooperation: (code: string) => request<StudentCooperationScan>('/student-portal/student/cooperation/scan', { method: 'POST', body: JSON.stringify({ code }) }),
  changeStudentPassword: (password: string) => request<{ ok: boolean }>('/student-portal/student/password', { method: 'POST', body: JSON.stringify({ password }) }),
  uploadStudentPortfolioFile: (assignmentId: string, slotNumber: number, file: string, fileName: string) => request<{ ok: boolean; file: StudentPortfolioSlot }>('/student-portal/student/portfolio/upload', { method: 'POST', body: JSON.stringify({ assignmentId, slotNumber, file, fileName }) }),
  deleteStudentPortfolioImage: (assignmentId: string, slotNumber: number) => request<{ ok: boolean }>('/student-portal/student/portfolio/delete', { method: 'POST', body: JSON.stringify({ assignmentId, slotNumber }) }),
  attendance: () => request<{ records: unknown[] }>('/attendance'),
  markAttendance: (studentId: string, status: 'present' | 'late') => request<{ ok: boolean; duplicate?: boolean }>('/attendance', { method: 'POST', body: JSON.stringify({ studentId, status }) }),
  updateAttendanceStatus: (studentId: string, status: 'present' | 'late') => request<{ ok: boolean; studentId: string; status: 'present' | 'late'; time: string }>('/attendance', { method: 'PATCH', body: JSON.stringify({ studentId, status }) }),
  markAttendanceBulk: (studentIds: string[], status: 'present' | 'late') => request<{ ok: boolean; created: string[]; duplicates: string[]; missing: string[] }>('/attendance/bulk', { method: 'POST', body: JSON.stringify({ studentIds, status }) }),
  almadar: () => request<{ account: AlmadarAccount }>('/almadar'),
  saveAlmadar: (settings: { username: string; password: string; apiKey: string; senderName: string }) => request<{ ok: boolean }>('/almadar', { method: 'PUT', body: JSON.stringify(settings) }),
  verifyAlmadar: () => request<{ ok: boolean; balance: string | number | null }>('/almadar/verify', { method: 'POST' }),
  testAlmadar: (phone: string) => request<{ ok: boolean; recipientSuffix: string }>('/almadar/test-send', { method: 'POST', body: JSON.stringify({ phone }) }),
  excuses: () => request<{ excuses: Excuse[] }>('/excuses'),
  addExcuse: (excuse: { studentId: string; category: string; note: string; startDate: string; endDate: string }) => request<{ ok: boolean; id: string }>('/excuses', { method: 'POST', body: JSON.stringify(excuse) }),
  deleteExcuse: (id: string) => request<{ ok: boolean }>(`/excuses?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  absenceReport: (from: string, to: string, studentId = '') => request<AbsenceReport>(`/reports/absences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${studentId ? `&studentId=${encodeURIComponent(studentId)}` : ''}`),
  calculateAbsences: (date: string, studentIds: string[] = []) => request<{ ok: boolean; date: string; created: number; confirmed: number }>('/absences/calculate', { method: 'POST', body: JSON.stringify({ date, ...(studentIds.length ? { studentIds } : {}) }) }),
  cancelAbsences: (date: string) => request<{ ok: boolean; date: string; deleted: number }>('/absences/cancel', { method: 'POST', body: JSON.stringify({ date }) }),
  absenceDetails: (studentId: string, from: string, to: string) => request<AbsenceDetails>(`/absences/details?studentId=${encodeURIComponent(studentId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  setAbsenceStatus: (payload: { studentIds: string[]; from: string; to: string; status: AbsenceStatus; note?: string }) => request<{ ok: boolean; updatedDays: number; affectedStudents: number }>('/absences/status/bulk', { method: 'PATCH', body: JSON.stringify(payload) }),
  correctAbsences: (payload: { studentIds: string[]; from: string; to: string; time: string; dates?: string[]; status?: 'present' | 'late' }) => request<{ ok: boolean; correctedDays: number; affectedStudents: number }>('/absences/correct-present/bulk', { method: 'POST', body: JSON.stringify({ ...payload, attendanceStatus: payload.status || 'present' }) }),
  missingAttendance: (date: string) => request<{ date: string; count: number }>(`/reports/missing-attendance?date=${encodeURIComponent(date)}`),
  pendingAbsences: (date: string) => request<{ date: string; rows: PendingAbsenceStudent[] }>(`/reports/pending-absences?date=${encodeURIComponent(date)}`),
  dailyAbsences: (date: string) => request<{ date: string; rows: DailyStudentRow[] }>(`/reports/daily-absences?date=${encodeURIComponent(date)}`),
  absenceLog: (date: string) => request<{ date: string; rows: DailyStudentRow[] }>(`/reports/absence-log?date=${encodeURIComponent(date)}`),
  recordAttendanceFromAbsenceLog: (payload: { date: string; studentIds: string[]; status: 'present' | 'late'; time?: string }) => request<{ ok: boolean; date: string; status: 'present' | 'late'; time: string; updated: number }>('/reports/absence-log/attendance', { method: 'POST', body: JSON.stringify(payload) }),
  dailyLates: (date: string) => request<{ date: string; rows: DailyStudentRow[] }>(`/reports/daily-lates?date=${encodeURIComponent(date)}`),
  setDailyLateStatus: (payload: { date: string; studentIds: string[]; status: 'unexcused' | 'excused' }) => request<{ ok: boolean; updated: number }>('/reports/daily-lates/status', { method: 'PATCH', body: JSON.stringify(payload) }),
  markDailyLatesPresent: (payload: { date: string; studentIds: string[] }) => request<{ ok: boolean; date: string; updated: number }>('/reports/daily-lates/attendance', { method: 'PATCH', body: JSON.stringify(payload) }),
  absenceSummary: (studentIds: string[] = []) => request<{ type: 'absence'; rows: CountStudentRow[] }>(`/reports/absence-summary${studentIds.length ? `?studentIds=${encodeURIComponent(studentIds.join(','))}` : ''}`),
  lateSummary: (studentIds: string[] = []) => request<{ type: 'late'; rows: CountStudentRow[] }>(`/reports/late-summary${studentIds.length ? `?studentIds=${encodeURIComponent(studentIds.join(','))}` : ''}`),
  studentHistory: (type: 'absence' | 'late', studentId: string) => request<StudentHistory>(`/reports/student-history?type=${type}&studentId=${encodeURIComponent(studentId)}`),
  detailedStudentReport: (studentId: string, from: string, to: string) => request<DetailedStudentReport>(`/reports/student-detail?studentId=${encodeURIComponent(studentId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  messages: (type?: MessageLog['type'], limit = 5000) => request<{ messages: MessageLog[] }>(`/messages?${type ? `type=${encodeURIComponent(type)}&` : ''}limit=${limit}`),
  messageRecipientScope: (type: 'late' | 'absence' | 'general' | 'teacher') => request<{ studentIds: string[] }>(`/messages/recipients?type=${encodeURIComponent(type)}`),
  messageTeachers: () => request<{ teachers: MessageTeacher[] }>('/messages/teachers'),
  sendMessages: (payload: { studentIds?: string[]; teacherIds?: string[]; type: 'late' | 'absence' | 'general' | 'teacher'; message?: string }) => request<{ ok: boolean; sent: number; failed: number }>('/messages/send', { method: 'POST', body: JSON.stringify(payload) }),
  lessonOverview: () => request<LessonFlowOverview>('/lesson-flow/overview'),
  teacherDayAbsences: (date = '') => request<{ date: string; teachers: TeacherDayAbsence[] }>(`/lesson-flow/teacher-day-absences${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  addTeacherDayAbsences: (teacherIds: string[], date = '') => request<{ date: string; added: number; teachers: TeacherDayAbsence[] }>('/lesson-flow/teacher-day-absences', { method: 'POST', body: JSON.stringify({ teacherIds, date }) }),
  removeTeacherDayAbsence: (teacherId: string, date = '') => request<{ ok: boolean; removed: number }>(`/lesson-flow/teacher-day-absences?teacherId=${encodeURIComponent(teacherId)}${date ? `&date=${encodeURIComponent(date)}` : ''}`, { method: 'DELETE' }),
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
  lessonIncidentReport: () => request<{ incidents: LessonIncidentReportRow[] }>('/lesson-flow/incidents/report'),
  setLessonIncidentResponse: (id: string, status: LessonIncidentReportRow['schoolResponseStatus']) =>
    request<{ ok: boolean }>(`/lesson-flow/incidents/${encodeURIComponent(id)}/school-response`, { method: 'PUT', body: JSON.stringify({ status }) }),
  confirmLessonIncident: (id: string) => request<{ ok: boolean }>(`/lesson-flow/incidents/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify({}) }),
  cancelLessonIncident: (id: string, note = '') => request<{ ok: boolean }>(`/lesson-flow/incidents/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({ note }) }),
  deleteLessonIncident: (id: string) => request<{ ok: boolean }>(`/lesson-flow/incidents/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  teacherDashboard: (date: string) => request<TeacherPortalDashboard>(`/teacher-portal/teacher/dashboard?date=${encodeURIComponent(date)}`),
  teacherEvidence: () => request<TeacherEvidenceOverview>('/teacher-portal/teacher/evidence'),
  saveTeacherEvidence: (payload: { slotNumber: number; activityId?: string; grade: string; classroom: string; title: string; strategy: string; visitTeacherId: string; vicePrincipalId: string; activityLeaderName: string; notes: string; images: Array<{ slotNumber: number; image: string }>; deleteSlots: number[] }) => request<{ ok: boolean; record: TeacherEvidenceRecord }>('/teacher-portal/teacher/evidence', { method: 'POST', body: JSON.stringify(payload) }),
  teacherLesson: (classroomId: string, date: string, periodNumber: number, sheetType: TeacherSheetOpenType, assessmentPeriod: TeacherAssessmentPeriod = 'period1') => request<TeacherLesson>(`/teacher-portal/teacher/lesson?classroomId=${encodeURIComponent(classroomId)}&date=${encodeURIComponent(date)}&periodNumber=${periodNumber}&sheetType=${sheetType}&assessmentPeriod=${assessmentPeriod}`),
  saveTeacherLesson: (payload: { classroomId: string; date: string; periodNumber: number; sheetType: TeacherSheetOpenType; assessmentPeriod: TeacherAssessmentPeriod; students: Array<{ studentId: string; status: 'present' | 'absent' | 'late' | 'excused'; note: TeacherNote | ''; sheetValues: Record<string, string | number | boolean> }> }) => request<{ ok: boolean; saved: number }>('/teacher-portal/teacher/lesson', { method: 'PUT', body: JSON.stringify(payload) }),
  teacherReports: (filters: { date?: string; from?: string; to?: string; studentId?: string; note?: string } = {}) => request<{ reports: TeacherLessonReport[] }>(`/teacher-portal/teacher/reports?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
  teacherComprehensiveReportOptions: () => request<{ options: TeacherComprehensiveReportOption[] }>('/teacher-portal/teacher/comprehensive-report/options'),
  teacherComprehensiveReport: (type: TeacherComprehensiveReportType, subject: string, classroomId: string) => request<TeacherComprehensiveReport>(`/teacher-portal/teacher/comprehensive-report?${new URLSearchParams({ type, subject, classroomId })}`),
  schoolComprehensiveReportOptions: () => request<SchoolComprehensiveReportOptions>('/teacher-portal/school/comprehensive-report/options'),
  schoolComprehensiveReport: (type: SchoolComprehensiveReportType, grade: string, classroom: string) => request<SchoolComprehensiveReport>(`/teacher-portal/school/comprehensive-report?${new URLSearchParams({ type, grade, classroom })}`),
  changeTeacherPassword: (password: string) => request<{ ok: boolean }>('/teacher-portal/teacher/password', { method: 'POST', body: JSON.stringify({ password }) }),
  teacherSheets: () => request<{ sheets: TeacherSheetSubject[] }>('/teacher-portal/teacher/sheets'),
  scanNoorSheet: (subjectName: string, image: string) => request<NoorSheetScan>('/teacher-portal/teacher/noor-sheet/scan', { method: 'POST', body: JSON.stringify({ subjectName, image }) }),
  saveNoorSheetMappings: (subjectName: string, mappings: NoorSheetMapping[], assessmentPeriod: TeacherAssessmentPeriod = 'period1') => request<{ config: TeacherSheetConfig }>('/teacher-portal/teacher/noor-sheet/mappings', { method: 'PUT', body: JSON.stringify({ subjectName, mappings, assessmentPeriod }) }),
  saveTeacherSheetConfig: (subjectName: string, sheetType: TeacherSheetType, columns: TeacherSheetColumn[], assessmentPeriod: TeacherAssessmentPeriod = 'period1') => request<{ config: TeacherSheetConfig }>('/teacher-portal/teacher/sheets/config', { method: 'PUT', body: JSON.stringify({ subjectName, sheetType, columns, assessmentPeriod }) }),
  deleteTeacherSheetConfig: (subjectName: string, sheetType: TeacherSheetType, assessmentPeriod: TeacherAssessmentPeriod = 'period1') => request<{ ok: boolean }>(`/teacher-portal/teacher/sheets/config?subjectName=${encodeURIComponent(subjectName)}&sheetType=${sheetType}&assessmentPeriod=${assessmentPeriod}`, { method: 'DELETE' }),
  teacherSheetReport: (subjectName: string, classroomId: string, sheetType: TeacherSheetOpenType, assessmentPeriod: TeacherAssessmentPeriod = 'period1') => request<TeacherSheetReport>(`/teacher-portal/teacher/sheet-report?subjectName=${encodeURIComponent(subjectName)}&classroomId=${encodeURIComponent(classroomId)}&sheetType=${sheetType}&assessmentPeriod=${assessmentPeriod}`),
  teacherAdminOverview: () => request<TeacherAdminOverview>('/teacher-portal/admin/overview'),
  teacherAdminEvidence: () => request<{ teachers: TeacherEvidenceAdminTeacher[] }>('/teacher-portal/admin/evidence'),
  teacherAdminEvidenceRecords: (teacherId: string) => request<TeacherEvidenceAdminRecords>(`/teacher-portal/admin/evidence/records?teacherId=${encodeURIComponent(teacherId)}`),
  teacherAdminCredentials: () => request<{ credentials: Array<{ teacherId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/teacher-portal/admin/credentials'),
  teacherMappingOptions: () => request<{ options: Array<{ grade: string; classroom: string; count: number }> }>('/teacher-portal/admin/mapping-options'),
  saveTeacherClassroomMapping: (payload: { classroomId: string; grade: string; classroom: string }) => request<{ ok: boolean }>('/teacher-portal/admin/classroom-mapping', { method: 'PUT', body: JSON.stringify(payload) }),
  generateTeacherAccounts: (teacherIds: string[]) => request<{ ok: boolean; created: number; credentials: Array<{ teacherId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/teacher-portal/admin/accounts/generate', { method: 'POST', body: JSON.stringify({ teacherIds }) }),
  resetTeacherAccount: (teacherId: string) => request<{ ok: boolean; temporaryPassword: string }>('/teacher-portal/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ teacherId }) }),
  resetTeacherAccounts: (teacherIds: string[]) => request<{ ok: boolean; reset: number; credentials: Array<{ teacherId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/teacher-portal/admin/accounts/bulk-reset', { method: 'POST', body: JSON.stringify({ teacherIds }) }),
  setTeacherAccountStatus: (teacherId: string, active: boolean) => request<{ ok: boolean }>('/teacher-portal/admin/accounts/status', { method: 'PATCH', body: JSON.stringify({ teacherId, active }) }),
  administratorAdminOverview: () => request<{ staff: AdministrativeStaff[] }>('/administrator-portal/admin/overview'),
  importAdministrators: (staff: Array<{ name: string; identityNumber: string; phone: string }>) => request<{ ok: boolean; added: number; skipped: number; conflicts: number; invalid: number }>('/administrator-portal/admin/import', { method: 'POST', body: JSON.stringify({ staff }) }),
  administratorCredentials: () => request<{ credentials: Array<{ administratorId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/administrator-portal/admin/credentials'),
  generateAdministratorAccounts: (administratorIds: string[]) => request<{ ok: boolean; created: number; credentials: Array<{ administratorId: string; name: string; identityNumber: string; temporaryPassword: string }> }>('/administrator-portal/admin/accounts/generate', { method: 'POST', body: JSON.stringify({ administratorIds }) }),
  resetAdministratorAccount: (administratorId: string) => request<{ ok: boolean; temporaryPassword: string }>('/administrator-portal/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ administratorId }) }),
  setAdministratorAccountStatus: (administratorId: string, active: boolean) => request<{ ok: boolean }>('/administrator-portal/admin/accounts/status', { method: 'PATCH', body: JSON.stringify({ administratorId, active }) }),
  setAdministratorLessonFlowAccess: (administratorId: string, lessonFlowAccess: boolean) => request<{ ok: boolean; lessonFlowAccess: boolean }>('/administrator-portal/admin/accounts/lesson-flow-access', { method: 'PATCH', body: JSON.stringify({ administratorId, lessonFlowAccess }) }),
  counselorAdminOverview: () => request<{ defaultPassword: string; grades: CounselorGradeOption[]; counselors: StudentCounselor[] }>('/counselor-portal/admin/overview'),
  createStudentCounselor: (payload: { name: string; identityNumber: string; phone: string; grades: string[] }) => request<{ ok: boolean; counselor: StudentCounselor }>('/counselor-portal/admin/counselors', { method: 'POST', body: JSON.stringify(payload) }),
  setCounselorGrades: (counselorId: string, grades: string[]) => request<{ ok: boolean; assignedGrades: string[] }>('/counselor-portal/admin/counselors/grades', { method: 'PUT', body: JSON.stringify({ counselorId, grades }) }),
  activateCounselorAccount: (counselorId: string) => request<{ ok: boolean; temporaryPassword: string }>('/counselor-portal/admin/accounts/activate', { method: 'POST', body: JSON.stringify({ counselorId }) }),
  resetCounselorAccount: (counselorId: string) => request<{ ok: boolean; temporaryPassword: string }>('/counselor-portal/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ counselorId }) }),
  setCounselorAccountStatus: (counselorId: string, active: boolean) => request<{ ok: boolean }>('/counselor-portal/admin/accounts/status', { method: 'PATCH', body: JSON.stringify({ counselorId, active }) }),
  counselorPortalDashboard: () => request<CounselorPortalDashboard>('/counselor-portal/counselor/dashboard'),
  changeCounselorPassword: (password: string) => request<{ ok: boolean }>('/counselor-portal/counselor/password', { method: 'POST', body: JSON.stringify({ password }) }),
  vicePrincipalAdminOverview: () => request<{ defaultPassword: string; grades: VicePrincipalGradeOption[]; vicePrincipals: SchoolVicePrincipal[] }>('/vice-principals/admin/overview'),
  createVicePrincipal: (payload: { name: string; identityNumber: string; phone: string; grade: string }) => request<{ ok: boolean; vicePrincipal: SchoolVicePrincipal }>('/vice-principals/admin', { method: 'POST', body: JSON.stringify(payload) }),
  setVicePrincipalGrade: (vicePrincipalId: string, grade: string) => request<{ ok: boolean; grade: string }>('/vice-principals/admin/grade', { method: 'PUT', body: JSON.stringify({ vicePrincipalId, grade }) }),
  activateVicePrincipalAccount: (vicePrincipalId: string) => request<{ ok: boolean; temporaryPassword: string }>('/vice-principals/admin/accounts/activate', { method: 'POST', body: JSON.stringify({ vicePrincipalId }) }),
  resetVicePrincipalAccount: (vicePrincipalId: string) => request<{ ok: boolean; temporaryPassword: string }>('/vice-principals/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ vicePrincipalId }) }),
  setVicePrincipalAccountStatus: (vicePrincipalId: string, active: boolean) => request<{ ok: boolean }>('/vice-principals/admin/accounts/status', { method: 'PATCH', body: JSON.stringify({ vicePrincipalId, active }) }),
  viceApprovedAbsenceProcedureQueue: (date: string) => request<{ date: string; grade: string; rows: Array<{ studentId: string; name: string; grade: string; classroom: string; phone: string; status: 'unexcused' | 'excused' | 'special'; absenceDays: number; unexcusedDays: number; excusedDays: number; specialDays: number; contactOutcome: '' | 'contacted' | 'no_answer'; contactMethod: '' | 'phone' | 'sms' | 'whatsapp' | 'visit' | 'other'; contactNote: string; contactedByName: string; contactedAt: string | null; referredCounselorName: string; referralNote: string; referredAt: string | null; counselorAction: string; counselorPlan: string; counselorName: string; counselorActedAt: string | null; caseState: string; viceDecisionNote: string; viceDecidedByName: string; viceDecidedAt: string | null }>; summary: { students: number; unexcused: number; excused: number; special: number } }>(`/absence-procedures/vice/approved?date=${encodeURIComponent(date)}`),
  recordViceAbsenceContact: (payload: { studentId: string; date: string; outcome: 'contacted' | 'no_answer'; method: 'phone' | 'sms' | 'whatsapp' | 'visit' | 'other'; note: string }) => request<{ ok: boolean; contact: { contactOutcome: 'contacted' | 'no_answer'; contactMethod: 'phone' | 'sms' | 'whatsapp' | 'visit' | 'other'; contactNote: string; contactedByName: string; contactedAt: string } }>('/absence-procedures/vice/contact', { method: 'POST', body: JSON.stringify(payload) }),
  referViceAbsenceToCounselor: (payload: { studentId: string; date: string; note: string }) => request<{ ok: boolean; referral: { referredCounselorName: string; referralNote: string; referredAt: string } }>('/absence-procedures/vice/refer', { method: 'POST', body: JSON.stringify(payload) }),
  counselorAbsenceReferralQueue: () => request<{ rows: Array<{ studentId: string; name: string; grade: string; classroom: string; phone: string; absenceDate: string; absenceDays: number; status: 'unexcused' | 'excused' | 'special'; contactOutcome: 'contacted' | 'no_answer'; contactMethod: 'phone' | 'sms' | 'whatsapp' | 'visit' | 'other'; contactNote: string; contactedByName: string; contactedAt: string | null; referralNote: string; referredByName: string; referredAt: string; counselorAction: string; counselorPlan: string; counselorName: string; counselorActedAt: string | null; caseState: string; viceDecisionNote: string }> }>('/absence-procedures/counselor/referred'),
  recordCounselorAbsenceAction: (payload: { studentId: string; date: string; action: string; plan: string }) => request<{ ok: boolean; action: { counselorAction: string; counselorPlan: string; counselorName: string; counselorActedAt: string } }>('/absence-procedures/counselor/action', { method: 'POST', body: JSON.stringify(payload) }),
  decideViceAbsenceCase: (payload: { studentId: string; date: string; decision: 'closed' | 'needs_followup'; note: string }) => request<{ ok: boolean; decision: { caseState: string; viceDecisionNote: string; viceDecidedByName: string; viceDecidedAt: string } }>('/absence-procedures/vice/decision', { method: 'POST', body: JSON.stringify(payload) }),
  viceAbsenceMessages: () => request<{ rows: Array<{ id: string; studentId: string; studentName: string; absenceDays: number; recipient: string; senderName: string; messageBody: string; status: 'sent' | 'failed'; errorDetail: string; createdAt: string }> }>('/absence-procedures/vice/messages'),
  sendViceAbsenceMessage: (payload: { studentId: string; date: string }) => request<{ ok: boolean; message: { studentId: string; studentName: string; absenceDays: number; messageBody: string; status: 'sent' | 'failed' } }>('/absence-procedures/vice/message', { method: 'POST', body: JSON.stringify(payload) }),
  schoolAbsenceProcedureOverview: () => request<{ rows: Array<{ studentId: string; name: string; grade: string; classroom: string; absenceDate: string; absenceDays: number; status: string; caseState: string; contactOutcome: string; referredCounselorName: string; counselorName: string; viceDecidedByName: string; viceDecisionNote: string; counselorActedAt: string | null; updatedAt: string }> }>('/absence-procedures/school/overview'),
  activityLeaderAdminOverview: () => request<{ defaultPassword: string; leaders: SchoolActivityLeader[] }>('/activity-leaders/admin/overview'),
  createActivityLeader: (payload: { name: string; identityNumber: string; phone: string }) => request<{ ok: boolean; leader: SchoolActivityLeader }>('/activity-leaders/admin/leaders', { method: 'POST', body: JSON.stringify(payload) }),
  activateActivityLeaderAccount: (activityLeaderId: string) => request<{ ok: boolean; temporaryPassword: string }>('/activity-leaders/admin/accounts/activate', { method: 'POST', body: JSON.stringify({ activityLeaderId }) }),
  resetActivityLeaderAccount: (activityLeaderId: string) => request<{ ok: boolean; temporaryPassword: string }>('/activity-leaders/admin/accounts/reset', { method: 'POST', body: JSON.stringify({ activityLeaderId }) }),
  setActivityLeaderAccountStatus: (activityLeaderId: string, active: boolean) => request<{ ok: boolean }>('/activity-leaders/admin/accounts/status', { method: 'PATCH', body: JSON.stringify({ activityLeaderId, active }) }),
  changeActivityLeaderPassword: (password: string) => request<{ ok: boolean }>('/activity-leaders/leader/password', { method: 'POST', body: JSON.stringify({ password }) }),
  activityLeaderProfile: () => request<{ schoolName: string }>('/activity-leaders/leader/profile'),
  activityLeaderEvidence: () => request<{ teachers: TeacherEvidenceAdminTeacher[] }>('/activity-leaders/leader/evidence'),
  activityLeaderEvidenceRecords: (teacherId: string) => request<TeacherEvidenceAdminRecords>(`/activity-leaders/leader/evidence/records?teacherId=${encodeURIComponent(teacherId)}`),
  activityLeaderActivities: () => request<ActivityLeaderActivities>('/activity-leaders/leader/activities'),
  saveActivityLeaderActivity: (payload: { slotNumber: number; title: string; description: string; attachment?: string; attachmentName?: string; teacherIds: string[] }) => request<{ ok: boolean; activityId: string }>('/activity-leaders/leader/activities', { method: 'POST', body: JSON.stringify(payload) }),
  activityLeaderActivityReport: (activityId: string) => request<ActivityLeaderActivityReport>(`/activity-leaders/leader/activities/report?activityId=${encodeURIComponent(activityId)}`),
  administratorAttendance: (date = '') => request<{ date: string; schoolName: string; principalName: string; generalEducationAdministration: string; educationOffice: string; lessonFlowAccess: boolean; students: AdministratorAttendanceStudent[]; records: AdministratorAttendanceRecord[] }>(`/administrator-portal/attendance${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  recordAdministratorAttendance: (studentId: string, status: 'present' | 'late') => request<{ ok: boolean; duplicate: boolean; date: string; status: 'present' | 'late'; student: AdministratorAttendanceStudent; time: string }>('/administrator-portal/attendance', { method: 'POST', body: JSON.stringify({ studentId, status }) }),
  recordAdministratorAttendanceBulk: (studentIds: string[], status: 'present' | 'late') => request<{ ok: boolean; date: string; status: 'present' | 'late'; created: Array<{ student: AdministratorAttendanceStudent; status: 'present' | 'late'; time: string }>; duplicates: AdministratorAttendanceStudent[]; missing: string[] }>('/administrator-portal/attendance/bulk', { method: 'POST', body: JSON.stringify({ studentIds, status }) }),
  administratorReport: (date = '') => request<{ date: string; records: AdministratorAttendanceRecord[] }>(`/administrator-portal/reports${date ? `?date=${encodeURIComponent(date)}` : ''}`),
  changeAdministratorPassword: (currentPassword: string, newPassword: string) => request<{ ok: boolean }>('/administrator-portal/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  teacherAdminReports: (filters: { date?: string; teacherId?: string; note?: string; classroomId?: string } = {}) => request<{ reports: TeacherLessonReport[] }>(`/teacher-portal/admin/reports?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
  teacherCooperationStatus: () => request<TeacherCooperationStatus>('/teacher-cooperation/status'),
  searchTeacherCooperationStudents: (query: string) => request<{ students: TeacherCooperationStudent[] }>(`/teacher-cooperation/students?q=${encodeURIComponent(query)}`),
  scanTeacherCooperation: (code: string) => request<{ outcome: 'created' | 'duplicate'; student: { id: string; name: string; grade: string; classroom: string }; attendance: { status: 'present' | 'late'; time: string }; periodNumber: 1 | 2 }>('/teacher-cooperation/scan', { method: 'POST', body: JSON.stringify({ code }) }),
  scanTeacherCooperationBulk: (studentIds: string[]) => request<{ created: Array<{ student: TeacherCooperationStudent; attendance: { status: 'present' | 'late'; time: string } }>; duplicates: TeacherCooperationStudent[]; missing: string[]; periodNumber: 1 | 2 }>('/teacher-cooperation/scan/bulk', { method: 'POST', body: JSON.stringify({ studentIds }) }),
  teacherCooperationReport: (filters: { from?: string; to?: string; teacherId?: string; periodNumber?: string } = {}) => request<{ schoolName: string; principalName: string; entries: TeacherCooperationEntry[]; teachers: Array<{ teacherId: string; name: string }> }>(`/teacher-cooperation/report?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
  studentReferrals: (filters: { status?: StudentReferralStatus | ''; teacherId?: string; from?: string; to?: string; q?: string } = {}) =>
    request<{ schoolName: string; referrals: StudentReferral[] }>(`/student-referrals?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
  createStudentReferral: (payload: { assignmentId: string; classroomId: string; studentId: string; date: string; periodNumber: number; reason: StudentReferralReason; otherReason?: string; problemDescription: string }) =>
    request<{ ok: boolean; id: string }>('/student-referrals', { method: 'POST', body: JSON.stringify(payload) }),
  cancelStudentReferral: (id: string) => request<{ ok: boolean }>(`/student-referrals/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }),
  markStudentReferralViewed: (id: string) => request<{ ok: boolean; changed: boolean }>(`/student-referrals/${encodeURIComponent(id)}/viewed`, { method: 'POST', body: '{}' }),
  updateStudentReferral: (id: string, payload: { status: Exclude<StudentReferralStatus, 'submitted' | 'viewed' | 'cancelled'>; referredToCounselor: boolean; viceAction: string; vicePrincipalName: string; eventNote?: string }) =>
    request<{ ok: boolean }>(`/student-referrals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  completeCounselorStudentReferral: (id: string, counselorAction: string) =>
    request<{ ok: boolean }>(`/student-referrals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ counselorAction }) }),
  behaviorOverview: () => request<BehaviorOverview>('/behavior/overview'),
  behaviorCatalog: (filters: { category?: BehaviorCategory; mode?: 'in_person' | 'remote'; stage?: 'primary' | 'middle' | 'secondary'; q?: string } = {}) =>
    request<{ version: string; rules: BehaviorRule[] }>(`/behavior/catalog?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
  behaviorStudents: (q = '') => request<{ students: BehaviorStudent[] }>(`/behavior/students${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  behaviorPreview: (payload: { ruleCode: string; studentIds: string[]; mode: 'in_person' | 'remote'; stage: 'primary' | 'middle' | 'secondary' }) =>
    request<{ rule: BehaviorRule; students: BehaviorPreviewStudent[] }>('/behavior/preview', { method: 'POST', body: JSON.stringify(payload) }),
  createBehaviorIncident: (payload: { date: string; mode: 'in_person' | 'remote'; stage: 'primary' | 'middle' | 'secondary'; ruleCode: string; studentIds: string[]; location?: string; description?: string }) =>
    request<{ incidentId: string; records: string[] }>('/behavior/incidents', { method: 'POST', body: JSON.stringify(payload) }),
  behaviorRecords: (filters: { status?: BehaviorStatus; category?: BehaviorCategory; studentId?: string; from?: string; to?: string } = {}) =>
    request<{ records: BehaviorRecord[] }>(`/behavior/records?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, value || '']))}`),
  approveBehaviorRecord: (recordId: string) => request<{ ok: boolean; recurrence: number; amount: number }>(`/behavior/records/${encodeURIComponent(recordId)}/approve`, { method: 'POST', body: '{}' }),
  cancelBehaviorRecord: (recordId: string, reason: string) => request<{ ok: boolean }>(`/behavior/records/${encodeURIComponent(recordId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  deleteBehaviorRecord: (recordId: string) => request<{ ok: boolean; deletedIncident: boolean }>('/behavior/records/' + encodeURIComponent(recordId) + '/permanent', { method: 'DELETE' }),
  updateBehaviorAction: (recordId: string, actionId: string, payload: { state: BehaviorActionStep['state']; reason?: string; evidence?: string }) =>
    request<{ ok: boolean }>(`/behavior/records/${encodeURIComponent(recordId)}/actions/${encodeURIComponent(actionId)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  behaviorStudentProfile: (studentId: string) => request<BehaviorStudentProfile>(`/behavior/students/${encodeURIComponent(studentId)}`),
  createBehaviorCompensation: (payload: { sourceMovementId: string; amount: number; evidence: string; reason?: string }) =>
    request<{ ok: boolean; amount: number; remaining: number }>('/behavior/compensations', { method: 'POST', body: JSON.stringify(payload) }),
}
