"""Run: python -m unittest test_crm_helpers  (from mcp-server/)"""
import base64
import json
import unittest

from crm_helpers import (
    CANONICAL_STAGES, assert_service_role_key, clean_updates, ilike_any,
    sanitize_search, to_nairobi, utc_now_iso, validate_stage,
)


def fake_jwt(role):
    body = base64.urlsafe_b64encode(json.dumps({"role": role}).encode()).decode().rstrip("=")
    return f"eyJhbGciOiJIUzI1NiJ9.{body}.sig"


class SanitizeTests(unittest.TestCase):
    def test_keeps_normal_input(self):
        self.assertEqual(sanitize_search("john.doe@naim.co.ke"), "john.doe@naim.co.ke")
        self.assertEqual(sanitize_search("أمينة علي"), "أمينة علي")

    def test_blocks_filter_injection(self):
        f = ilike_any(["name", "email"], "x%,id.not.is.null),or(role.eq.admin")
        self.assertEqual(len(f.split(",")), 2)
        self.assertNotIn("(", f)
        self.assertIsNone(ilike_any(["name"], "(),%*"))


class TimeTests(unittest.TestCase):
    def test_utc_is_offset_aware(self):
        self.assertTrue(utc_now_iso().endswith("+00:00"))

    def test_nairobi_render(self):
        self.assertEqual(to_nairobi("2026-09-28T02:00:00Z"), "2026-09-28 05:00 EAT")


class KeyTests(unittest.TestCase):
    def test_accepts_service_role(self):
        assert_service_role_key(fake_jwt("service_role"))
        assert_service_role_key("sb_secret_abc")

    def test_rejects_anon(self):
        for bad in (None, "", fake_jwt("anon"), "sb_publishable_abc", "garbage"):
            with self.assertRaises(ValueError):
                assert_service_role_key(bad)


class ValidationTests(unittest.TestCase):
    def test_stages(self):
        self.assertEqual(len(CANONICAL_STAGES), 16)
        self.assertNotIn("Hired", CANONICAL_STAGES)
        with self.assertRaises(ValueError):
            validate_stage("Hired")

    def test_clean_updates(self):
        data = clean_updates('{"stage": "Offer", "id": "x", "deleted_at": null}', {"stage": CANONICAL_STAGES})
        self.assertNotIn("id", data)
        self.assertNotIn("deleted_at", data)
        self.assertIn("updated_at", data)
        with self.assertRaises(ValueError):
            clean_updates('{"stage": "Hired"}', {"stage": CANONICAL_STAGES})


if __name__ == "__main__":
    unittest.main()
