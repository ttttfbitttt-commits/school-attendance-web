const CATALOG_VERSION = '1447.1'
const MODES = new Set(['in_person', 'remote'])
const RECORD_STATUSES = new Set(['pending', 'approved', 'cancelled'])
const ACTION_STATES = new Set(['required', 'executed', 'not_executed'])

function clean(value, max = 500) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

function validDate(value) {
  const date = String(value || '')
  const parsed = new Date(`${date}T12:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : null
}

function normalizeArabic(value) {
  return clean(value, 200).normalize('NFKC')
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
}

function gradeProfile(grade, schoolName = '') {
  const value = normalizeArabic(grade)
  const school = normalizeArabic(schoolName)
  const primary = /ابتد/.test(value) || /ابتد/.test(school)
  const middleSecondary = /متوسط|ثانو/.test(value) || /متوسط|ثانو/.test(school)
  const firstOrSecond = /(^|\s)(اول|الاول|الاولي|1|١|ثاني|الثاني|الثانيه|2|٢)(\s|$)/.test(value)
  if (primary) return { scope: 'primary', descriptiveOnly: firstOrSecond }
  if (middleSecondary) return { scope: 'middle_secondary', descriptiveOnly: false }
  return { scope: 'unknown', descriptiveOnly: false }
}

const firstDegreeProcedures = [
  { name: 'الإجراء الأول', deduct: false, items: ['التنبيه الشفهي الأول للطالب بأسلوب تربوي وبيان أثر السلوك.'] },
  { name: 'الإجراء الثاني', deduct: false, items: ['التنبيه الشفهي الثاني وتعزيز السلوك الإيجابي.', 'مناقشة مسببات السلوك والبدء في الحد منها.'] },
  { name: 'الإجراء الثالث', deduct: true, items: ['تدوين المشكلة السلوكية وتوقيع الطالب عليها.', 'إشعار ولي الأمر هاتفياً.', 'إحالة الطالب إلى الموجه الطلابي لدراسة حالته.'] },
  { name: 'الإجراء الرابع', deduct: true, items: ['دعوة ولي الأمر والاتفاق على خطة لتعديل السلوك.', 'إحالة الحالة إلى لجنة التوجيه الطلابي.', 'متابعة الحالة وتقديم الخدمات التربوية.'] },
]

const degreeProcedures = {
  1: firstDegreeProcedures,
  2: [
    { name: 'الإجراء الأول', deduct: true, items: ['إشعار ولي الأمر بالمشكلة والإجراءات المتخذة.', 'أخذ تعهد خطي بعدم التكرار.', 'إحالة الطالب إلى الموجه الطلابي.'] },
    { name: 'الإجراء الثاني', deduct: true, items: ['تنفيذ الإجراء السابق وتحديث خطة تعديل السلوك.', 'دعوة ولي الأمر ومناقشة الخطة المشتركة.', 'متابعة الحالة من الموجه الطلابي.'] },
    { name: 'الإجراء الثالث', deduct: true, items: ['تنفيذ الإجراء السابق.', 'إحالة الحالة إلى لجنة التوجيه الطلابي.', 'النظر في نقل الطالب إلى فصل آخر وفق قرار اللجنة.'] },
  ],
  3: [
    { name: 'الإجراء الأول', deduct: true, items: ['دعوة ولي الأمر ووضع برنامج وقائي مشترك.', 'أخذ تعهد خطي بعدم التكرار.', 'إحالة الطالب إلى الموجه الطلابي.'] },
    { name: 'الإجراء الثاني', deduct: true, items: ['تنفيذ الإجراء السابق.', 'إنذار الطالب كتابياً بالإجراء التالي عند التكرار.', 'إحالة الحالة إلى لجنة التوجيه الطلابي.'] },
    { name: 'الإجراء الثالث', deduct: true, items: ['تنفيذ الإجراءات السابقة.', 'رفع الحالة إلى الجهة المختصة بعد استنفاد إجراءات المدرسة.', 'استمرار المتابعة التربوية.'] },
  ],
  4: [
    { name: 'الإجراء الأول', deduct: true, items: ['إثبات الواقعة وإحالتها فوراً إلى لجنة التوجيه الطلابي.', 'دعوة ولي الأمر وأخذ تعهد خطي.', 'متابعة الحالة وتقديم الخدمات التربوية.'] },
    { name: 'الإجراء الثاني', deduct: true, items: ['تنفيذ الإجراءات السابقة.', 'رفع محضر اللجنة إلى إدارة التعليم بصفة عاجلة.', 'تمكين الطالب من فرص التعويض ومتابعته تربوياً.'] },
  ],
  5: [
    { name: 'الإجراء الأول', deduct: true, items: ['تدوين محضر إثبات الواقعة فوراً.', 'دعوة ولي الأمر وإبلاغ الجهات المختصة عند وجوب ذلك.', 'إحالة الحالة إلى لجنة التوجيه الطلابي ورفعها للجهة المختصة.'] },
  ],
}

const catalogSeeds = [
  ['P1-UNIFORM', 'عدم التقيد بالزي المدرسي', 1, ['primary'], 'in_person', 6, 19],
  ['P1-MORNING-LATE', 'التأخر الصباحي', 1, ['primary'], 'in_person', 6, 19],
  ['P1-ASSEMBLY-ABSENT', 'عدم حضور الاصطفاف الصباحي مع وجود الطالب في المدرسة', 1, ['primary'], 'in_person', 6, 19],
  ['P1-CLASS-LATE', 'التأخر في الدخول إلى الحصص', 1, ['primary'], 'in_person', 6, 19],
  ['P1-EATING', 'تناول الأطعمة أو المشروبات أثناء الدرس دون استئذان', 1, ['primary'], 'in_person', 6, 19],
  ['P1-SLEEPING', 'النوم داخل الفصل', 1, ['primary'], 'in_person', 6, 19],
  ['P2-CLASS-ABSENCE', 'عدم حضور الحصة الدراسية أو الهروب منها', 2, ['primary'], 'in_person', 7, 20],
  ['P2-LEAVE-NO-PERMIT', 'الدخول أو الخروج من الفصل دون استئذان', 2, ['primary'], 'in_person', 7, 20],
  ['P2-CHAOS', 'إثارة الفوضى داخل الفصل أو المدرسة أو وسائل النقل المدرسي', 2, ['primary'], 'in_person', 7, 20],
  ['P2-FIGHT', 'الشجار أو الاشتراك في مضاربة جماعية', 2, ['primary'], 'in_person', 7, 20],
  ['P2-INSULT', 'التلفظ بكلمات نابية أو التهديد أو السخرية من الطلبة', 2, ['primary'], 'in_person', 7, 20],
  ['P3-ASSAULT', 'التعرض لأحد الطلبة بالضرب', 3, ['primary'], 'in_person', 8, 21],
  ['P3-RECORDING', 'التصوير أو التسجيل الصوتي للطلبة دون إذن', 3, ['primary'], 'in_person', 8, 21],
  ['P3-SCHOOL-ESCAPE', 'الهروب من المدرسة', 3, ['primary'], 'in_person', 8, 21],
  ['MS1-MORNING-LATE', 'التأخر الصباحي', 1, ['middle_secondary'], 'in_person', 10, 24],
  ['MS1-ASSEMBLY-ABSENT', 'عدم حضور الاصطفاف الصباحي مع وجود الطالب في المدرسة', 1, ['middle_secondary'], 'in_person', 10, 24],
  ['MS1-CLASS-LATE', 'التأخر في الدخول إلى الحصص', 1, ['middle_secondary'], 'in_person', 10, 24],
  ['MS1-CLASS-DISRUPTION', 'إعاقة سير الحصة بالحديث الجانبي أو المقاطعة أو تناول الطعام', 1, ['middle_secondary'], 'in_person', 10, 24],
  ['MS1-SLEEPING', 'النوم داخل الفصل', 1, ['middle_secondary'], 'in_person', 10, 24],
  ['MS2-CLASS-ABSENCE', 'عدم حضور الحصة الدراسية أو الهروب منها', 2, ['middle_secondary'], 'in_person', 11, 25],
  ['MS2-LEAVE-NO-PERMIT', 'الدخول أو الخروج من الفصل دون استئذان', 2, ['middle_secondary'], 'in_person', 11, 25],
  ['MS2-CHAOS', 'إثارة الفوضى داخل الفصل أو المدرسة أو وسائل النقل المدرسي', 2, ['middle_secondary'], 'in_person', 11, 25],
  ['MS3-FIGHT', 'الشجار أو الاشتراك في مضاربة جماعية', 3, ['middle_secondary'], 'in_person', 12, 26],
  ['MS3-INSULT', 'التلفظ بكلمات نابية أو التهديد أو السخرية من الطلبة', 3, ['middle_secondary'], 'in_person', 12, 26],
  ['MS3-DAMAGE', 'إلحاق الضرر المتعمد بممتلكات الطلبة أو تجهيزات المدرسة', 3, ['middle_secondary'], 'in_person', 12, 26],
  ['MS3-DANGEROUS-MATERIAL', 'إحضار مواد أو ألعاب خطرة إلى المدرسة', 3, ['middle_secondary'], 'in_person', 12, 26],
  ['MS4-INJURY', 'تعمد إصابة أحد الطلبة بالضرب أو بأداة', 4, ['middle_secondary'], 'in_person', 13, 28],
  ['MS4-THEFT', 'سرقة ممتلكات الطلبة أو المدرسة', 4, ['middle_secondary'], 'in_person', 13, 28],
  ['MS4-SMOKING', 'التدخين بأنواعه داخل المدرسة', 4, ['middle_secondary'], 'in_person', 13, 28],
  ['MS4-SCHOOL-ESCAPE', 'الهروب من المدرسة', 4, ['middle_secondary'], 'in_person', 13, 28],
  ['R1-DIGITAL-ETIQUETTE', 'عدم الالتزام بآداب الحضور والتعامل الرقمي', 1, ['primary', 'middle_secondary'], 'remote', 19, 35],
  ['R2-CLASS-DISRUPTION', 'تعمد التشويش أو تعطيل الحصة الإلكترونية', 2, ['primary', 'middle_secondary'], 'remote', 20, 36],
  ['R3-UNAUTHORIZED-RECORDING', 'تصوير أو تسجيل الحصة الإلكترونية دون إذن', 3, ['primary', 'middle_secondary'], 'remote', 21, 36],
  ['R4-DIGITAL-HARM', 'الإضرار المتعمد بالمنصة أو حسابات الآخرين', 4, ['primary', 'middle_secondary'], 'remote', 22, 37],
  ['R5-CYBERCRIME', 'التهديد أو الابتزاز أو ارتكاب مخالفة معلوماتية جسيمة', 5, ['primary', 'middle_secondary'], 'remote', 27, 42],
]

const distinguishedSeeds = [
  ['D-ATTENDANCE', 'الانضباط وعدم الغياب دون عذر خلال الفصل الدراسي', 5],
  ['D-COMMUNITY', 'المشاركة في خدمة مجتمعية موثقة', 5],
  ['D-NATIONAL', 'المشاركة الإيجابية في المناسبات والبرامج الوطنية', 5],
  ['D-INITIATIVE', 'مبادرة سلوكية متميزة موثقة ومعتمدة', 5],
]

function ruleRow(row) {
  return {
    code: row.code, version: row.rule_version, category: row.category, title: row.title,
    degree: row.degree === null ? null : Number(row.degree), stageScope: row.stage_scope,
    mode: row.mode, deduction: Number(row.deduction_amount || 0), distinguishedScore: Number(row.distinguished_score || 0),
    article: row.official_article, page: row.official_page, procedures: row.procedures || [], sensitive: Boolean(row.sensitive),
  }
}

async function catalogRule(pool, code) {
  const result = await pool.query('SELECT * FROM behavior_catalog_rules WHERE code=$1 AND active=true', [code])
  return result.rowCount ? ruleRow(result.rows[0]) : null
}

async function writeAudit(client, schoolId, userId, entityType, entityId, action, details = {}) {
  await client.query(`INSERT INTO behavior_audit_logs(school_id,actor_id,entity_type,entity_id,action,details)
    VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [schoolId, userId, entityType, entityId, action, JSON.stringify(details)])
}

