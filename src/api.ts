export type Account = { email: string; displayName: string; role: 'admin' | 'staff'; schoolId: string }
export type SchoolPreferences = { attendanceMode: 'auto' | 'present' | 'late'; cutoffTime: string; gradeAliases: Record<string, string> }
export type SchoolProfile = { schoolName: string; principalName: string; academicYear: string; semester: string; preferences: SchoolPreferences }
export type AlmadarAccount = { configured: boolean; senderName?: string; lastBalance?: string | null; verifiedAt?: string | null; updatedAt?: string | null }
export type Excuse = { id: string; studentId: string; name: string; grade: string; classroom: string; category: string; note: string; startDate: string; endDate: string | null; createdAt: string }
export type AbsenceRow = { id: string; name: string; phone: string; grade: string; classroom: string; absenceDays: number; hasExcuse: boolean; excuses: Array<{ category: string; note: string; startDate: string; endDate: string | null }> }
export type AbsenceReport = { from: string; to: string; workingDays: number; rows: AbsenceRow[] }
export type MessageLog = { id: string; studentId: string | null; studentName: string; recipient: string; senderName: string; type: 'late' | 'absence' | 'general'; body: string; status: 'sent' | 'failed'; errorDetail: string; createdAt: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || 'request_failed')
  return data as T
}

export const api = {
  me: () => request<{ user: Account }>('/me'),
  login: (email: string, password: string) => request<{ user: Account }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (displayName: string, schoolName: string, email: string, password: string) => request<{ user: Account }>('/auth/register', { method: 'POST', body: JSON.stringify({ displayName, schoolName, email, password }) }),
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
  excuses: () => request<{ excuses: Excuse[] }>('/excuses'),
  addExcuse: (excuse: { studentId: string; category: string; note: string; startDate: string; endDate: string }) => request<{ ok: boolean; id: string }>('/excuses', { method: 'POST', body: JSON.stringify(excuse) }),
  deleteExcuse: (id: string) => request<{ ok: boolean }>(`/excuses?id=${encodeURIComponent(id)}`, { method: 'DELETE' }),
  absenceReport: (from: string, to: string, studentId = '') => request<AbsenceReport>(`/reports/absences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${studentId ? `&studentId=${encodeURIComponent(studentId)}` : ''}`),
  messages: () => request<{ messages: MessageLog[] }>('/messages'),
  sendMessages: (payload: { studentIds: string[]; type: 'late' | 'absence' | 'general'; message?: string }) => request<{ ok: boolean; sent: number; failed: number }>('/messages/send', { method: 'POST', body: JSON.stringify(payload) }),
}
