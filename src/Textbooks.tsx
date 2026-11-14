import { useMemo, useState } from 'react'
import { BookOpen, ExternalLink, Search } from 'lucide-react'

const catalog = [
  { stage: 'المرحلة الابتدائية', grades: [
    ['الصف الأول الابتدائي', '792CF72C0C5529675630924A6D8A250E'], ['الصف الثاني الابتدائي', 'CC96649C45C01FF91948584001DEEFEB'], ['الصف الثالث الابتدائي', '62DC523091429A6D7BA4BC766D55F5B1'], ['الصف الرابع الابتدائي', '4CA6303C97B95A3B4B6B927B2B9D8C4A'], ['الصف الخامس الابتدائي', 'A62107794250CE435022CD2951383052'], ['الصف السادس الابتدائي', 'EAEF77304EE5F11534B0FA2C69EE776F'],
  ] },
  { stage: 'المرحلة المتوسطة', grades: [
    ['الصف الأول المتوسط', 'CB5B0DC90552D63CAB28951101CAB19D'], ['الصف الثاني المتوسط', 'B47494BFDA4FEA2A30BBC9FC72357528'], ['الصف الثالث المتوسط', 'CCBD907389931567A9A7DB4CA2CC4C27'],
  ] },
  { stage: 'المرحلة الثانوية', grades: [
    ['السنة الأولى المشتركة', 'E7027E8EDF24725B41C6D294DA2AADD7'], ['المسار العام', '3B7E33BCAA9DCFEE8ECBD670A0C2D6DA'], ['المسار الشرعي', '9D83FC7D8DEFFDC4E9C76A390372260A'], ['مسار إدارة الأعمال', 'FC43ED7EB1E4454D801ADB1EF03571E5'], ['مسار علوم الحاسب والهندسة', '7D429DE4FCD083075E810D216CE3D8B5'],
  ] },
]

export function Textbooks() {
  const [query, setQuery] = useState('')
  const normalized = (value: string) => value.trim().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
  const groups = useMemo(() => catalog.map(group => ({ ...group, grades: group.grades.filter(([title]) => normalized(`${group.stage} ${title}`).includes(normalized(query))) })).filter(group => group.grades.length), [query])
  return <section className="textbooks" dir="rtl">
    <header className="textbooks-header"><div className="textbooks-header-icon"><BookOpen size={26} /></div><div><span>مصادر التعلّم</span><h2>الكتب الدراسية</h2><p>اختر المرحلة والصف أو المسار لاستعراض الكتب وفتحها من منصة مدرستي.</p></div></header>
    <label className="textbooks-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ابحث عن المرحلة أو الصف أو المسار" aria-label="ابحث عن المرحلة أو الصف أو المسار" /></label>
    {groups.length ? groups.map(group => <section className="textbooks-stage" key={group.stage}><h3>{group.stage}</h3><div className="textbooks-grid">{group.grades.map(([title, id]) => <a key={id} href={`https://schools.madrasati.sa/books/${id}?Language=1`} target="_blank" rel="noopener noreferrer"><div className="textbooks-card-icon"><BookOpen size={21} /></div><div><strong>{title}</strong><small>استعراض المواد والكتب</small></div><ExternalLink size={17} aria-label="يفتح في منصة مدرستي" /></a>)}</div></section>) : <p className="textbooks-empty">لا توجد نتائج مطابقة للبحث.</p>}
    <p className="textbooks-source">الروابط أعلاه تفتح الكتب من منصة مدرستي. إذا ظهر تحذير أمان أو تعذر فتح المنصة، يمكنك استخدام <a href="https://www.ien.edu.sa/Home/Dashbord" target="_blank" rel="noopener noreferrer">بوابة عين الإثرائية <ExternalLink size={13} /></a>، ثم اختيار المرحلة و«الكتب والدروس».</p>
  </section>
}