function scoreFromRows(rows) {
  const positiveDelta = Number(rows.find(row => row.bucket === 'positive')?.total || 0)
  const distinguishedDelta = Number(rows.find(row => row.bucket === 'distinguished')?.total || 0)
  const positiveScore = Math.max(0, Math.min(80, 80 + positiveDelta))
  const distinguishedScore = Math.max(0, Math.min(20, distinguishedDelta))
  return { positiveScore, distinguishedScore, totalScore: Math.min(100, positiveScore + distinguishedScore) }
}

export async function migrateBehavior(adminPool) {
  await adminPool.query(`
    CREATE TABLE IF NOT EXISTS behavior_catalog_rules (
      code text PRIMARY KEY,
      rule_version text NOT NULL,
      category text NOT NULL CHECK (category IN ('violation','distinguished')),
      title text NOT NULL,
      degree smallint CHECK (degree BETWEEN 1 AND 5),
      stage_scope text[] NOT NULL DEFAULT ARRAY['primary','middle_secondary']::text[],
      mode text NOT NULL CHECK (mode IN ('in_person','remote')),
      deduction_amount numeric(5,2) NOT NULL DEFAULT 0,
      distinguished_score numeric(5,2) NOT NULL DEFAULT 0,
      official_article integer,
      official_page integer,
      procedures jsonb NOT NULL DEFAULT '[]'::jsonb,
      sensitive boolean NOT NULL DEFAULT false,
      active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS behavior_incidents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      incident_date date NOT NULL,
      mode text NOT NULL CHECK (mode IN ('in_person','remote')),
      location text NOT NULL DEFAULT '',
      description text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled')),
      sensitive boolean NOT NULL DEFAULT false,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS behavior_student_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      incident_id uuid NOT NULL REFERENCES behavior_incidents(id) ON DELETE RESTRICT,
      student_id text NOT NULL,
      rule_code text NOT NULL REFERENCES behavior_catalog_rules(code) ON DELETE RESTRICT,
      rule_version text NOT NULL,
      rule_title text NOT NULL,
      category text NOT NULL CHECK (category IN ('violation','distinguished')),
      degree smallint CHECK (degree BETWEEN 1 AND 5),
      recurrence_number integer NOT NULL CHECK (recurrence_number > 0),
      procedure_name text NOT NULL DEFAULT '',
      procedure_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
      descriptive_only boolean NOT NULL DEFAULT false,
      proposed_amount numeric(5,2) NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled')),
      approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
      approved_at timestamptz,
      cancellation_reason text NOT NULL DEFAULT '',
      cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL,
      cancelled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,incident_id,student_id),
      FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS behavior_action_steps (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      record_id uuid NOT NULL REFERENCES behavior_student_records(id) ON DELETE CASCADE,
      sequence_number integer NOT NULL,
      label text NOT NULL,
      state text NOT NULL DEFAULT 'required' CHECK (state IN ('required','executed','not_executed')),
      reason text NOT NULL DEFAULT '',
      evidence_ref text NOT NULL DEFAULT '',
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,record_id,sequence_number)
    );

    CREATE TABLE IF NOT EXISTS behavior_score_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      record_id uuid REFERENCES behavior_student_records(id) ON DELETE RESTRICT,
      student_id text NOT NULL,
      movement_type text NOT NULL CHECK (movement_type IN ('deduction','compensation','distinguished','reversal')),
      bucket text NOT NULL CHECK (bucket IN ('positive','distinguished')),
      amount numeric(5,2) NOT NULL CHECK (amount <> 0),
      source_movement_id uuid REFERENCES behavior_score_movements(id) ON DELETE RESTRICT,
      reason text NOT NULL DEFAULT '',
      evidence_ref text NOT NULL DEFAULT '',
      status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','cancelled')),
      idempotency_key text NOT NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      approved_by uuid REFERENCES users(id) ON DELETE SET NULL,
      approved_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (school_id,idempotency_key),
      FOREIGN KEY (school_id,student_id) REFERENCES students(school_id,id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS behavior_audit_logs (
      id bigserial PRIMARY KEY,
      school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
      actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      entity_type text NOT NULL,
      entity_id text NOT NULL,
      action text NOT NULL,
      details jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS behavior_records_student_rule ON behavior_student_records(school_id,student_id,rule_code,status,created_at);
    CREATE INDEX IF NOT EXISTS behavior_records_status ON behavior_student_records(school_id,status,created_at DESC);
    CREATE INDEX IF NOT EXISTS behavior_movements_student ON behavior_score_movements(school_id,student_id,status,created_at);
    CREATE INDEX IF NOT EXISTS behavior_incidents_date ON behavior_incidents(school_id,incident_date DESC);
  `)

  for (const [code, title, degree, stageScope, mode, article, page] of catalogSeeds) {
    await adminPool.query(`INSERT INTO behavior_catalog_rules(code,rule_version,category,title,degree,stage_scope,mode,deduction_amount,official_article,official_page,procedures,sensitive)
      VALUES($1,$2,'violation',$3,$4,$5::text[],$6,$7,$8,$9,$10::jsonb,$11)
      ON CONFLICT(code) DO UPDATE SET rule_version=EXCLUDED.rule_version,title=EXCLUDED.title,degree=EXCLUDED.degree,stage_scope=EXCLUDED.stage_scope,mode=EXCLUDED.mode,
        deduction_amount=EXCLUDED.deduction_amount,official_article=EXCLUDED.official_article,official_page=EXCLUDED.official_page,procedures=EXCLUDED.procedures,sensitive=EXCLUDED.sensitive,active=true`,
    [code, CATALOG_VERSION, title, degree, stageScope, mode, [0, 1, 2, 3, 10, 15][degree], article, page, JSON.stringify(degreeProcedures[degree]), degree >= 4])
  }
  for (const [code, title, score] of distinguishedSeeds) {
    await adminPool.query(`INSERT INTO behavior_catalog_rules(code,rule_version,category,title,stage_scope,mode,distinguished_score,official_article,official_page,procedures)
      VALUES($1,$2,'distinguished',$3,ARRAY['primary','middle_secondary']::text[],'in_person',$4,5,18,'[]'::jsonb)
      ON CONFLICT(code) DO UPDATE SET rule_version=EXCLUDED.rule_version,title=EXCLUDED.title,distinguished_score=EXCLUDED.distinguished_score,active=true`,
    [code, CATALOG_VERSION, title, score])
  }
}

