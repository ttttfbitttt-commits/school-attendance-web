"""Secure, one-task signature links for absence-cover assignments."""
from __future__ import annotations

import base64
import datetime
import re
import secrets
import uuid

PHONE_RE = re.compile(r"^9665\d{8}$")
PNG_RE = re.compile(r"^data:image/png;base64,([A-Za-z0-9+/=]+)$")

def normalize_phone(value: str) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit())
    if digits.startswith("00"): digits = digits[2:]
    if digits.startswith("0"): digits = "966" + digits[1:]
    if digits.startswith("5"): digits = "966" + digits
    if not PHONE_RE.fullmatch(digits):
        raise ValueError("رقم الجوال يجب أن يكون رقمًا سعوديًا صحيحًا، مثل 05xxxxxxxx أو 9665xxxxxxxx.")
    return digits

def public_task(project: dict, task: dict) -> dict:
    record = next((item for item in project.get("absenceRecords", []) if item.get("id") == task.get("recordId")), {})
    entry = next((item for item in record.get("entries", []) if item.get("signatureTaskId") == task.get("id")), {})
    return {"id":task.get("id"),"status":task.get("status","pending"),"teacher":task.get("teacherName",""),"phone":task.get("phone",""),"date":record.get("date",""),"day":record.get("day",""),"absentTeacher":entry.get("absentName",""),"className":entry.get("className",""),"subject":entry.get("subject",""),"period":entry.get("period",""),"start":entry.get("start",""),"end":entry.get("end",""),"signedAt":task.get("signedAt","")}

def prepare_tasks(project: dict, record_id: str, sender_phone: str, phones: dict[str, str], base_url: str) -> tuple[dict, list[dict]]:
    record = next((item for item in project.get("absenceRecords", []) if item.get("id") == record_id), None)
    if not record: raise ValueError("لم يُعثر على سجل الغياب.")
    project.setdefault("signatureSettings", {})["senderPhone"] = normalize_phone(sender_phone)
    teachers = {item.get("id"):item for item in project.get("teachers", [])}
    for teacher_id,phone in (phones or {}).items():
        if teacher_id in teachers and str(phone or "").strip(): teachers[teacher_id]["whatsapp"] = normalize_phone(phone)
    tasks=project.setdefault("signatureTasks", []); result=[]
    for entry in record.get("entries", []):
        teacher_id=entry.get("replacementId")
        if not teacher_id or teacher_id not in teachers: continue
        key=f"{entry.get('absentId')}:{entry.get('slot')}"
        task=next((item for item in tasks if item.get("recordId")==record_id and item.get("entryKey")==key and item.get("teacherId")==teacher_id),None)
        if task is None:
            task={"id":uuid.uuid4().hex,"token":secrets.token_urlsafe(32),"recordId":record_id,"entryKey":key,"teacherId":teacher_id,"teacherName":teachers[teacher_id].get("name",""),"phone":teachers[teacher_id].get("whatsapp",""),"status":"pending","createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat()}; tasks.append(task)
        else:
            phone = teachers[teacher_id].get("whatsapp",task.get("phone",""))
            if phone != task.get("phone",""):
                task.pop("whatsappOpenedAt", None)
                task.pop("whatsappConfirmedAt", None)
            task["phone"] = phone
        if task.get("status") != "signed" and not task.get("token"):
            task["token"] = secrets.token_urlsafe(32)
        entry["signatureTaskId"]=task["id"]
        token = task.get("token") if task.get("status") != "signed" else None
        result.append({**public_task(project,task),"link":f"{base_url.rstrip('/')}/signature.html?token={token}" if token else ""})
    return project,result

def find_task(project: dict, token: str):
    if not token: return None
    task=next((item for item in project.get("signatureTasks",[]) if item.get("token") and secrets.compare_digest(str(item["token"]),str(token))),None)
    if not task:return None
    record=next((item for item in project.get("absenceRecords",[]) if item.get("id")==task.get("recordId")),None)
    entry=next((item for item in (record or {}).get("entries",[]) if item.get("signatureTaskId")==task.get("id")),None)
    return (task,record,entry) if record and entry else None

def mark_whatsapp_action(project: dict, record_id: str, task_id: str, action: str) -> dict:
    """Track an opened link separately from a sender's explicit confirmation."""
    if action not in ("opened", "confirm", "undo"):
        raise ValueError("الإجراء غير صالح.")
    record = next((item for item in project.get("absenceRecords", []) if item.get("id") == record_id), None)
    task = next((item for item in project.get("signatureTasks", []) if item.get("id") == task_id and item.get("recordId") == record_id), None)
    if not record or not task or not any(item.get("signatureTaskId") == task_id for item in record.get("entries", [])):
        raise ValueError("لم يُعثر على التكليف.")
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    if action == "opened":
        task["whatsappOpenedAt"] = now
    elif action == "confirm":
        task["whatsappConfirmedAt"] = now
    else:
        task.pop("whatsappConfirmedAt", None)
    return task

def submit_signature(project: dict, token: str, signature: str) -> dict:
    found=find_task(project,token)
    if not found: raise ValueError("رابط التوقيع غير صالح أو تم استخدامه.")
    task,record,entry=found; matched=PNG_RE.fullmatch(str(signature or ""))
    if not matched: raise ValueError("ارسم توقيعك داخل المربع ثم أعد الإرسال.")
    try:image=base64.b64decode(matched.group(1),validate=True)
    except ValueError as error: raise ValueError("صيغة التوقيع غير صالحة.") from error
    if not 200<len(image)<=400_000: raise ValueError("حجم التوقيع غير صالح.")
    now=datetime.datetime.now(datetime.timezone.utc).isoformat(); entry.update({"signature":signature,"signatureStatus":"signed","signatureSignedAt":now}); task.update({"status":"signed","signedAt":now}); task.pop("token",None); record["updatedAt"]=now
    return public_task(project,task)
