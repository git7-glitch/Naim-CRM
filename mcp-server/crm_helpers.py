"""
Pure helpers for the Naim CRM MCP server.

No network, no Supabase client: everything here is unit-testable
(see test_crm_helpers.py). server.py imports from this module.
"""

from __future__ import annotations

import base64
import functools
import json
import re
import unicodedata
import uuid
from datetime import date, datetime, timezone
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

# Stage-transition rules: mirror of src/utils/stageTransitions.js and
# public.is_valid_stage_transition() (migration 004). test_crm_helpers.py
# checks the arrays against the JS source so the three never drift.
PIPELINE_STAGES = CANONICAL_STAGES[:12]
GATE_STAGES = ("Interview", "Offer", "Visa Processing", "Placed")
EXIT_STAGES = ("Rejected", "Withdrawn")
PARKING_STAGES = ("Pending", "Draft")
REOPEN_TARGETS = ("New", "Screening", "Pending")
LEGACY_STAGE_MAP = {"interviewing": "Interview", "hired": "Placed"}

JOB_STATUSES = ("Active", "Draft", "Closed")
TASK_STATUSES = ("Pending", "In Progress", "Completed", "Overdue")
TASK_PRIORITIES = ("Low", "Medium", "High", "Urgent")
APPOINTMENT_STATUSES = ("Scheduled", "Completed", "Cancelled", "Rescheduled")

# Hermes job queue contract (docs/HERMES-INTEGRATION.md, src/utils/constants.js).
AUTOMATION_JOB_TYPES = ("cv_build", "lead_enrich", "whatsapp_send", "doc_ocr", "followup_sweep")
AUTOMATION_JOB_STATUSES = ("pending", "claimed", "done", "failed")
# Minimum payload keys per job type (extra keys are allowed).
JOB_PAYLOAD_REQUIRED = {
    "cv_build": ("candidate_id",),
    "lead_enrich": ("lead_id",),
    "whatsapp_send": ("to", "message"),
    "doc_ocr": ("document_id",),
    "followup_sweep": (),
}

LEAD_STATUSES = ("new", "contacted", "qualified", "converted", "disqualified")
CV_DRAFT_STATUSES = ("draft", "pending_review", "approved", "rejected")

# Columns an agent may never overwrite through the generic update tools.
PROTECTED_UPDATE_FIELDS = frozenset({"id", "created_at", "deleted_at"})
# Candidate stage changes must go through move_candidate_stage (validated).
CANDIDATE_UPDATE_FORBIDDEN = frozenset({"stage"})


class ToolInputError(ValueError):
    """Bad input from the calling agent -> {ok: false, error.code: 'invalid_input'}."""

    code = "invalid_input"


class NotFoundError(ToolInputError):
    code = "not_found"


# --------------------------------------------------------------------------
# Phase 3: consistent {ok, data, error} envelope
# --------------------------------------------------------------------------
def ok(data=None) -> dict:
    return {"ok": True, "data": data, "error": None}


def fail(message: str, code: str = "invalid_input") -> dict:
    return {"ok": False, "data": None, "error": {"code": code, "message": str(message)}}


def is_envelope(value) -> bool:
    return isinstance(value, dict) and set(value) == {"ok", "data", "error"}


def _db_error_message(exc: Exception) -> tuple[str, str]:
    """(code, message) for a PostgREST / Postgres error without leaking internals."""
    pg_code = str(getattr(exc, "code", "") or "")
    message = getattr(exc, "message", None) or str(exc) or exc.__class__.__name__
    if pg_code == "23514":
        return "constraint_violation", message
    if pg_code == "23505":
        return "conflict", message
    if pg_code == "23503":
        return "not_found", "A referenced record does not exist."
    if pg_code == "42501":
        return "forbidden", message
    return "internal_error", message


