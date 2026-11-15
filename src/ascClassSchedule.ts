export type AscLesson = { classroomName: string; weekday: number; periodNumber: number; subjectName: string; rawTeacherName: string }
export type AscSchedule = { classrooms: Array<{ name: string }>; assignments: AscLesson[]; teachers: string[] }
const normalize = (value: string) => value.normalize('NFKC').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim()
const digits = (value: string) => value.replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632))
const names = ['الاحد', 'الاثنين', 'الثلاثاء', 'الاربعاء', 'الخميس', 'الجمعه', 'السبت']

export function isAscMime(bytes: Uint8Array): boolean {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 512)).toLowerCase()
  return head.includes('mime-version:') && head.includes('text/html')
}

export function parseAscClassSchedule(bytes: Uint8Array): AscSchedule {
  if (bytes.length > 3_000_000) throw new Error('حجم ملف تايم تيبل يتجاوز 3 ميجابايت.')
  if (!isAscMime(bytes)) throw new Error('صيغة ملف تايم تيبل غير مدعومة.')
  let start = -1
  for (let i=0;i<Math.min(bytes.length-3,16384);i++) {
    if (bytes[i]===13 && bytes[i+1]===10 && bytes[i+2]===13 && bytes[i+3]===10) { start=i+4; break }
    if (bytes[i]===10 && bytes[i+1]===10) { start=i+2; break }
  }
  if (start<0) throw new Error('تعذر قراءة رأس ملف تايم تيبل.')
  const header = new TextDecoder('ascii').decode(bytes.subarray(0,start)).toLowerCase()
  if (!/content-transfer-encoding:\s*quoted-printable/.test(header)) throw new Error('ترميز ملف تايم تيبل غير مدعوم.')
  const out: number[] = []
  const hex=(b:number) => b>=48&&b<=57?b-48:b>=65&&b<=70?b-55:b>=97&&b<=102?b-87:-1
  for(let i=start;i<bytes.length;i++) {
    if(bytes[i]===61) {
      if(bytes[i+1]===13&&bytes[i+2]===10){i+=2;continue}
      if(bytes[i+1]===10){i+=1;continue}
      const h=hex(bytes[i+1]), l=hex(bytes[i+2]); if(h>=0&&l>=0){out.push(h*16+l);i+=2;continue}
      throw new Error('يتضمن ملف تايم تيبل ترميزًا غير صالح.')
    }
    out.push(bytes[i])
  }
  let html: string
  try { html=new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(out)) } catch { throw new Error('تعذر قراءة النص العربي في الملف.') }
  const doc=new DOMParser().parseFromString(html,'text/html')
  const tables=doc.querySelectorAll('table'); if(tables.length!==1) throw new Error('يجب أن يحتوي الملف على جدول فصول واحد.')
  const rows=Array.from(tables[0].querySelectorAll('tr')).map(row=>Array.from(row.children).filter(el=>['TD','TH'].includes(el.tagName)) as HTMLElement[])
  if(rows.length<3) throw new Error('جدول الفصول غير مكتمل.')
  const days=rows[0].map(cell=>names.indexOf(normalize(cell.textContent||''))).filter(i=>i>=0)
  if(!days.length||new Set(days).size!==days.length||days.some((d,i)=>i>0&&d<=days[i-1])) throw new Error('تعذر تحديد أيام الجدول وترتيبها.')
  const headings=rows[1].map(cell=>normalize(cell.textContent||''))
  if(!['الشعبه','الفصل','الصف'].includes(headings[0])) throw new Error('تعذر تحديد عمود الفصل.')
  const blocks:number[][]=[]
  for(const text of headings.slice(1)) {
    const n=Number(digits(text)); if(!Number.isInteger(n)||n<1||n>12) throw new Error('رقم حصة غير صالح.')
    if(n===1)blocks.push([])
    const block=blocks[blocks.length-1];if(!block||n!==block.length+1)throw new Error('ترتيب الحصص غير واضح.');block.push(n)
  }
  if(blocks.length!==days.length) throw new Error('لا تتطابق أيام الجدول مع أرقام الحصص.')
  const slots=blocks.flatMap((periods,i)=>periods.map(period=>({weekday:days[i]+1,periodNumber:period})))
  const classrooms:Array<{name:string}>=[], assignments:AscLesson[]=[]; const seen=new Set<string>(), teachers=new Set<string>()
  for(const cells of rows.slice(2)) {
    if(!cells.some(cell=>(cell.textContent||'').trim()))continue
    const name=(cells[0]?.textContent||'').replace(/\s+/g,' ').trim()
    if(!name||cells.length!==slots.length+1||seen.has(normalize(name)))throw new Error('أحد الفصول مكرر أو لا يطابق عدد خانات الحصص.')
    seen.add(normalize(name));classrooms.push({name})
    cells.slice(1).forEach((cell,i)=>{
      const copy=cell.cloneNode(true) as HTMLElement;copy.querySelectorAll('br').forEach(br=>br.replaceWith('\n'))
      const parts=(copy.textContent||'').split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean)
      if(!parts.length)return
      if(parts.length!==2)throw new Error('تعذر فصل المادة عن المعلم في الفصل '+name+'، الحصة '+slots[i].periodNumber+'. راجع الملف.')
      teachers.add(parts[1]);assignments.push({classroomName:name,...slots[i],subjectName:parts[0],rawTeacherName:parts[1]})
    })
  }
  if(!classrooms.length||!assignments.length)throw new Error('لم أجد فصولًا وحصصًا في الملف.')
  return {classrooms,assignments,teachers:[...teachers].sort((a,b)=>a.localeCompare(b,'ar'))}
}
