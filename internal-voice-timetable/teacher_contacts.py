"""Import teacher mobile numbers from official school staff Excel reports."""
from __future__ import annotations

import base64
import io
import re
import unicodedata

import openpyxl

from signature_tasks import normalize_phone


def header_key(value):
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = re.sub("[إأآ]", "ا", text).replace("ى", "ي").replace("ة", "ه")
    return re.sub(r"[\s_\-:ـ\u064b-\u065f]", "", text)


NAME_HEADERS = {header_key(value) for value in [
    "الاسم", "اسم المعلم", "اسم المعلمة", "اسم الموظف", "اسم الموظفة",
    "الاسم الكامل", "اسم المعلم الكامل", "المعلم", "teacher name", "name",
]}
PHONE_HEADERS = {header_key(value) for value in [
    "الجوال", "رقم الجوال", "رقم جوال", "الجوال الشخصي", "رقم الهاتف الجوال",
    "رقم الهاتف", "الهاتف", "mobile", "mobile number", "phone",
]}


def name_key(value):
    text = unicodedata.normalize("NFKC", str(value or "")).strip().lower()
    text = re.sub("[إأآ]", "ا", text).replace("ى", "ي").replace("ة", "ه")
    text = re.sub(r"[\u064b-\u065f]", "", text)
    # التقارير الرسمية قد تكتب «عبدالله» بينما تستخدم المدرسة «عبد الله».
    text = re.sub(r"عبد\s*(الله|الرحمن|العزيز|الملك|الكريم|المجيد)", r"عبد \1", text)
    words = re.findall(r"[\u0621-\u064aa-z0-9]+", text)
    return " ".join(word for word in words if word not in {"بن", "ابن", "بنت"})


def _match_teacher(source_name, teachers):
    source = name_key(source_name)
    if not source:
        return []
    source_words = source.split()
    exact = [teacher for teacher in teachers if name_key(teacher.get("name")) == source]
    if exact:
        return exact
    candidates = []
    for teacher in teachers:
        words = name_key(teacher.get("name")).split()
        if len(source_words) >= 2 and len(words) >= 2:
            if source_words[0] == words[0] and (source_words[1] == words[1] or source_words[-1] == words[-1]):
                candidates.append(teacher)
    return candidates


def extract_contacts(encoded):
    try:
        raw = base64.b64decode(str(encoded or ""), validate=True)
    except Exception as error:
        raise ValueError("تعذر قراءة ملف Excel المرفوع.") from error
    if not raw or len(raw) > 3_000_000:
        raise ValueError("حجم ملف Excel يجب أن يكون بين 1 بايت و3 ميجابايت.")
    try:
        workbook = openpyxl.load_workbook(io.BytesIO(raw), data_only=True, read_only=True)
    except Exception as error:
        raise ValueError("الملف ليس Excel صالحًا بصيغة XLSX.") from error
    try:
        sheets = []
        for sheet in workbook.worksheets:
            header = None
            for row_number, row in enumerate(sheet.iter_rows(max_row=40, values_only=True), start=1):
                names = [index for index, value in enumerate(row) if header_key(value) in NAME_HEADERS]
                phones = [index for index, value in enumerate(row) if header_key(value) in PHONE_HEADERS]
                if len(names) == 1 and len(phones) == 1:
                    header = (row_number, names[0], phones[0])
                    break
            if header:
                sheets.append((sheet, *header))
        if not sheets:
            raise ValueError("لم أجد عمودي «الاسم» و«الجوال» في أول 40 صفًا من الملف.")
        if len(sheets) > 1:
            raise ValueError("وجدت أكثر من ورقة تحتوي أعمدة الاسم والجوال. استخدم ملفًا بورقة بيانات واحدة.")
        sheet, header_row, name_column, phone_column = sheets[0]
        contacts, seen = [], set()
        for row in sheet.iter_rows(min_row=header_row + 1, values_only=True):
            name = str(row[name_column] or "").strip() if name_column < len(row) else ""
            phone = row[phone_column] if phone_column < len(row) else ""
            if not name or not str(phone or "").strip():
                continue
            try:
                normalized_phone = normalize_phone(phone)
            except ValueError:
                continue
            key = name_key(name)
            if not key or key in seen:
                continue
            seen.add(key)
            contacts.append({"name": name, "phone": normalized_phone})
        if not contacts:
            raise ValueError("لم أجد صفوفًا صالحة تحتوي اسمًا ورقم جوال سعوديًا.")
        return contacts, {"sheet": sheet.title, "headerRow": header_row}
    finally:
        workbook.close()


def contact_preview(encoded, teachers):
    contacts, source = extract_contacts(encoded)
    matched, unmatched, ambiguous = [], [], []
    for contact in contacts:
        candidates = _match_teacher(contact["name"], teachers)
        if len(candidates) == 1:
            matched.append({**contact, "teacherId": candidates[0].get("id"), "teacherName": candidates[0].get("name", "")})
        elif len(candidates) > 1:
            ambiguous.append({**contact, "candidates": [teacher.get("name", "") for teacher in candidates]})
        else:
            unmatched.append(contact)
    rows = []
    for item in matched:
        rows.append({**item, "status": "matched", "candidates": []})
    for item in unmatched:
        rows.append({**item, "status": "unmatched", "teacherId": "", "teacherName": "", "candidates": []})
    for item in ambiguous:
        rows.append({**item, "status": "ambiguous", "teacherId": "", "teacherName": "", "candidates": item.get("candidates", [])})
    return {"source": source, "total": len(contacts), "matched": matched, "unmatched": unmatched, "ambiguous": ambiguous, "rows": rows}


def apply_contacts(project, encoded, manual_mappings=None):
    preview = contact_preview(encoded, project.get("teachers", []))
    teachers = {teacher.get("id"): teacher for teacher in project.get("teachers", [])}
    selected = {item["name"]: item["teacherId"] for item in preview["matched"]}
    for source_name, teacher_id in (manual_mappings or {}).items():
        if source_name in {item["name"] for item in preview["rows"]}:
            selected[source_name] = str(teacher_id or "")
    used, imported = set(), 0
    for row in preview["rows"]:
        teacher_id = selected.get(row["name"], "")
        if teacher_id not in teachers or teacher_id in used:
            continue
        teachers[teacher_id]["whatsapp"] = row["phone"]
        used.add(teacher_id)
        imported += 1
    preview["imported"] = imported
    return project, preview
