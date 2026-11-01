from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import auth


class AuthProjectIsolationTests(unittest.TestCase):
    def test_projects_are_isolated_by_user_id(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(auth, "DB_PATH", Path(temp) / "auth.sqlite3"):
                auth.init_db()
                with auth._connect() as db:
                    db.executemany(
                        "INSERT INTO users(id,email,password_hash,verified,created_at) VALUES(?,?,?,?,?)",
                        [
                            ("school-a", "a@example.test", "unused", 1, 0),
                            ("school-b", "b@example.test", "unused", 1, 0),
                        ],
                    )

                factory = lambda: {"school": {"name": ""}}
                project_a = auth.load_project("school-a", factory)
                project_b = auth.load_project("school-b", factory)
                project_a["school"]["name"] = "مدرسة أ"
                auth.save_project("school-a", project_a)

                self.assertEqual(auth.load_project("school-a", factory)["school"]["name"], "مدرسة أ")
                self.assertEqual(auth.load_project("school-b", factory)["school"]["name"], "")


if __name__ == "__main__":
    unittest.main()
