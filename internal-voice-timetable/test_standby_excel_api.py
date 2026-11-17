"""Exercise preview and approval against a disposable local server and workbook."""
import base64
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from openpyxl import Workbook

class WaitingImportApiTest(unittest.TestCase):
    def test_preview_and_approval_are_isolated_and_revision_checked(self):
        root = Path(__file__).resolve().parent
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp)
            for source in root.glob('*.py'): shutil.copy2(source, target / source.name)
            # This isolated endpoint does not call the emergency helpers. Some
            # local checkouts predate them, while production supplies them.
            absence = target / 'absence.py'
            source = absence.read_text(encoding='utf8')
            for helper in ('extreme_candidates', 'assign_extreme_candidate'):
                if f'def {helper}(' not in source:
                    source += f'\ndef {helper}(*args, **kwargs): raise NotImplementedError()\n'
            absence.write_text(source, encoding='utf8')
            (target / 'data').mkdir()
            project = {'setupVersion': 2, 'revision': 1, 'school': {'term': 'الأول'}, 'days': [{'name': 'الأحد'}],
                       'slots': [{'day': 0, 'period': 0}], 'teachers': [{'id': 't', 'name': 'أحمد علي', 'short': 'أحمد', 'blocked': []}],
                       'classes': [], 'courses': [], 'placements': [{'courseId': 'ignored', 'slot': 0}], 'absenceRecords': [{'id': 'history'}]}
            (target / 'data' / 'project.json').write_text(json.dumps(project, ensure_ascii=False), encoding='utf8')
            workbook = Workbook(); sheet = workbook.active
            for row in [['الأحد'], ['الانتظار', 'الحصة 1'], ['انتظار 1', 'أحمد']]: sheet.append(row)
            file = target / 'sample.xlsx'; workbook.save(file)
            with socket.socket() as listener:
                listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
            env = {**os.environ, 'NASQ_PORT': str(port), 'NASQ_BIND': '127.0.0.1', 'SOUNDTABLE_AUTH': '0', 'HASR_EMBEDDED': '0'}
            error_log = (target / 'server-errors.log').open('w+', encoding='utf8')
            process = subprocess.Popen([sys.executable, 'server.py'], cwd=target, env=env, stdout=subprocess.DEVNULL, stderr=error_log)
            def request(path, body=None):
                data = json.dumps(body).encode() if body is not None else None
                req = Request(f'http://127.0.0.1:{port}/api/{path}', data=data, headers={'Content-Type': 'application/json'})
                try:
                    with urlopen(req, timeout=3) as response: return response.status, json.load(response)
                except HTTPError as error: return error.code, json.load(error)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        error_log.seek(0)
                        self.fail('test server stopped: ' + error_log.read())
                    try: status, current = request('project'); break
                    except URLError: time.sleep(.1)
                else: self.fail('test server did not start')
                payload = {'file': base64.b64encode(file.read_bytes()).decode(), 'revision': current['revision'],
                           'schedule': {key: current[key] for key in ('placements','slots','teachers','courses','days')}}
                status, preview = request('standby-excel-preview', payload)
                self.assertEqual(status, 200); self.assertEqual(preview['summary']['unmatched'], 0)
                self.assertEqual(request('project')[1].get('standby'), None)
                status, imported = request('standby-excel-import', payload)
                self.assertEqual(status, 200); self.assertEqual(imported['count'], 1)
                self.assertEqual(imported['project']['absenceRecords'], project['absenceRecords'])
                self.assertEqual(imported['project']['standby']['assignments'][0]['teacherId'], 't')
                self.assertEqual(request('standby-excel-import', payload)[0], 409)
            finally:
                process.terminate()
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
                error_log.close()

if __name__ == '__main__': unittest.main()
