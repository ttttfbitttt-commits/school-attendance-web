CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 160),
  principal_name text NOT NULL DEFAULT '',
  academic_year text NOT NULL DEFAULT '',
  semester text NOT NULL DEFAULT '',
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext UNIQUE NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'staff')),
  PRIMARY KEY (school_id, user_id)
);

CREATE TABLE students (
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  phone text NOT NULL DEFAULT '',
  grade text NOT NULL DEFAULT '',
  classroom text NOT NULL DEFAULT '',
  sheet text NOT NULL DEFAULT '',
  row_number integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (school_id, id)
);

CREATE TABLE attendance_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  attendance_date date NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by uuid NOT NULL REFERENCES users(id),
  status text NOT NULL CHECK (status IN ('present', 'late')),
  UNIQUE (school_id, student_id, attendance_date),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX attendance_logs_school_day ON attendance_logs(school_id, attendance_date DESC);

CREATE TABLE almadar_accounts (
  school_id uuid PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  username_encrypted text NOT NULL,
  password_encrypted text NOT NULL,
  api_key_encrypted text NOT NULL,
  sender_name text NOT NULL,
  last_balance text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE student_excuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id text NOT NULL,
  category text NOT NULL DEFAULT 'عذر',
  note text NOT NULL DEFAULT '',
  start_date date NOT NULL,
  end_date date,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),
  FOREIGN KEY (school_id, student_id) REFERENCES students(school_id, id) ON DELETE RESTRICT
);

CREATE TABLE message_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  student_id text,
  student_name text NOT NULL DEFAULT '',
  recipient text NOT NULL,
  sender_name text NOT NULL,
  message_type text NOT NULL CHECK (message_type IN ('late', 'absence', 'general')),
  message_body text NOT NULL,
  status text NOT NULL CHECK (status IN ('sent', 'failed')),
  error_detail text NOT NULL DEFAULT '',
  sent_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX student_excuses_school_student ON student_excuses(school_id, student_id, start_date DESC);
CREATE INDEX message_logs_school_created ON message_logs(school_id, created_at DESC);

-- Even if a future query is written incorrectly, PostgreSQL requires a school context.
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE students FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE almadar_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE almadar_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE student_excuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_excuses FORCE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY students_school_scope ON students USING (school_id = current_setting('app.school_id', true)::uuid) WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);
CREATE POLICY attendance_school_scope ON attendance_logs USING (school_id = current_setting('app.school_id', true)::uuid) WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);
CREATE POLICY almadar_accounts_school_scope ON almadar_accounts USING (school_id = current_setting('app.school_id', true)::uuid) WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);
CREATE POLICY student_excuses_school_scope ON student_excuses USING (school_id = current_setting('app.school_id', true)::uuid) WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);
CREATE POLICY message_logs_school_scope ON message_logs USING (school_id = current_setting('app.school_id', true)::uuid) WITH CHECK (school_id = current_setting('app.school_id', true)::uuid);
