import unittest
from signature_tasks import find_task, mark_whatsapp_action, prepare_tasks, submit_signature
import base64

class WhatsAppStatusTest(unittest.TestCase):
    def setUp(self):
        self.project = {
            "teachers": [{"id": "t", "name": "Teacher", "whatsapp": "966555555555"}],
            "absenceRecords": [{"id": "r", "entries": [{"absentId": "a", "slot": 1, "replacementId": "t"}]}],
        }
        prepare_tasks(self.project, "r", "0500000000", {}, "https://example.com")
        self.task = self.project["signatureTasks"][0]

    def test_open_confirm_and_undo_are_distinct(self):
        mark_whatsapp_action(self.project, "r", self.task["id"], "opened")
        self.assertIn("whatsappOpenedAt", self.task)
        self.assertNotIn("whatsappConfirmedAt", self.task)
        mark_whatsapp_action(self.project, "r", self.task["id"], "confirm")
        self.assertIn("whatsappConfirmedAt", self.task)
        mark_whatsapp_action(self.project, "r", self.task["id"], "undo")
        self.assertNotIn("whatsappConfirmedAt", self.task)

    def test_rejects_missing_or_wrong_record_and_invalid_action(self):
        for record, task, action in [("other", self.task["id"], "confirm"), ("r", "other", "opened"), ("r", self.task["id"], "sent")]:
            with self.assertRaises(ValueError):
                mark_whatsapp_action(self.project, record, task, action)

    def test_changed_phone_clears_old_confirmation(self):
        mark_whatsapp_action(self.project, "r", self.task["id"], "opened")
        mark_whatsapp_action(self.project, "r", self.task["id"], "confirm")
        prepare_tasks(self.project, "r", "0500000000", {"t": "0555555556"}, "https://example.com")
        self.assertNotIn("whatsappConfirmedAt", self.task)
        self.assertNotIn("whatsappOpenedAt", self.task)

    def test_prepare_again_preserves_signed_assignment_and_other_links(self):
        self.project["teachers"].append({"id": "other", "name": "Other"})
        self.project["absenceRecords"][0]["entries"].append({"absentId": "a", "slot": 2, "replacementId": "other"})
        _, tasks = prepare_tasks(self.project, "r", "0500000000", {}, "https://example.com")
        other_token = self.project["signatureTasks"][1]["token"]
        signature = "data:image/png;base64," + base64.b64encode(b"x" * 260).decode()
        submit_signature(self.project, self.task["token"], signature)
        _, tasks = prepare_tasks(self.project, "r", "0500000000", {}, "https://example.com")
        self.assertEqual(tasks[0]["link"], "")
        self.assertEqual(self.project["signatureTasks"][1]["token"], other_token)
        self.assertEqual(self.project["absenceRecords"][0]["entries"][0]["signature"], signature)
        self.assertIsNone(find_task(self.project, ""))

    def test_unsigned_missing_token_is_regenerated(self):
        self.task.pop("token")
        _, tasks = prepare_tasks(self.project, "r", "0500000000", {}, "https://example.com")
        self.assertIn(self.task["token"], tasks[0]["link"])

if __name__ == "__main__":
    unittest.main()
