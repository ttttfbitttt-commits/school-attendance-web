"""Isolated end-to-end check for the signing-link workflow; never sends WhatsApp."""
import base64

from absence import official_html
from signature_tasks import find_task, prepare_tasks, public_task, submit_signature


project = {
    "school": {"name": "Test school", "year": "1448", "term": "Term 1", "stage": "Secondary"},
    "courses": [], "placements": [], "slots": [], "days": [],
    "teachers": [{"id": "abs", "name": "Absent teacher"}, {"id": "cover", "name": "Cover teacher"}],
    "absenceRecords": [{
        "id": "record-test", "date": "2026-10-30", "day": "Thursday",
        "teachers": [{"id": "abs", "name": "Absent teacher"}],
        "entries": [{"absentId": "abs", "absentName": "Absent teacher", "replacementId": "cover", "replacementName": "Cover teacher", "className": "Class 1", "subject": "Math", "period": 2, "slot": 1, "start": "07:45", "end": "08:30", "rank": "1", "execution": "", "notes": ""}],
    }],
}
project, tasks = prepare_tasks(project, "record-test", "0500000000", {"cover": "0555555555"}, "https://soundtable.7asr2030.com")
assert len(tasks) == 1 and tasks[0]["link"].startswith("https://soundtable.7asr2030.com/signature.html?token=")
assert tasks[0]["phone"] == "966555555555"
token = project["signatureTasks"][0]["token"]
assert public_task(project, find_task(project, token)[0])["className"] == "Class 1"
signature = "data:image/png;base64," + base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"x" * 260).decode()
submit_signature(project, token, signature)
assert project["signatureTasks"][0]["status"] == "signed" and "token" not in project["signatureTasks"][0]
assert "data:image/png;base64," in official_html(project, project["absenceRecords"][0])
print("PASS: signing link, task display, signature submission, and official form rendering all work. No WhatsApp request was made.")
