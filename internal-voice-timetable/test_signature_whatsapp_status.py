import unittest
from signature_tasks import mark_whatsapp_action, prepare_tasks

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

if __name__ == "__main__":
    unittest.main()
