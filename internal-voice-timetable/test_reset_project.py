import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import ThreadingHTTPServer
import server


class ResetProjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name)/'project.json'
        self.original = server.empty_project(12)
        self.original.update(school={'name':'مدرسة الاختبار'}, teachers=[{'id':'t1'}],
                             classes=[{'id':'c1'}], courses=[{'id':'m1'}], placements=[{'slot':1}],
                             savedSchedules=[{'name':'جدول محفوظ'}], standby={'assignments':[1]},
                             absenceRecords=[{'date':'2026-10-23'}], privateNote='temporary')
        self.state.write_text(json.dumps(self.original),encoding='utf-8')
        self.state_patch=patch.object(server,'STATE',self.state)
        self.state_patch.start()
        self.http=ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True)
        self.thread.start()

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        self.state_patch.stop()
        self.temp.cleanup()

    def post(self,path,body):
        connection=http.client.HTTPConnection('127.0.0.1',self.http.server_port)
        connection.request('POST','/api/'+path,json.dumps(body),{'Content-Type':'application/json'})
        response=connection.getresponse()
        result=response.status,json.loads(response.read())
        connection.close()
        return result

    def test_confirmation_required_and_cancellation_keeps_data(self):
        for confirmation in [False, None, 'true']:
            status,_=self.post('reset-project',{'confirm':confirmation,'revision':12})
            self.assertEqual(status,422)
            self.assertEqual(json.loads(self.state.read_text(encoding='utf-8')),self.original)

    def test_stale_confirmation_cannot_reset(self):
        status,_=self.post('reset-project',{'confirm':True,'revision':11})
        self.assertEqual(status,409)
        self.assertEqual(json.loads(self.state.read_text(encoding='utf-8')),self.original)

    def test_reset_clears_all_project_data_and_blocks_old_save(self):
        status,result=self.post('reset-project',{'confirm':True,'revision':12})
        self.assertEqual(status,200)
        self.assertEqual(result['project'],server.empty_project(13))
        self.assertEqual(json.loads(self.state.read_text(encoding='utf-8')),server.empty_project(13))
        stale=server.empty_project(12)
        stale['school']['name']='مدرسة قديمة'
        status,_=self.post('save',stale)
        self.assertEqual(status,409)
        self.assertEqual(json.loads(self.state.read_text(encoding='utf-8')),server.empty_project(13))


if __name__=='__main__':
    unittest.main()