def envelope(fn):
    """Wrap a tool so it ALWAYS returns {ok, data, error}, never raises."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        try:
            result = fn(*args, **kwargs)
        except ToolInputError as exc:
            return fail(str(exc), exc.code)
        except ValueError as exc:
            return fail(str(exc), "invalid_input")
        except Exception as exc:  # noqa: BLE001 - agents get a clean error, not a traceback
            code, message = _db_error_message(exc)
            return fail(message, code)
        return result if is_envelope(result) else ok(result)

    return wrapper


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


def nairobi_today() -> str:
    return datetime.now(NAIROBI).date().isoformat()


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
        raise ToolInputError(f"Invalid stage '{stage}'. Valid stages: {', '.join(CANONICAL_STAGES)}")
    return stage


def validate_choice(value: str, allowed: tuple[str, ...], field: str) -> str:
    if value not in allowed:
        raise ToolInputError(f"Invalid {field} '{value}'. Allowed: {', '.join(allowed)}")
    return value


def validate_uuid(value: object, field: str = "id") -> str:
    try:
        return str(uuid.UUID(str(value).strip()))
    except (ValueError, AttributeError, TypeError):
        raise ToolInputError(f"{field} must be a UUID, got '{value}'.") from None


def optional_uuid(value: object, field: str) -> str | None:
    if value in (None, ""):
        return None
    return validate_uuid(value, field)


def validate_date(value: str, field: str = "date") -> str:
    try:
        return date.fromisoformat(str(value).strip()).isoformat()
    except ValueError:
        raise ToolInputError(f"{field} must be YYYY-MM-DD, got '{value}'.") from None


def validate_time(value: str, field: str = "time") -> str:
    text = str(value).strip()
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?", text):
        raise ToolInputError(f"{field} must be HH:MM (24h, Africa/Nairobi), got '{value}'.")
    return text[:5]


def validate_limit(limit: object, default: int = 20, maximum: int = 100) -> int:
    try:
        number = int(limit)
    except (TypeError, ValueError):
        number = default
    return max(1, min(number, maximum))


def require_text(value: object, field: str, max_len: int = 500) -> str:
    text = str(value or "").strip()
    if not text:
        raise ToolInputError(f"{field} is required.")
    if len(text) > max_len:
        raise ToolInputError(f"{field} is too long (max {max_len} characters).")
    return text


def parse_json_object(raw: object, field: str = "payload") -> dict:
    """Accept a dict or a JSON string holding an object."""
    if isinstance(raw, dict):
        return raw
    if raw in (None, ""):
        return {}
    try:
        data = json.loads(str(raw))
    except json.JSONDecodeError as exc:
        raise ToolInputError(f"{field} must be a JSON object.") from exc
    if not isinstance(data, dict):
        raise ToolInputError(f"{field} must be a JSON object.")
    return data


def validate_job_payload(job_type: str, payload: dict) -> dict:
    validate_choice(job_type, AUTOMATION_JOB_TYPES, "job_type")
    missing = [k for k in JOB_PAYLOAD_REQUIRED[job_type] if payload.get(k) in (None, "")]
    if missing:
        raise ToolInputError(f"{job_type} payload is missing: {', '.join(missing)}")
    for key in ("candidate_id", "lead_id", "document_id"):
        if payload.get(key):
            payload[key] = validate_uuid(payload[key], f"payload.{key}")
    if len(json.dumps(payload)) > 50_000:
        raise ToolInputError("payload is too large (max 50 KB).")
    return payload


def normalize_phone(raw: object) -> str:
    """Mirror of whatsappService.normalizePhone: digits only, Kenyan 07xx -> 2547xx. '' if invalid."""
    digits = re.sub(r"\D", "", str(raw or ""))
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) == 10 and digits.startswith("0"):
        digits = "254" + digits[1:]
    return digits if 8 <= len(digits) <= 15 else ""


def clean_updates(
    raw_json: str | dict,
    allowed_enums: dict[str, tuple[str, ...]] | None = None,
    forbidden: frozenset[str] | set[str] = frozenset(),
) -> dict:
    """Parse a JSON updates object, drop protected columns, validate enums."""
    if isinstance(raw_json, dict):
        data = dict(raw_json)
    else:
        try:
            data = json.loads(raw_json)
        except (json.JSONDecodeError, TypeError) as exc:
            raise ToolInputError('Invalid JSON. Example: {"notes": "Rescheduled"}') from exc
    if not isinstance(data, dict) or not data:
        raise ToolInputError("Updates must be a non-empty JSON object.")
    blocked = sorted(k for k in data if k in forbidden)
    if blocked:
        raise ToolInputError(f"{', '.join(blocked)} cannot be changed with this tool (use move_candidate_stage for stages).")
    data = {k: v for k, v in data.items() if k not in PROTECTED_UPDATE_FIELDS}
    if not data:
        raise ToolInputError("Nothing to update: id, created_at and deleted_at cannot be changed here.")
    for field, allowed in (allowed_enums or {}).items():
        if field in data:
            validate_choice(data[field], allowed, field)
    data["updated_at"] = utc_now_iso()
    return data


# --------------------------------------------------------------------------
# Stage transitions (mirror of src/utils/stageTransitions.js)
# --------------------------------------------------------------------------
def normalize_stage(value: object) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip() if isinstance(value, str) else ""
    if not cleaned:
        return ""
    lower = cleaned.lower()
    for stage in CANONICAL_STAGES:
        if stage.lower() == lower:
            return stage
    return LEGACY_STAGE_MAP.get(lower, "")


def transition_error(from_stage: object, to_stage: object) -> str:
    """Why a move is illegal, or '' when it is allowed."""
    to = normalize_stage(to_stage)
    if not to:
        return "Unknown target stage"
    original_from = normalize_stage(from_stage) or "New"
    frm = original_from
    if frm == to:
        return ""
    if to in EXIT_STAGES:
        return "A completed placement cannot be rejected or withdrawn" if frm == "Completed" else ""
    if to == "Pending":
        return "A completed placement cannot be parked as Pending" if frm == "Completed" else ""
    if to == "Draft":
        return "" if frm in ("New", "Draft", "Pending") else "Only new or pending candidates can go back to Draft"
    if frm in EXIT_STAGES:
        return "" if to in REOPEN_TARGETS else f"A {frm.lower()} candidate can only be reopened to New, Screening or Pending"
    if frm == "Completed":
        return "" if to == "Placed" else "A completed placement can only be moved back to Placed"
    if frm in PARKING_STAGES:
        frm = "New"
    if frm not in PIPELINE_STAGES or to not in PIPELINE_STAGES:
        return "Unknown stage"
    fi, ti = PIPELINE_STAGES.index(frm), PIPELINE_STAGES.index(to)
    if ti <= fi:
        return ""
    for gate in GATE_STAGES:
        gi = PIPELINE_STAGES.index(gate)
        if fi < gi < ti:
            return f"Can't jump from {original_from} to {to}: the candidate must pass {gate} first"
    return ""


def allowed_targets(from_stage: object) -> list[str]:
    frm = normalize_stage(from_stage) or "New"
    return [s for s in CANONICAL_STAGES if s != frm and not transition_error(frm, s)]
