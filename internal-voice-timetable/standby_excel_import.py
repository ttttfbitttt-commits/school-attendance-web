"""Read and safely validate an ordered weekly waiting-teacher workbook."""
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile, BadZipFile
import copy
import re
import openpyxl
from asc_import import normalize
from standby import context, signature

DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
DAY_KEYS = {normalize(day): day for day in DAYS}
DAY_KEYS.update({normalize('الإثنين'): 'الاثنين', normalize('الاثنين'): 'الاثنين'})
EMPTY = {normalize(value) for value in ('شاغر', 'فارغ', 'لا يوجد', 'غير مسند', '-', '—')}

def number(value):
    text = str(value or '').translate(str.maketrans('٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
    found = re.findall(r'\d+', text)
    return int(found[-1]) if len(found) == 1 else None

def parse_waiting_workbook(path):
    try:
        with ZipFile(path) as archive:
            if sum(item.file_size for item in archive.infolist()) > 30_000_000 or len(archive.infolist()) > 2000:
                raise ValueError('ملف Excel كبير جدًا بعد فك الضغط.')
        workbook = openpyxl.load_workbook(Path(path), read_only=True, data_only=False, keep_links=False)
    except (BadZipFile, OSError, KeyError) as error:
        raise ValueError('تعذرت قراءة ملف Excel. اختر ملف جدول الانتظار بصيغة xlsx.') from error
    tables = []
    try:
        if len(workbook.sheetnames) > 50: raise ValueError('يحتوي الملف على أوراق أكثر من الحد المسموح.')
        for sheet in workbook.worksheets:
            if sheet.max_row > 5000 or sheet.max_column > 80: raise ValueError('إحدى أوراق الملف كبيرة جدًا.')
            rows = list(sheet.iter_rows(values_only=True))
            day, columns, items, targets, seen_days, seen_rows, saw_table = None, {}, [], {}, set(), set(), False
            for row in rows:
                first = str(row[0] or '').strip() if row else ''
                day_name = DAY_KEYS.get(normalize(first))
                if day_name and not any(str(v or '').strip() for v in row[1:]):
                    if day_name in seen_days: raise ValueError('اليوم مكرر في ملف جدول الانتظار: ' + day_name)
                    day, columns = day_name, {}
                    seen_days.add(day_name)
                    continue
                if not day: continue
                first_norm = normalize(first)
                if first_norm in (normalize('الانتظار'), normalize('ترتيب الانتظار')):
                    parsed = [(index, number(value)) for index, value in enumerate(row[1:], 1) if str(value or '').strip()]
                    if not parsed or any(n is None or n < 1 or n > 12 for _, n in parsed) or len({n for _, n in parsed}) != len(parsed):
                        raise ValueError('تعذر تحديد أرقام الحصص في يوم ' + day)
                    columns = dict(parsed); saw_table = True
                    continue
                if columns and (first_norm.startswith(normalize('انتظار')) or first_norm.startswith(normalize('الانتظار'))):
                    rank = number(first)
                    if rank is None or not 1 <= rank <= 20 or (day, rank) in seen_rows:
                        raise ValueError('ترتيب الانتظار مكرر أو غير واضح في يوم ' + day)
                    seen_rows.add((day, rank))
                    for index, period in columns.items():
                        targets[(day, period)] = max(targets.get((day, period), 0), rank)
                        name = str(row[index] or '').strip() if index < len(row) else ''
                        if not name or normalize(name) in EMPTY: continue
                        if name.startswith('='): raise ValueError('تحتوي خلية الانتظار على معادلة. انسخ الأسماء كقيم ثابتة ثم أعد رفع الملف.')
                        if len(name) > 180 or '\n' in name: raise ValueError('اسم معلم غير واضح في ملف الانتظار.')
                        items.append({'day': day, 'period': period, 'rank': rank, 'name': name})
            if saw_table:
                if not items: raise ValueError('جدول الانتظار لا يحتوي على أسماء منتظرين.')
                tables.append({'sheet': sheet.title, 'entries': items, 'targets': targets})
    finally:
        workbook.close()
    if len(tables) != 1: raise ValueError('تعذر تحديد ورقة جدول انتظار واحدة؛ تأكد أن الملف يحتوي جدولًا بالأيام والحصص وترتيب المنتظرين.')
    return tables[0]

def preview_waiting_import(project, parsed, choices=None):
    if not project.get('placements') or not project.get('teachers') or not project.get('slots'):
        raise ValueError('استورد الجدول الدراسي والمعلمين أولًا قبل استيراد جدول الانتظار.')
    teachers = {str(t['id']): t for t in project['teachers']}
    aliases = defaultdict(set)
    for tid, teacher in teachers.items():
        for value in (teacher.get('name'), teacher.get('short')):
            if value: aliases[normalize(value)].add(tid)
    names = sorted({entry['name'] for entry in parsed['entries']})
    provided = choices if isinstance(choices, dict) else {}
    mapping, matches = {}, []
    for name in names:
        candidates = sorted(aliases.get(normalize(name), set()))
        selected = str(provided[name]) if name in provided else (candidates[0] if len(candidates) == 1 else '')
        if selected and selected not in teachers: raise ValueError('اختيار أحد المعلمين غير صالح. أعد المعاينة.')
        if selected: mapping[name] = selected
        matches.append({'name': name, 'teacherId': selected, 'auto': name not in provided and len(candidates) == 1,
                        'candidates': [{'id': tid, 'name': teachers[tid].get('name','')} for tid in candidates]})
    issues = []
    reverse = defaultdict(list)
    for name, tid in mapping.items(): reverse[tid].append(name)
    for tid, values in reverse.items():
        if len(values) > 1: issues.append('أكثر من اسم في الملف مرتبط بالمعلم نفسه: ' + teachers[tid].get('name',''))
    slot_lookup = {}
    for index, slot in enumerate(project['slots']):
        try:
            day_name = DAY_KEYS.get(normalize(project['days'][slot['day']]['name']))
            key = (day_name, int(slot['period']) + 1)
        except (KeyError, IndexError, TypeError, ValueError): raise ValueError('بيانات أيام الجدول الدراسي غير مكتملة.')
        if key in slot_lookup: raise ValueError('يوجد توقيت مكرر في الجدول الدراسي.')
        slot_lookup[key] = index
    busy, loads = context(project)
    excluded = set(project.get('standby', {}).get('config', {}).get('excluded', []))
    assignments, seen = [], set()
    for entry in parsed['entries']:
        slot = slot_lookup.get((entry['day'], entry['period']))
        if slot is None:
            issues.append(f"لا توجد حصة في الجدول: {entry['day']}، الحصة {entry['period']}.")
            continue
        tid = mapping.get(entry['name'])
        if not tid: continue
        teacher = teachers[tid]
        if (slot, tid) in seen:
            issues.append(f"المعلم {teacher.get('name','')} مكرر في {entry['day']}، الحصة {entry['period']}.")
        seen.add((slot, tid))
        if slot in busy.get(tid, set()) or slot in teacher.get('blocked', []):
            issues.append(f"المعلم {teacher.get('name','')} لديه حصة أو وقت مغلق في {entry['day']}، الحصة {entry['period']}.")
        if tid in excluded: issues.append('المعلم مستثنى حاليًا من الانتظار: ' + teacher.get('name',''))
        assignments.append({'slot': slot, 'teacherId': tid, 'rank': entry['rank']})
    issues = list(dict.fromkeys(issues))
    targets = {str(slot_lookup[key]): value for key, value in parsed['targets'].items() if key in slot_lookup}
    return {'sheet': parsed['sheet'], 'entries': len(parsed['entries']), 'matches': matches,
            'unmatched': sum(not row['teacherId'] for row in matches), 'issues': issues,
            'assignments': assignments, 'loads': loads, 'targets': targets}

def apply_waiting_import(project, preview):
    if preview['unmatched'] or preview['issues'] or len(preview['assignments']) != preview['entries']:
        raise ValueError('أكمل مطابقة الأسماء وصحح التعارضات قبل الاعتماد.')
    result = copy.deepcopy(project)
    old = result.get('standby') or {}
    config = copy.deepcopy(old.get('config') or {})
    counts = Counter(row['teacherId'] for row in preview['assignments'])
    target = max([int(config.get('target', 20) or 20), *(preview['loads'].get(tid, 0) + count for tid, count in counts.items())])
    if target > 100: raise ValueError('تجاوز نصاب أحد المعلمين الحد المسموح.')
    config.update({'target': target, 'count': max(preview['targets'].values(), default=max(row['rank'] for row in preview['assignments'])),
                   'excluded': list(config.get('excluded') or []), 'emergency': bool(config.get('emergency', False)),
                   'maxDistance': int(config.get('maxDistance', 2) or 2), 'farEmergency': bool(config.get('farEmergency', False))})
    result['standby'] = {'config': config, 'assignments': copy.deepcopy(preview['assignments']),
                         'quotas': {str(t['id']): counts.get(str(t['id']), 0) for t in result['teachers']},
                         'signature': signature(result), 'ruleVersion': 2, 'importedFromAscWaiting': True,
                         'importedSlotTargets': copy.deepcopy(preview['targets'])}
    if old:
        backup = copy.deepcopy(old)
        backup.pop('previousImportBackup', None)
        result['standby']['previousImportBackup'] = backup
    return result
