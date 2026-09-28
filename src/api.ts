export type Account = { email: string; displayName: string; role: 'admin' | 'staff'; schoolId: string }
export type SchoolPreferences = { attendanceMode: 'auto' | 'present' | 'late'; cutoffTime: string; gradeAliases: Record<string, string> }
export type SchoolProfile = { schoolName: string; principalName: string; academicYear: string; semester: string; preferences: SchoolPreferences }

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
  clearAttendance: (date: string) => request<{ ok: boolean }>(`/attendance?date=${encodeURIComponent(date)}`, { method: 'DELETE' }),
}
