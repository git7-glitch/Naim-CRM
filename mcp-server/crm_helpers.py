"""
Pure helpers for the Naim CRM MCP server.

No network, no Supabase client: everything here is unit-testable
(see test_crm_helpers.py). server.py imports from this module.
"""

from __future__ import annotations

import base64
import json
import re
import unicodedata
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

NAIROBI = ZoneInfo("Africa/Nairobi")

# CRM-6: must match CANDIDATE_STAGES in src/utils/constants.js and the CHECK
# constraint in supabase/migrations/002_candidate_stages.sql.
CANONICAL_STAGES = (
    "New",
    "Source",
    "Screening",
    "Interview",
    "Assessment",
    "Shortlist",
    "Offer",
    "Contract Signing",
    "Visa Processing",
    "Onboarding",
    "Placed",
    "Completed",
    "Rejected",
    "Withdrawn",
    "Pending",
    "Draft",
)

JOB_STATUSES = ("Active", "Draft", "Closed")
TASK_STATUSES = ("Pending", "In Progress", "Completed", "Overdue")
TASK_PRIORITIES = ("Low", "Medium", "High", "Urgent")
APPOINTMENT_STATUSES = ("Scheduled", "Completed", "Cancelled", "Rescheduled")

# Columns an agent may never overwrite through the generic update tools.
PROTECTED_UPDATE_FIELDS = frozenset({"id", "created_at", "deleted_at"})

# --------------------------------------------------------------------------
# CRM-8: search sanitisation (mirror of src/utils/sanitizeSearch.js)
# --------------------------------------------------------------------------
SEARCH_MAX_LENGTH = 100
_SEARCH_DISALLOWED = re.compile(r"[^\w\s@.+\-]", re.UNICODE)


def sanitize_search(raw: object, max_len: int = SEARCH_MAX_LENGTH) -> str:
    """Whitelist letters (any script), digits, whitespace and @ . + - _ ."""
    if raw is None:
        return ""
    cleaned = _SEARCH_DISALLOWED.sub(" ", unicodedata.normalize("NFKC", str(raw)))
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_len].strip()


def ilike_any(columns: list[str] | tuple[str, ...], raw: object) -> str | None:
    """PostgREST .or() filter ilike-matching the sanitised term, or None."""
    term = sanitize_search(raw)
    if not term:
        return None
    return ",".join(f"{column}.ilike.%{term}%" for column in columns)


# --------------------------------------------------------------------------
# CRM-7: timezone-aware timestamps
# --------------------------------------------------------------------------
def utc_now_iso() -> str:
    """Offset-aware UTC timestamp for database writes."""
    return datetime.now(timezone.utc).isoformat()


def to_nairobi(value: str | None) -> str:
    """Render a stored timestamp for humans in Africa/Nairobi (EAT)."""
    if not value:
        return "N/A"
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(NAIROBI).strftime("%Y-%m-%d %H:%M EAT")


# --------------------------------------------------------------------------
# CRM-2: refuse to start with anything but a service-role key
# --------------------------------------------------------------------------
def _jwt_role(key: str) -> str | None:
    parts = key.split(".")
    if len(parts) != 3:
        return None
    payload = parts[1] + "=" * (-len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(payload)).get("role")
    except (ValueError, json.JSONDecodeError):
        return None


def assert_service_role_key(key: str | None) -> None:
    """Raise ValueError unless `key` is a Supabase service-role / secret key."""
    if not key:
        raise ValueError(
            "SUPABASE_SERVICE_ROLE_KEY is not set. The MCP server needs the "
            "service_role key (server-side only); the anon key deadlocks on RLS."
        )
    if key.startswith("sb_secret_"):
        return
    if key.startswith("sb_publishable_"):
        raise ValueError("SUPABASE_SERVICE_ROLE_KEY holds a publishable (anon) key, not the secret key.")
    role = _jwt_role(key)
    if role == "service_role":
        return
    if role:
        raise ValueError(f"SUPABASE_SERVICE_ROLE_KEY has role '{role}', expected 'service_role'.")
    raise ValueError("SUPABASE_SERVICE_ROLE_KEY is not a recognisable Supabase key.")


# --------------------------------------------------------------------------
# Input validation
# --------------------------------------------------------------------------
def validate_stage(stage: str) -> str:
    if stage not in CANONICAL_STAGES:
        raise ValueError(f"Invalid stage '{stage}'. Valid stages: {', '.join(CANONICAL_STAGES)}")
    return stage


def validate_choice(value: str, allowed: tuple[str, ...], field: str) -> str:
    if value not in allowed:
        raise ValueError(f"Invalid {field} '{value}'. Allowed: {', '.join(allowed)}")
    return value


def clean_updates(raw_json: str, allowed_enums: dict[str, tuple[str, ...]] | None = None) -> dict:
    """Parse a JSON updates string, drop protected columns, validate enums."""
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ValueError('Invalid JSON. Example: {"stage": "Interview"}') from exc
    if not isinstance(data, dict) or not data:
        raise ValueError("Updates must be a non-empty JSON object.")
    data = {k: v for k, v in data.items() if k not in PROTECTED_UPDATE_FIELDS}
    if not data:
        raise ValueError("Nothing to update: id, created_at and deleted_at cannot be changed here.")
    for field, allowed in (allowed_enums or {}).items():
        if field in data:
            validate_choice(data[field], allowed, field)
    data["updated_at"] = utc_now_iso()
    return data
