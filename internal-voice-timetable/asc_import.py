"""Read aSc's HTML/MIME class timetable export without mutating school data."""
from email import policy
from email.parser import BytesParser
from html.parser import HTMLParser
import re
import unicodedata

DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']

def normalize(value):
    value = unicodedata.normalize('NFKC', str(value or ''))
    value = re.sub('[أإآٱ]', 'ا', value).replace('ى', 'ي').replace('ة', 'ه')
    return ' '.join(re.sub(r'[^\w\u0600-\u06ff]+', ' ', value).split())

class Tables(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.tables=[]; self.table=None; self.row=None; self.cell=None
    def handle_starttag(self, tag, attrs):
        if tag=='table' and self.table is None: self.table=[]
        elif tag=='tr' and self.table is not None: self.row=[]
        elif tag in ('td','th') and self.row is not None: self.cell=[]
        elif tag=='br' and self.cell is not None: self.cell.append('\n')
    def handle_data(self, data):
        if self.cell is not None: self.cell.append(data)
    def handle_endtag(self, tag):
        if tag in ('td','th') and self.cell is not None:
            self.row.append(''.join(self.cell)); self.cell=None
        elif tag=='tr' and self.row is not None:
            self.table.append(self.row); self.row=None
        elif tag=='table' and self.table is not None:
            self.tables.append(self.table); self.table=None

def parse_asc(raw):
    if not raw or len(raw)>3_000_000: raise ValueError('حجم الملف غير صالح أو يتجاوز 3 ميجابايت.')
    message=BytesParser(policy=policy.default).parsebytes(raw)
    if message.is_multipart():
        parts=[part for part in message.walk() if part.get_content_type()=='text/html']
        if len(parts)!=1: raise ValueError('تعذر تحديد جدول الفصول في الملف.')
        message=parts[0]
    if message.get_content_type()!='text/html':
        raise ValueError('هذا ليس تصدير جدول الفصول المدعوم. صدّر جدول الفصول من تايم تيبل بصيغة Excel أو HTML.')
    content=message.get_payload(decode=True)
    if not content: raise ValueError('ملف الجدول فارغ.')
    charset=message.get_content_charset() or 'utf-8'
    try: text=content.decode(charset)
    except (LookupError,UnicodeDecodeError): raise ValueError('تعذر قراءة ترميز الملف.')
    parser=Tables(); parser.feed(text)
    if len(parser.tables)!=1: raise ValueError('يجب أن يحتوي الملف على جدول فصول واحد واضح.')
    rows=parser.tables[0]
    if len(rows)<3: raise ValueError('جدول الفصول غير مكتمل.')
    headers=[normalize(x) for x in rows[0]]
    day_lookup={normalize(name):i for i,name in enumerate(DAYS)}
    days=[]
    for value in headers:
        if value in day_lookup: days.append(day_lookup[value])
    if not days or days != list(range(len(days))): raise ValueError('تعذر تحديد أيام الجدول وترتيبها.')
    second=[normalize(x) for x in rows[1]]
    if not second or second[0] not in ('الشعبه','الفصل','الصف'): raise ValueError('تعذر تحديد عمود الفصل وأرقام الحصص.')
    period_values=[]
    for cell in second[1:]:
        try: number=int(cell.translate(str.maketrans('٠١٢٣٤٥٦٧٨٩','0123456789')))
        except ValueError: raise ValueError('تعذر قراءة رقم إحدى الحصص.')
        if number<1 or number>12: raise ValueError('رقم حصة خارج الحدود المدعومة.')
        period_values.append(number)
    blocks=[]
    for number in period_values:
        if number==1: blocks.append([])
        if not blocks or number!=len(blocks[-1])+1: raise ValueError('ترتيب أرقام الحصص غير واضح.')
        blocks[-1].append(number)
    if len(blocks)!=len(days): raise ValueError('لا تتطابق أيام الجدول مع مجموعات الحصص.')
    slots=[(day,period) for day,block in zip(days,blocks) for period in block]
    lessons=[]; classes=[]; teacher_names=set(); issues=[]
    for row in rows[2:]:
        if not any(str(c).strip() for c in row): continue
        class_name=' '.join(row[0].split()) if row else ''
        if not class_name or len(row)!=len(slots)+1: raise ValueError('أحد صفوف الفصول لا يطابق عدد خانات الحصص.')
        if class_name in classes: raise ValueError('يوجد فصل مكرر في الملف: '+class_name)
        classes.append(class_name)
        for slot,cell in zip(slots,row[1:]):
            parts=[' '.join(part.split()) for part in cell.split('\n') if part.strip()]
            if not parts: continue
            if len(parts)!=2:
                issues.append({'className':class_name,'day':DAYS[slot[0]],'period':slot[1]}); continue
            subject,teacher=parts
            teacher_names.add(teacher)
            lessons.append({'className':class_name,'day':slot[0],'period':slot[1],'subject':subject,'teacher':teacher})
    if not classes or not lessons: raise ValueError('لم تُعثر حصص قابلة للقراءة في الملف.')
    return {'days':days,'blocks':blocks,'classes':classes,'teachers':sorted(teacher_names),'lessons':lessons,'issues':issues}


def build_project(parsed, current, teacher_names, class_names):
    """Build a separate candidate. Existing records are copied, never modified in place."""
    import copy
    import uuid
    from collections import Counter
    if parsed['issues']:
        raise ValueError('توجد حصص لا يمكن قراءتها؛ صحح الملف قبل اعتماد الاستيراد.')
    if set(teacher_names)!=set(parsed['teachers']) or set(class_names)!=set(parsed['classes']):
        raise ValueError('راجع جميع أسماء المعلمين والفصول قبل الاعتماد.')
    teachers_clean={name:' '.join(str(teacher_names[name]).split()) for name in parsed['teachers']}
    classes_clean={name:' '.join(str(class_names[name]).split()) for name in parsed['classes']}
    if any(not v or len(v)>180 for v in teachers_clean.values()) or any(not v or len(v)>160 for v in classes_clean.values()):
        raise ValueError('أكمل أسماء المعلمين والفصول.')
    if len({normalize(v) for v in teachers_clean.values()}) != len(teachers_clean):
        raise ValueError('يوجد اسمان متطابقان للمعلمين بعد التعديل. راجع الأسماء.')
    if len({normalize(v) for v in classes_clean.values()}) != len(classes_clean):
        raise ValueError('يوجد اسمان متطابقان للفصول بعد التعديل.')
    # Do not silently replace a school which already has timetable/absence data.
    # The candidate can be reviewed without changing the live workspace.
    candidate={'teachers':[], 'classes':[], 'courses':[], 'placements':[], 'slots':[], 'days':[]}
    old_slots={(slot.get('day'),slot.get('period')):slot for slot in current.get('slots',[])}
    for day,block in zip(parsed['days'],parsed['blocks']):
        candidate['days'].append({'name':DAYS[day], 'count':len(block)})
        for period in block:
            old=old_slots.get((day,period-1),{})
            candidate['slots'].append({'day':day,'period':period-1,'start':old.get('start',''),'end':old.get('end','')})
    teacher_ids={}; class_ids={}; courses={}; occupied=set()
    existing={}
    for teacher in current.get('teachers',[]):
        existing.setdefault(normalize(teacher.get('name','')),[]).append(teacher)
    reused=set()
    for name in parsed['teachers']:
        matches=existing.get(normalize(teachers_clean[name]),[])
        prior=matches[0] if len(matches)==1 else None
        item={'id':str(prior['id']) if prior else uuid.uuid4().hex,'name':teachers_clean[name],'short':name,'max':0,'blocked':[]}
        if prior:
            reused.add(item['id'])
            if prior.get('whatsapp'): item['whatsapp']=prior['whatsapp']
        teacher_ids[name]=item['id'];candidate['teachers'].append(item)
    for name in parsed['classes']:
        item={'id':uuid.uuid4().hex,'name':classes_clean[name]};class_ids[name]=item['id'];candidate['classes'].append(item)
    slot_ids={(slot['day'],slot['period']+1):i for i,slot in enumerate(candidate['slots'])}
    for lesson in parsed['lessons']:
        slot=slot_ids[(lesson['day'],lesson['period'])]
        key=(lesson['className'],lesson['subject'],lesson['teacher'])
        busy=(lesson['teacher'],slot)
        if busy in occupied: raise ValueError('المعلم '+teachers_clean[lesson['teacher']]+' مسند لأكثر من فصل في الحصة نفسها. راجع الملف.')
        occupied.add(busy)
        if key not in courses:
            item={'id':uuid.uuid4().hex,'classId':class_ids[key[0]],'subject':key[1], 'short':key[1], 'teacherId':teacher_ids[key[2]],'count':0,'pairs':0,'room':''}
            courses[key]=item;candidate['courses'].append(item)
        courses[key]['count']+=1
        candidate['placements'].append({'courseId':courses[key]['id'],'slot':slot})
    loads=Counter(c['teacherId'] for c in candidate['courses'] for _ in range(c['count']))
    for teacher in candidate['teachers']: teacher['max']=max(24,loads[teacher['id']])
    if current.get('absenceRecords') or current.get('signatureTasks'):
        for old in current.get('teachers',[]):
            if str(old.get('id')) not in reused:
                old_copy=copy.deepcopy(old); old_copy['blocked']=list(range(len(candidate['slots']))); old_copy['max']=0
                candidate['teachers'].append(old_copy)
    return candidate
