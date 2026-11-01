import os
import unittest
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse

import copilot_auth


class CopilotOAuthStateTests(unittest.TestCase):
    def setUp(self):
        self.environment = patch.dict(os.environ, {
            copilot_auth.CLIENT_ID_ENV: 'local-test-client',
            copilot_auth.CLIENT_SECRET_ENV: 'local-test-secret',
            copilot_auth.REDIRECT_URI_ENV: copilot_auth.DEFAULT_REDIRECT_URI,
        })
        self.environment.start()

    def tearDown(self):
        self.environment.stop()
        with copilot_auth._lock:
            copilot_auth._login_states.clear()
            copilot_auth._connections.clear()
            copilot_auth._conversation_history.clear()

    def test_login_state_is_bound_to_session_and_one_time(self):
        auth_url, state = copilot_auth.begin_login('browser-school-a')
        query = parse_qs(urlparse(auth_url).query)

        self.assertEqual(query['client_id'], ['local-test-client'])
        self.assertEqual(query['redirect_uri'], [copilot_auth.DEFAULT_REDIRECT_URI])
        self.assertEqual(query['state'], [state])
        with self.assertRaises(copilot_auth.CopilotAuthError):
            copilot_auth.finish_login('browser-school-b', state, 'unused-code')
        with self.assertRaises(copilot_auth.CopilotAuthError):
            copilot_auth.finish_login('browser-school-a', state, 'unused-code')

    def test_disconnect_only_removes_the_matching_session(self):
        with copilot_auth._lock:
            copilot_auth._connections['browser-school-a'] = {'login': 'school-a'}
            copilot_auth._connections['browser-school-b'] = {'login': 'school-b'}
            copilot_auth._conversation_history['browser-school-a'] = [('المستخدم', 'a')]
            copilot_auth._conversation_history['browser-school-b'] = [('المستخدم', 'b')]

        copilot_auth.disconnect('browser-school-a')

        self.assertFalse(copilot_auth.status('browser-school-a')['connected'])
        self.assertTrue(copilot_auth.status('browser-school-b')['connected'])
        self.assertNotIn('browser-school-a', copilot_auth._conversation_history)
        self.assertEqual(copilot_auth._conversation_history['browser-school-b'], [('المستخدم', 'b')])

    def test_oauth_is_unavailable_without_app_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(copilot_auth.oauth_configured())
            with self.assertRaises(copilot_auth.CopilotAuthError):
                copilot_auth.begin_login('local-school')


if __name__ == '__main__':
    unittest.main()