export async function handleBehaviorRequest({ req, res, url, user, pool, body, json, scoped, todayRiyadh }) {
  if (!url.pathname.startsWith('/api/behavior')) return false
  const adminOnly = () => user.role === 'admin'

  if (req.method === 'GET' && url.pathname === '/api/behavior/catalog') {
    const category = clean(url.searchParams.get('category'), 30)
    const mode = clean(url.searchParams.get('mode'), 30)
    const query = clean(url.searchParams.get('q'), 120)
    const values = []
    const clauses = ['active=true']
    if (category) { values.push(category); clauses.push(`category=$${values.length}`) }
    if (mode) { values.push(mode); clauses.push(`mode=$${values.length}`) }
    if (query) { values.push(`%${query}%`); clauses.push(`title ILIKE $${values.length}`) }
    const rows = (await pool.query(`SELECT * FROM behavior_catalog_rules WHERE ${clauses.join(' AND ')} ORDER BY category,degree NULLS LAST,title`, values)).rows
    json(res, 200, { version: CATALOG_VERSION, rules: rows.map(ruleRow) })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/behavior/overview') {
    const result = await scoped(user.school_id, async client => {
      const counts = (await client.query(`SELECT
        COUNT(*) FILTER (WHERE status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE status='approved' AND category='violation')::int AS violations,
        COUNT(*) FILTER (WHERE status='approved' AND category='distinguished')::int AS distinguished,
        COUNT(DISTINCT student_id) FILTER (WHERE status='approved')::int AS students
        FROM behavior_student_records WHERE school_id=$1`, [user.school_id])).rows[0]
      const recent = (await client.query(`SELECT r.id,r.student_id AS "studentId",s.name,s.grade,s.classroom,r.rule_code AS "ruleCode",r.rule_title AS "ruleTitle",
        r.category,r.degree,r.recurrence_number AS recurrence,r.procedure_name AS "procedureName",r.descriptive_only AS "descriptiveOnly",r.proposed_amount AS amount,r.status,
        to_char(i.incident_date,'YYYY-MM-DD') AS date,i.mode,i.sensitive,r.created_at AS "createdAt"
        FROM behavior_student_records r JOIN behavior_incidents i ON i.id=r.incident_id AND i.school_id=r.school_id
        JOIN students s ON s.school_id=r.school_id AND s.id=r.student_id
        WHERE r.school_id=$1 ORDER BY r.created_at DESC LIMIT 12`, [user.school_id])).rows
      return { counts, recent }
    })
    json(res, 200, result)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/behavior/students') {
    const search = clean(url.searchParams.get('q'), 120)
    const result = await scoped(user.school_id, async client => ({
      schoolName: (await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])).rows[0]?.name || '',
      rows: (await client.query(`SELECT s.id,s.name,s.grade,s.classroom,s.phone,
        COUNT(r.id) FILTER (WHERE r.status='approved' AND r.category='violation')::int AS "violationCount",
        COUNT(r.id) FILTER (WHERE r.status='pending')::int AS "pendingCount"
        FROM students s LEFT JOIN behavior_student_records r ON r.school_id=s.school_id AND r.student_id=s.id
        WHERE s.school_id=$1 AND s.active=true AND ($2='' OR s.name ILIKE '%'||$2||'%' OR s.id ILIKE '%'||$2||'%')
        GROUP BY s.school_id,s.id ORDER BY s.grade,s.classroom,s.name LIMIT 500`, [user.school_id, search])).rows,
    }))
    json(res, 200, { students: result.rows.map(row => ({ ...row, descriptiveOnly: gradeProfile(row.grade, result.schoolName).descriptiveOnly })) })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/behavior/preview') {
    const input = await body(req)
    const rule = await catalogRule(pool, clean(input.ruleCode, 100))
    const studentIds = [...new Set(Array.isArray(input.studentIds) ? input.studentIds.map(value => clean(value, 100)).filter(Boolean) : [])].slice(0, 500)
    if (!rule || !studentIds.length || !MODES.has(String(input.mode || '')) || rule.mode !== input.mode) { json(res, 400, { error: 'invalid_behavior_preview' }); return true }
    const preview = await scoped(user.school_id, async client => {
      const schoolName = (await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])).rows[0]?.name || ''
      const students = (await client.query('SELECT id,name,grade,classroom FROM students WHERE school_id=$1 AND active=true AND id=ANY($2::text[]) ORDER BY name', [user.school_id, studentIds])).rows
      if (students.length !== studentIds.length) return null
      const items = []
      for (const student of students) {
        const profile = gradeProfile(student.grade, schoolName)
        const applicable = profile.scope === 'unknown' || rule.stageScope.includes(profile.scope)
        const approved = Number((await client.query(`SELECT COUNT(*)::int AS count FROM behavior_student_records
          WHERE school_id=$1 AND student_id=$2 AND rule_code=$3 AND status='approved'`, [user.school_id, student.id, rule.code])).rows[0].count)
        const procedure = rule.category === 'violation' ? rule.procedures[approved] : null
        items.push({ ...student, descriptiveOnly: profile.descriptiveOnly, applicable, recurrence: approved + 1,
          exhausted: rule.category === 'violation' && !procedure, procedureName: procedure?.name || '', actions: procedure?.items || [],
          deduction: profile.descriptiveOnly || !procedure?.deduct ? 0 : rule.deduction, distinguishedScore: rule.category === 'distinguished' ? rule.distinguishedScore : 0 })
      }
      return items
    })
    if (!preview) { json(res, 404, { error: 'student_not_found' }); return true }
    json(res, 200, { rule, students: preview })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/behavior/incidents') {
    const input = await body(req)
    const rule = await catalogRule(pool, clean(input.ruleCode, 100))
    const incidentDate = validDate(input.date)
    const mode = MODES.has(String(input.mode || '')) ? String(input.mode) : null
    const studentIds = [...new Set(Array.isArray(input.studentIds) ? input.studentIds.map(value => clean(value, 100)).filter(Boolean) : [])].slice(0, 500)
    if (!rule || !incidentDate || !mode || rule.mode !== mode || !studentIds.length) { json(res, 400, { error: 'invalid_behavior_incident' }); return true }
    const saved = await scoped(user.school_id, async client => {
      const schoolName = (await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])).rows[0]?.name || ''
      const students = (await client.query('SELECT id,name,grade,classroom FROM students WHERE school_id=$1 AND active=true AND id=ANY($2::text[])', [user.school_id, studentIds])).rows
      if (students.length !== studentIds.length) return { error: 'student_not_found' }
      const prepared = []
      for (const student of students) {
        const profile = gradeProfile(student.grade, schoolName)
        if (profile.scope !== 'unknown' && !rule.stageScope.includes(profile.scope)) return { error: 'rule_not_applicable', student: student.name }
        const approved = Number((await client.query(`SELECT COUNT(*)::int AS count FROM behavior_student_records
          WHERE school_id=$1 AND student_id=$2 AND rule_code=$3 AND status='approved'`, [user.school_id, student.id, rule.code])).rows[0].count)
        const procedure = rule.category === 'violation' ? rule.procedures[approved] : { name: 'اعتماد السلوك المتميز', items: ['مراجعة الشاهد واعتماد الاستحقاق.'], deduct: false }
        if (!procedure) return { error: 'procedure_sequence_exhausted', student: student.name }
        prepared.push({ student, profile, recurrence: approved + 1, procedure })
      }
      const incident = (await client.query(`INSERT INTO behavior_incidents(school_id,incident_date,mode,location,description,sensitive,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [user.school_id, incidentDate, mode, clean(input.location, 200), clean(input.description, 1500), rule.sensitive, user.user_id])).rows[0]
      const records = []
      for (const item of prepared) {
        const proposed = rule.category === 'distinguished' ? rule.distinguishedScore : (item.profile.descriptiveOnly || !item.procedure.deduct ? 0 : rule.deduction)
        const record = (await client.query(`INSERT INTO behavior_student_records(school_id,incident_id,student_id,rule_code,rule_version,rule_title,category,degree,recurrence_number,procedure_name,procedure_snapshot,descriptive_only,proposed_amount)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING id`,
        [user.school_id, incident.id, item.student.id, rule.code, rule.version, rule.title, rule.category, rule.degree, item.recurrence, item.procedure.name, JSON.stringify(item.procedure.items), item.profile.descriptiveOnly, proposed])).rows[0]
        for (const [index, label] of item.procedure.items.entries()) await client.query(`INSERT INTO behavior_action_steps(school_id,record_id,sequence_number,label) VALUES($1,$2,$3,$4)`, [user.school_id, record.id, index + 1, label])
        records.push(record.id)
      }
      await writeAudit(client, user.school_id, user.user_id, 'incident', incident.id, 'created', { ruleCode: rule.code, students: studentIds.length, date: incidentDate })
      return { incidentId: incident.id, records }
    })
    if (saved.error) { json(res, 409, saved); return true }
    json(res, 201, saved)
    return true
  }

  if (req.method === 'GET' && url.pathname === '/api/behavior/records') {
    const status = clean(url.searchParams.get('status'), 30)
    const category = clean(url.searchParams.get('category'), 30)
    const studentId = clean(url.searchParams.get('studentId'), 100)
    const from = validDate(url.searchParams.get('from'))
    const to = validDate(url.searchParams.get('to'))
    const rows = await scoped(user.school_id, async client => {
      const values = [user.school_id]
      const clauses = ['r.school_id=$1']
      if (status && RECORD_STATUSES.has(status)) { values.push(status); clauses.push(`r.status=$${values.length}`) }
      if (category) { values.push(category); clauses.push(`r.category=$${values.length}`) }
      if (studentId) { values.push(studentId); clauses.push(`r.student_id=$${values.length}`) }
      if (from) { values.push(from); clauses.push(`i.incident_date >= $${values.length}`) }
      if (to) { values.push(to); clauses.push(`i.incident_date <= $${values.length}`) }
      return (await client.query(`SELECT r.id,r.student_id AS "studentId",s.name,s.grade,s.classroom,r.rule_code AS "ruleCode",r.rule_title AS "ruleTitle",r.category,r.degree,
        r.recurrence_number AS recurrence,r.procedure_name AS "procedureName",r.procedure_snapshot AS actions,r.descriptive_only AS "descriptiveOnly",r.proposed_amount AS amount,r.status,
        r.cancellation_reason AS "cancellationReason",to_char(i.incident_date,'YYYY-MM-DD') AS date,i.mode,i.location,i.description,i.sensitive,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a.id,'sequence',a.sequence_number,'label',a.label,'state',a.state,'reason',a.reason,'evidence',a.evidence_ref) ORDER BY a.sequence_number) FROM behavior_action_steps a WHERE a.school_id=r.school_id AND a.record_id=r.id),'[]'::jsonb) AS "actionSteps"
        FROM behavior_student_records r JOIN behavior_incidents i ON i.id=r.incident_id AND i.school_id=r.school_id
        JOIN students s ON s.school_id=r.school_id AND s.id=r.student_id WHERE ${clauses.join(' AND ')} ORDER BY i.incident_date DESC,r.created_at DESC LIMIT 500`, values)).rows
    })
    json(res, 200, { records: rows })
    return true
  }

  const approveMatch = url.pathname.match(/^\/api\/behavior\/records\/([0-9a-f-]{36})\/approve$/i)
  if (req.method === 'POST' && approveMatch) {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const recordId = approveMatch[1]
    const outcome = await scoped(user.school_id, async client => {
      const found = await client.query(`SELECT r.*,s.grade FROM behavior_student_records r JOIN students s ON s.school_id=r.school_id AND s.id=r.student_id
        WHERE r.school_id=$1 AND r.id=$2 FOR UPDATE OF r`, [user.school_id, recordId])
      if (!found.rowCount) return { error: 'record_not_found' }
      const record = found.rows[0]
      if (record.status !== 'pending') return { error: 'record_not_pending' }
      const rule = await catalogRule(pool, record.rule_code)
      if (!rule) return { error: 'rule_not_found' }
      const approved = Number((await client.query(`SELECT COUNT(*)::int AS count FROM behavior_student_records WHERE school_id=$1 AND student_id=$2 AND rule_code=$3 AND status='approved'`, [user.school_id, record.student_id, record.rule_code])).rows[0].count)
      const procedure = rule.category === 'violation' ? rule.procedures[approved] : { name: 'اعتماد السلوك المتميز', items: ['مراجعة الشاهد واعتماد الاستحقاق.'], deduct: false }
      if (!procedure) return { error: 'procedure_sequence_exhausted' }
      const schoolName = (await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])).rows[0]?.name || ''
      const descriptive = gradeProfile(record.grade, schoolName).descriptiveOnly
      let amount = rule.category === 'distinguished' ? rule.distinguishedScore : (descriptive || !procedure.deduct ? 0 : rule.deduction)
      if (rule.category === 'distinguished') {
        const current = Number((await client.query(`SELECT COALESCE(SUM(amount),0) AS total FROM behavior_score_movements WHERE school_id=$1 AND student_id=$2 AND bucket='distinguished' AND status='approved'`, [user.school_id, record.student_id])).rows[0].total)
        amount = Math.max(0, Math.min(amount, 20 - current))
      }
      await client.query(`UPDATE behavior_student_records SET recurrence_number=$1,procedure_name=$2,procedure_snapshot=$3::jsonb,descriptive_only=$4,proposed_amount=$5,status='approved',approved_by=$6,approved_at=now(),updated_at=now() WHERE school_id=$7 AND id=$8`,
      [approved + 1, procedure.name, JSON.stringify(procedure.items), descriptive, amount, user.user_id, user.school_id, recordId])
      await client.query('DELETE FROM behavior_action_steps WHERE school_id=$1 AND record_id=$2', [user.school_id, recordId])
      for (const [index, label] of procedure.items.entries()) await client.query(`INSERT INTO behavior_action_steps(school_id,record_id,sequence_number,label) VALUES($1,$2,$3,$4)`, [user.school_id, recordId, index + 1, label])
      if (amount > 0 && !descriptive) {
        const type = rule.category === 'distinguished' ? 'distinguished' : 'deduction'
        const bucket = rule.category === 'distinguished' ? 'distinguished' : 'positive'
        const signed = type === 'deduction' ? -amount : amount
        await client.query(`INSERT INTO behavior_score_movements(school_id,record_id,student_id,movement_type,bucket,amount,reason,status,idempotency_key,created_by,approved_by,approved_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,'approved',$8,$9,$9,now()) ON CONFLICT(school_id,idempotency_key) DO NOTHING`,
        [user.school_id, recordId, record.student_id, type, bucket, signed, record.rule_title, `${type}:${recordId}`, user.user_id])
      }
      await client.query(`UPDATE behavior_incidents i SET status=CASE WHEN EXISTS(SELECT 1 FROM behavior_student_records r WHERE r.incident_id=i.id AND r.school_id=i.school_id AND r.status='pending') THEN 'pending' ELSE 'approved' END,updated_at=now() WHERE i.school_id=$1 AND i.id=$2`, [user.school_id, record.incident_id])
      await writeAudit(client, user.school_id, user.user_id, 'record', recordId, 'approved', { recurrence: approved + 1, amount })
      return { ok: true, recurrence: approved + 1, amount }
    })
    json(res, outcome.error ? 409 : 200, outcome)
    return true
  }

  const cancelMatch = url.pathname.match(/^\/api\/behavior\/records\/([0-9a-f-]{36})\/cancel$/i)
  if (req.method === 'POST' && cancelMatch) {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const reason = clean(input.reason, 500)
    if (reason.length < 5) { json(res, 400, { error: 'cancellation_reason_required' }); return true }
    const result = await scoped(user.school_id, async client => {
      const found = await client.query('SELECT * FROM behavior_student_records WHERE school_id=$1 AND id=$2 FOR UPDATE', [user.school_id, cancelMatch[1]])
      if (!found.rowCount) return { error: 'record_not_found' }
      const record = found.rows[0]
      if (record.status === 'cancelled') return { error: 'record_already_cancelled' }
      if (record.status === 'approved') {
        const movements = (await client.query(`SELECT * FROM behavior_score_movements WHERE school_id=$1 AND record_id=$2 AND status='approved' AND movement_type IN ('deduction','distinguished')`, [user.school_id, record.id])).rows
        for (const movement of movements) await client.query(`INSERT INTO behavior_score_movements(school_id,record_id,student_id,movement_type,bucket,amount,source_movement_id,reason,status,idempotency_key,created_by,approved_by,approved_at)
          VALUES($1,$2,$3,'reversal',$4,$5,$6,$7,'approved',$8,$9,$9,now()) ON CONFLICT(school_id,idempotency_key) DO NOTHING`,
        [user.school_id, record.id, record.student_id, movement.bucket, -Number(movement.amount), movement.id, reason, `reversal:${movement.id}`, user.user_id])
      }
      await client.query(`UPDATE behavior_student_records SET status='cancelled',cancellation_reason=$1,cancelled_by=$2,cancelled_at=now(),updated_at=now() WHERE school_id=$3 AND id=$4`, [reason, user.user_id, user.school_id, record.id])
      await writeAudit(client, user.school_id, user.user_id, 'record', record.id, 'cancelled', { reason })
      return { ok: true }
    })
    json(res, result.error ? 409 : 200, result)
    return true
  }

  const actionMatch = url.pathname.match(/^\/api\/behavior\/records\/([0-9a-f-]{36})\/actions\/([0-9a-f-]{36})$/i)
  if (req.method === 'PUT' && actionMatch) {
    const input = await body(req)
    const state = ACTION_STATES.has(String(input.state || '')) ? String(input.state) : null
    const reason = clean(input.reason, 500)
    const evidence = clean(input.evidence, 500)
    if (!state || (state === 'not_executed' && reason.length < 5)) { json(res, 400, { error: 'invalid_action_update' }); return true }
    const updated = await scoped(user.school_id, async client => {
      const result = await client.query(`UPDATE behavior_action_steps a SET state=$1,reason=$2,evidence_ref=$3,updated_by=$4,updated_at=now()
        FROM behavior_student_records r WHERE a.school_id=$5 AND a.id=$6 AND a.record_id=$7 AND r.school_id=a.school_id AND r.id=a.record_id AND r.status='approved' RETURNING a.id`,
      [state, reason, evidence, user.user_id, user.school_id, actionMatch[2], actionMatch[1]])
      if (result.rowCount) await writeAudit(client, user.school_id, user.user_id, 'action', actionMatch[2], 'state_updated', { state, reason, evidence })
      return result.rowCount
    })
    json(res, updated ? 200 : 404, updated ? { ok: true } : { error: 'action_not_found' })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/api/behavior/compensations') {
    if (!adminOnly()) { json(res, 403, { error: 'forbidden' }); return true }
    const input = await body(req)
    const sourceId = clean(input.sourceMovementId, 60)
    const requested = Number(input.amount)
    const evidence = clean(input.evidence, 500)
    const reason = clean(input.reason, 500)
    if (!/^[0-9a-f-]{36}$/i.test(sourceId) || !Number.isFinite(requested) || requested <= 0 || !evidence) { json(res, 400, { error: 'invalid_compensation' }); return true }
    const outcome = await scoped(user.school_id, async client => {
      const source = await client.query(`SELECT * FROM behavior_score_movements WHERE school_id=$1 AND id=$2 AND movement_type='deduction' AND status='approved' FOR UPDATE`, [user.school_id, sourceId])
      if (!source.rowCount) return { error: 'deduction_not_found' }
      const movement = source.rows[0]
      const allocated = Number((await client.query(`SELECT COALESCE(SUM(amount),0) AS total FROM behavior_score_movements WHERE school_id=$1 AND source_movement_id=$2 AND movement_type='compensation' AND status='approved'`, [user.school_id, sourceId])).rows[0].total)
      const remaining = Math.max(0, Math.abs(Number(movement.amount)) - allocated)
      const amount = Math.min(requested, remaining)
      if (amount <= 0) return { error: 'deduction_fully_compensated' }
      const idempotency = `compensation:${sourceId}:${Buffer.from(evidence).toString('base64url').slice(0, 80)}`
      const inserted = await client.query(`INSERT INTO behavior_score_movements(school_id,record_id,student_id,movement_type,bucket,amount,source_movement_id,reason,evidence_ref,status,idempotency_key,created_by,approved_by,approved_at)
        VALUES($1,$2,$3,'compensation','positive',$4,$5,$6,$7,'approved',$8,$9,$9,now()) ON CONFLICT(school_id,idempotency_key) DO NOTHING RETURNING id`,
      [user.school_id, movement.record_id, movement.student_id, amount, movement.id, reason, evidence, idempotency, user.user_id])
      if (!inserted.rowCount) return { error: 'compensation_already_recorded' }
      await writeAudit(client, user.school_id, user.user_id, 'movement', inserted.rows[0].id, 'compensation_created', { sourceId, amount })
      return { ok: true, amount, remaining: remaining - amount }
    })
    json(res, outcome.error ? 409 : 201, outcome)
    return true
  }

  const studentMatch = url.pathname.match(/^\/api\/behavior\/students\/([^/]+)$/)
  if (req.method === 'GET' && studentMatch) {
    const studentId = decodeURIComponent(studentMatch[1])
    const profile = await scoped(user.school_id, async client => {
      const student = (await client.query('SELECT id,name,grade,classroom,phone FROM students WHERE school_id=$1 AND id=$2 AND active=true', [user.school_id, studentId])).rows[0]
      if (!student) return null
      const schoolName = (await client.query('SELECT name FROM schools WHERE id=$1', [user.school_id])).rows[0]?.name || ''
      const records = (await client.query(`SELECT r.id,r.rule_title AS "ruleTitle",r.rule_code AS "ruleCode",r.category,r.degree,r.recurrence_number AS recurrence,r.procedure_name AS "procedureName",r.status,to_char(i.incident_date,'YYYY-MM-DD') AS date
        FROM behavior_student_records r JOIN behavior_incidents i ON i.school_id=r.school_id AND i.id=r.incident_id WHERE r.school_id=$1 AND r.student_id=$2 ORDER BY i.incident_date DESC,r.created_at DESC`, [user.school_id, studentId])).rows
      const movementRows = (await client.query(`SELECT bucket,COALESCE(SUM(amount),0) AS total FROM behavior_score_movements WHERE school_id=$1 AND student_id=$2 AND status='approved' GROUP BY bucket`, [user.school_id, studentId])).rows
      const movements = (await client.query(`SELECT id,movement_type AS type,bucket,amount,reason,evidence_ref AS evidence,source_movement_id AS "sourceMovementId",created_at AS "createdAt" FROM behavior_score_movements WHERE school_id=$1 AND student_id=$2 AND status='approved' ORDER BY created_at DESC`, [user.school_id, studentId])).rows
      const descriptiveOnly = gradeProfile(student.grade, schoolName).descriptiveOnly
      return { student: { ...student, descriptiveOnly }, scores: descriptiveOnly ? null : scoreFromRows(movementRows), records, movements }
    })
    json(res, profile ? 200 : 404, profile || { error: 'student_not_found' })
    return true
  }

  json(res, 404, { error: 'not_found' })
  return true
}
