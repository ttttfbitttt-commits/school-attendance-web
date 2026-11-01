"""Read teacher names and weekly limits without importing other workbook data."""
import base64
import io
import re
import unicodedata
import uuid
import openpyxl


def header_key(value):
    text = unicodedata.normalize('NFKC', str(value or '')).strip().lower()
    text = re.sub('[إأآ]', 'ا', text).replace('ى', 'ي').replace('ة', 'ه')
    return re.sub(r'[\s_\-:ـ\u064b-\u065f]', '', text)


NAME_HEADERS = {header_key(v) for v in ['name', 'teacher name', 'الاسم', 'اسم المعلم', 'المعلم', 'الاسم الكامل', 'اسم المعلم الكامل', 'أسماء المعلمين']}
LIMIT_HEADERS = {header_key(v) for v in ['max_classes', 'النصاب', 'النصاب المعتمد', 'الحد الأعلى', 'نصاب المعلم', 'عدد الحصص', 'النصاب الأسبوعي', 'عدد الحصص الأسبوعية']}


def teacher_preview(encoded):
    raw = base64.b64decode(encoded, validate=True)
    if len(raw) > 3_000_000:
        raise ValueError('size')
    workbook = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    try:
        candidates = []
        for sheet in workbook:
            rows = list(sheet.iter_rows(max_row=1030, values_only=True))
            for index, row in enumerate(rows[:30]):
                names = [i for i, value in enumerate(row) if header_key(value) in NAME_HEADERS]
                limits = [i for i, value in enumerate(row) if header_key(value) in LIMIT_HEADERS]
                if names and limits:
                    if len(names) != 1 or len(limits) != 1:
                        raise ValueError('ambiguous headers')
                    candidates.append((rows[index+1:index+1001], names[0], limits[0]))
                    break
        if len(candidates) != 1:
            raise ValueError('missing or ambiguous teacher sheet')
        rows, name_col, limit_col = candidates[0]
        result, seen, shorts = [], set(), set()
        for row in rows:
            name = str(row[name_col] or '').strip()
            if not name or name in seen:
                continue
            value = row[limit_col]
            limit = float(str(value).strip())
            if not limit.is_integer() or not 0 <= limit <= 100:
                raise ValueError('limit')
            seen.add(name)
            words = name.split()
            short = words[0]+' '+words[-1] if len(words)>1 else name
            if short in shorts:
                for size in range(2, len(words)+1):
                    short = ' '.join(words[:size])
                    if short not in shorts:
                        break
            if short in shorts:
                short += ' '+str(len(result)+1)
            shorts.add(short)
            result.append({'id': uuid.uuid4().hex, 'name': name, 'short': short, 'max': int(limit), 'blocked': []})
        if not result:
            raise ValueError('empty')
        return result
    finally:
        workbook.close()
