import { ArrowLeftRight, Building2, CheckCircle2, ClipboardList, ShieldCheck, UserRoundCheck } from 'lucide-react'

type GuideRole = 'school' | 'vice' | 'counselor'

const roleDetails: Record<GuideRole, { eyebrow: string; title: string; description: string; task: string; next: string; Icon: typeof Building2 }> = {
  school: {
    eyebrow: 'إدارة المدرسة',
    title: 'دليل سير إجراءات التعامل مع الغياب',
    description: 'يعرض هذا الدليل مسار العمل المشترك بين المدرسة والوكيل والموجّه الطلابي قبل بدء التحويلات الإلكترونية.',
    task: 'الإشراف على جميع الحالات، ومراجعة ما يتم توثيقه واعتماد الإجراء النهائي عند الحاجة.',
    next: 'في الخطوة التالية ستظهر الحالات المعتمدة ومتابعة مراحلها من لوحة واحدة.',
    Icon: Building2,
  },
  vice: {
    eyebrow: 'بوابة وكيل المدرسة',
    title: 'دور الوكيل في متابعة الغياب',
    description: 'يتولى الوكيل أول متابعة بشرية بعد اعتماد الغياب، ويوثق التواصل مع ولي الأمر قبل تحويل الحالة.',
    task: 'مراجعة الغياب المعتمد لمرحلتك، وتوثيق التواصل مع ولي الأمر، ثم تحويل الحالة للموجّه عند تحقق المرحلة المطلوبة.',
    next: 'في الخطوة التالية ستصل لك الحالات الخاصة بمرحلتك مع زر تحويل إلكتروني للموجّه.',
    Icon: UserRoundCheck,
  },
  counselor: {
    eyebrow: 'بوابة الموجّه الطلابي',
    title: 'دور الموجّه في متابعة الغياب',
    description: 'يتسلم الموجّه الحالات المحولة إليه فقط، ويستكمل دراسة الحالة وخطة الدعم دون تكرار بيانات الوكيل.',
    task: 'دراسة الحالة المحولة لمرحلتك، وتوثيق خطة الدعم والإجراء المتخذ، ثم طلب متابعة الوكيل أو إرسالها لاعتماد المدرسة.',
    next: 'في الخطوة التالية ستظهر الحالات المحولة إليك مع كامل سجلها الزمني.',
    Icon: ShieldCheck,
  },
}

const steps = [
  { title: 'اعتماد الغياب', text: 'لا تبدأ الإجراءات إلا من الغياب الذي اعتمد في سجل الحضور.', icon: CheckCircle2 },
  { title: 'توثيق التواصل', text: 'يوثق الوكيل التواصل مع ولي الأمر والإجراء الأولي في نفس ملف الحالة.', icon: ClipboardList },
  { title: 'تحويل إلكتروني للموجّه', text: 'عند تحقق المرحلة المناسبة يحول الوكيل الحالة بضغطة واحدة مع كامل بياناتها.', icon: ArrowLeftRight },
  { title: 'دراسة الحالة والاعتماد', text: 'يوثق الموجّه الخطة، وتتابع المدرسة الحالة وتعتمد ما يلزم.', icon: ShieldCheck },
]

export function AbsenceProcedureGuide({ role }: { role: GuideRole }) {
  const details = roleDetails[role]
  const RoleIcon = details.Icon

  return <section className="absence-procedure-guide" aria-labelledby="absence-procedure-title">
    <header className="absence-procedure-head">
      <div>
        <span>{details.eyebrow}</span>
        <div className="absence-procedure-title-row"><h2 id="absence-procedure-title">{details.title}</h2><b className="absence-procedure-new-badge">جديد</b></div>
        <p>{details.description}</p>
      </div>
      <RoleIcon aria-hidden="true" size={36} />
    </header>

    <section className="absence-procedure-role-card">
      <strong>مهمتك في هذه المرحلة</strong>
      <p>{details.task}</p>
      <small>{details.next}</small>
    </section>

    <ol className="absence-procedure-steps">
      {steps.map(({ title, text, icon: Icon }, index) => <li key={title}>
        <span className="absence-procedure-step-number">{index + 1}</span>
        <Icon size={21} aria-hidden="true" />
        <div><strong>{title}</strong><p>{text}</p></div>
      </li>)}
    </ol>

    <footer className="absence-procedure-note"><ShieldCheck size={18} aria-hidden="true" /><span><strong>هذه المرحلة إرشادية فقط.</strong> لا تنشئ حالات، ولا تغيّر سجل الحضور، ولا ترسل رسائل أو تحويلات.</span></footer>
  </section>
}
