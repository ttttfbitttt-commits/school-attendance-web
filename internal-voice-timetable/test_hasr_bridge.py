import io
import json
import os
import unittest
from unittest.mock import patch
import hasr_bridge

SCHOOL = 'hasr-school:12345678-1234-4234-8234-123456789abc'
PROJECT = {'absenceRecords': [{'id': 'r1', 'date': '2026-11-15', 'entries': [{'absentId': 'a', 'slot': 3, 'period': 4, 'className': 'class', 'replacementName': 'teacher'}]}]}

class Response(io.BytesIO):
    def __enter__(self): return self
    def __exit__(self, *args): self.close()

class BridgeTests(unittest.TestCase):
    @patch.dict(os.environ, {'HASR_BRIDGE_URL': 'http://example.test', 'VOICE_TIMETABLE_BRIDGE_SECRET': 'test'})
    def test_payload_and_cancellation(self):
        with patch.object(hasr_bridge, 'urlopen', side_effect=lambda req, timeout: Response(b'{"ok":true}')) as send:
            hasr_bridge.sync_coverages(PROJECT, '2026-11-15', SCHOOL, True)
            data = json.loads(send.call_args.args[0].data)
            self.assertEqual(data['schoolId'], SCHOOL.split(':', 1)[1])
            self.assertEqual(data['entries'][0]['entryKey'], 'a:3')
            hasr_bridge.sync_coverages({'absenceRecords': []}, '2026-11-15', SCHOOL, True)
            self.assertEqual(json.loads(send.call_args.args[0].data)['entries'], [])
    @patch.dict(os.environ, {'HASR_BRIDGE_URL': 'http://example.test', 'VOICE_TIMETABLE_BRIDGE_SECRET': 'test'})
    def test_missing_schedule_and_wrong_context(self):
        with patch.object(hasr_bridge, 'urlopen', return_value=Response(b'{"ok":true,"noSchedule":true}')):
            self.assertTrue(hasr_bridge.sync_coverages(PROJECT, '2026-11-15', SCHOOL, True)['noSchedule'])
        with self.assertRaises(ValueError): hasr_bridge.sync_coverages(PROJECT, '2026-11-15', 'wrong', True)
        self.assertIsNone(hasr_bridge.sync_coverages(PROJECT, '2026-11-15', 'wrong', False))

if __name__ == '__main__': unittest.main()
