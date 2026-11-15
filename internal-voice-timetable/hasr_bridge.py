"""Synchronize embedded school standby assignments with the school portal."""
import datetime
import json
import os
import time
import uuid
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


def sync_coverages(project, date_text, user_id, embedded):
    if not embedded:
        return
    prefix = 'hasr-school:'
    if not str(user_id or '').startswith(prefix):
        raise ValueError('Invalid embedded school context')
    school_id = str(uuid.UUID(str(user_id)[len(prefix):]))
    url = os.environ.get('HASR_BRIDGE_URL', '').strip()
    secret = os.environ.get('VOICE_TIMETABLE_BRIDGE_SECRET', '').strip()
    if not url or not secret:
        raise RuntimeError('Standby bridge is not configured')
    entries = []
    for record in project.get('absenceRecords', []):
        if str(record.get('date', '')) != str(date_text):
            continue
        for entry in record.get('entries', []):
            replacement = str(entry.get('replacementName') or '').strip()
            if not replacement:
                continue
            entries.append({
                'recordId': str(record.get('id', '')),
                'entryKey': f"{entry.get('absentId', '')}:{entry.get('slot', '')}",
                'period': entry.get('period'),
                'className': entry.get('className', ''),
                'subject': entry.get('subject', ''),
                'absentName': entry.get('absentName', ''),
                'replacementName': replacement,
            })
    payload = json.dumps({'schoolId': school_id, 'date': date_text, 'entries': entries}, ensure_ascii=False).encode('utf-8')
    request = Request(url, data=payload, headers={'Content-Type': 'application/json; charset=utf-8', 'X-Voice-Bridge-Secret': secret}, method='POST')
    with urlopen(request, timeout=10) as response:
        result = json.load(response)
    if not result.get('ok'):
        raise RuntimeError('Standby assignments could not be linked to the school schedule')
    return result


def reconcile_today(auth, project_lock):
    # Reconcile existing assignments after restart, without copying other schools' data.
    for attempt in range(5):
        try:
            today = datetime.datetime.now(ZoneInfo('Asia/Riyadh')).date().isoformat()
            with project_lock:
                with auth._connect() as db:
                    projects = list(db.execute('SELECT user_id, payload FROM projects WHERE user_id LIKE ?', ('hasr-school:%',)))
                for row in projects:
                    project = json.loads(row['payload'])
                    if any(str(record.get('date', '')) == today for record in project.get('absenceRecords', [])):
                        sync_coverages(project, today, row['user_id'], True)
            return
        except Exception as error:
            print('Standby reconciliation failed:', type(error).__name__, flush=True)
            time.sleep(3)
