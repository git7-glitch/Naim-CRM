"""
Naim CRM MCP Server: the Hermes Agent docking port.

Runs SERVER-SIDE ONLY with the Supabase service_role key (CRM-2).
Timestamps are timezone-aware (CRM-7), every free-text search is sanitised
before it reaches a PostgREST filter (CRM-8), and every tool returns the same
envelope (Phase 3):

    {"ok": true,  "data": <result>, "error": null}
    {"ok": false, "data": null,     "error": {"code": "...", "message": "..."}}

Error codes: invalid_input, not_found, constraint_violation, conflict,
forbidden, internal_error. Tool reference: mcp-server/README.md.
"""

import base64
import os
import re
import sys
from datetime import datetime, timedelta

from dotenv import load_dotenv
from fastmcp import FastMCP
from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from crm_helpers import (  # noqa: E402
    APPOINTMENT_STATUSES,
    AUTOMATION_JOB_STATUSES,
    AUTOMATION_JOB_TYPES,
    CANDIDATE_UPDATE_FORBIDDEN,
    CANONICAL_STAGES,
    CV_DRAFT_STATUSES,
    JOB_STATUSES,
    LEAD_STATUSES,
    NAIROBI,
    PIPELINE_STAGES,
    TASK_PRIORITIES,
    TASK_STATUSES,
    NotFoundError,
    ToolInputError,
    allowed_targets,
    assert_service_role_key,
    clean_updates,
    envelope,
    fail,
    ilike_any,
    nairobi_today,
    normalize_phone,
    normalize_stage,
    ok,
    optional_uuid,
    parse_json_object,
    require_text,
    to_nairobi,
    transition_error,
    utc_now_iso,
    validate_choice,
    validate_date,
    validate_job_payload,
    validate_limit,
    validate_stage,
    validate_time,
    validate_uuid,
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
WORKER_NAME = os.getenv("HERMES_WORKER_NAME", "hermes")
DOCUMENTS_BUCKET = "documents"
PAGE = 1000

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL must be set in mcp-server/.env")
if os.getenv("SUPABASE_KEY") and not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError(
        "SUPABASE_KEY is no longer read. Set SUPABASE_SERVICE_ROLE_KEY (server-side only): "
        "the anon key cannot pass RLS policies scoped TO authenticated."
    )
assert_service_role_key(SUPABASE_SERVICE_ROLE_KEY)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
mcp = FastMCP(
    "Naim CRM",
    instructions=(
        "Tools for the Naim Investments recruitment CRM. Every tool returns "
        "{ok, data, error}. Stages are canonical and transitions are validated. "
        "The CRM never handles money: do not record payments or charges."
    ),
)


def tool(fn):
    """Register an MCP tool that always answers with the {ok, data, error} envelope."""
    return mcp.tool()(envelope(fn))


# ------------------------------------------------------------------ helpers
def _one(table: str, record_id: str, columns: str = "*", *, include_deleted: bool = False, label: str | None = None) -> dict:
    query = supabase.table(table).select(columns).eq("id", record_id)
    if not include_deleted and table in ("candidates", "jobs", "tasks", "appointments", "documents", "leads"):
        query = query.is_("deleted_at", "null")
    rows = query.limit(1).execute().data
    if not rows:
        raise NotFoundError(f"{label or table[:-1].capitalize()} {record_id} not found.")
    return rows[0]


def _all(query_factory) -> list:
    """Page past PostgREST's 1000-row cap."""
    rows, start = [], 0
    while True:
        chunk = query_factory().range(start, start + PAGE - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < PAGE:
            return rows
        start += PAGE


def _log(entity_type: str, entity_id, action: str, summary: str, candidate_id=None, changes=None) -> None:
    """Best-effort activity_log write for changes the DB triggers don't already record."""
    try:
        supabase.table("activity_log").insert({
            "entity_type": entity_type,
            "entity_id": entity_id,
            "candidate_id": candidate_id,
            "action": action,
            "summary": summary,
            "changes": changes or {},
            "actor_name": f"Hermes / {WORKER_NAME}",
        }).execute()
    except Exception:  # noqa: BLE001 - logging must never break the tool
        pass


def _candidate_brief(c: dict) -> dict:
    return {
        "id": c["id"],
        "name": c.get("name"),
        "stage": c.get("stage"),
        "phone": c.get("phone"),
        "email": c.get("email"),
        "country_applying_to": c.get("country_applying_to"),
        "job_title": c.get("job_title") or c.get("work_position"),
        "updated_at": c.get("updated_at"),
        "updated_at_local": to_nairobi(c.get("updated_at")),
    }


# ============================================================
# CANDIDATE TOOLS
# ============================================================


@tool
def list_candidates(search: str = "", stage: str = "", country: str = "", limit: int = 20, offset: int = 0) -> dict:
    """List/search candidates (name, email, phone, passport). Optional canonical stage and destination country filters."""
    limit = validate_limit(limit)
    offset = max(0, int(offset or 0))
    query = supabase.table("candidates").select("*", count="exact").is_("deleted_at", "null")
    search_filter = ilike_any(["name", "email", "phone", "passport_number"], search)
    if search_filter:
        query = query.or_(search_filter)
    if stage:
        query = query.eq("stage", validate_stage(stage))
    if country:
        query = query.eq("country_applying_to", require_text(country, "country", 80))
    result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return {"total": result.count, "offset": offset, "candidates": [_candidate_brief(c) for c in result.data or []]}


@tool
def get_candidate(candidate_id: str) -> dict:
    """Full candidate record by ID (all columns, plus local Nairobi timestamps)."""
    c = _one("candidates", validate_uuid(candidate_id, "candidate_id"), include_deleted=True, label="Candidate")
    return {**c, "created_at_local": to_nairobi(c.get("created_at")), "updated_at_local": to_nairobi(c.get("updated_at")),
            "allowed_next_stages": allowed_targets(c.get("stage"))}


@tool
def get_candidate_full(candidate_id: str) -> dict:
    """Candidate + documents + tasks + appointments + CV drafts + stage history (activity_log). Use before acting on a candidate."""
    cid = validate_uuid(candidate_id, "candidate_id")
    c = _one("candidates", cid, include_deleted=True, label="Candidate")
    documents = supabase.table("documents").select(
        "id, document_type, file_name, file_path, mime_type, file_size, expiry_date, created_at"
    ).eq("candidate_id", cid).is_("deleted_at", "null").order("created_at", desc=True).execute().data or []
    tasks = supabase.table("tasks").select("id, title, status, priority, due_date, created_at").eq(
        "candidate_id", cid).is_("deleted_at", "null").order("due_date").execute().data or []
    appointments = supabase.table("appointments").select("id, title, type, date, time, status, notes").eq(
        "candidate_id", cid).is_("deleted_at", "null").order("date").execute().data or []
    cv_drafts = supabase.table("cv_drafts").select("id, title, status, source, document_id, created_at, updated_at").eq(
        "candidate_id", cid).order("updated_at", desc=True).execute().data or []
    history = supabase.table("activity_log").select("action, summary, changes, actor_name, created_at").eq(
        "candidate_id", cid).order("created_at", desc=True).limit(100).execute().data or []
    for entry in history:
        entry["created_at_local"] = to_nairobi(entry.get("created_at"))
    return {
        "candidate": {**c, "allowed_next_stages": allowed_targets(c.get("stage"))},
        "documents": documents,
        "tasks": tasks,
        "appointments": appointments,
        "cv_drafts": cv_drafts,
        "stage_history": [h for h in history if h.get("action") == "stage_change"],
        "activity": history,
    }


@tool
def add_candidate(
    name: str,
    phone: str = "",
    email: str = "",
    stage: str = "New",
    job_title: str = "",
    country_applying_to: str = "",
    passport_number: str = "",
    nationality: str = "",
    notes: str = "",
) -> dict:
    """Add a new candidate. New candidates start in New (or Draft/Pending/Source/Screening)."""
    stage = validate_stage(stage or "New")
    if transition_error("New", stage):
        raise ToolInputError(f"A new candidate cannot start in '{stage}'. Allowed: New, {', '.join(allowed_targets('New'))}")
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email.strip()):
        raise ToolInputError(f"email '{email}' is not valid.")
    data = {
        "name": require_text(name, "name", 200),
        "phone": phone.strip() or None,
        "email": email.strip() or None,
        "stage": stage,
        "job_title": job_title.strip() or None,
        "country_applying_to": country_applying_to.strip() or None,
        "passport_number": passport_number.strip() or None,
        "nationality": nationality.strip() or None,
        "notes": notes or None,
    }
    rows = supabase.table("candidates").insert(data).execute().data
    if not rows:
        return fail("Insert returned no row.", "internal_error")
    return _candidate_brief(rows[0])


@tool
def update_candidate(candidate_id: str, updates: str) -> dict:
    """Update candidate fields. `updates` is a JSON object, e.g. {"notes": "Rescheduled", "phone": "+2547..."}. Stage changes: use move_candidate_stage."""
    cid = validate_uuid(candidate_id, "candidate_id")
    data = clean_updates(updates, forbidden=CANDIDATE_UPDATE_FORBIDDEN)
    _one("candidates", cid, "id", include_deleted=True, label="Candidate")
    rows = supabase.table("candidates").update(data).eq("id", cid).execute().data
    return {"id": cid, "updated_fields": sorted(k for k in data if k != "updated_at"), "candidate": _candidate_brief(rows[0]) if rows else None}


@tool
def move_candidate_stage(candidate_id: str, new_stage: str) -> dict:
    """Move a candidate to a canonical stage. Checkpoints Interview > Offer > Visa Processing > Placed can't be skipped."""
    cid = validate_uuid(candidate_id, "candidate_id")
    target = validate_stage(new_stage)
    current = _one("candidates", cid, "id, name, stage", label="Candidate")
    problem = transition_error(current.get("stage"), target)
    if problem:
        return fail(f"{problem}. Allowed from {current.get('stage') or 'New'}: {', '.join(allowed_targets(current.get('stage')))}",
                    "invalid_transition")
    rows = supabase.table("candidates").update({"stage": target, "updated_at": utc_now_iso()}).eq("id", cid).execute().data
    # activity_log: written by the log_server_candidate_change trigger (migration 004).
    return {"id": cid, "name": current.get("name"), "from": normalize_stage(current.get("stage")) or "New", "to": target,
            "candidate": _candidate_brief(rows[0]) if rows else None}


@tool
def delete_candidate(candidate_id: str) -> dict:
    """Soft-delete a candidate (moves to the Recycle Bin; only an admin can restore)."""
    cid = validate_uuid(candidate_id, "candidate_id")
    _one("candidates", cid, "id", label="Candidate")
    supabase.table("candidates").update({"deleted_at": utc_now_iso()}).eq("id", cid).execute()
    return {"id": cid, "deleted": True}


@tool
def get_candidate_stats() -> dict:
    """Candidate counts: total and by stage (all 16 canonical stages)."""
    rows = _all(lambda: supabase.table("candidates").select("stage").is_("deleted_at", "null"))
    by_stage = {s: 0 for s in CANONICAL_STAGES}
    for c in rows:
        s = normalize_stage(c.get("stage")) or "New"
        by_stage[s] = by_stage.get(s, 0) + 1
    return {"total": len(rows), "by_stage": by_stage}


@tool
def get_candidates_by_country() -> dict:
    """Candidate count grouped by destination country."""
    rows = _all(lambda: supabase.table("candidates").select("country_applying_to").is_("deleted_at", "null"))
    counts: dict = {}
    for c in rows:
        key = c.get("country_applying_to") or "Unknown"
        counts[key] = counts.get(key, 0) + 1
    return {"total": len(rows), "by_country": dict(sorted(counts.items(), key=lambda kv: -kv[1]))}


# ============================================================
# JOB TOOLS
# ============================================================


@tool
def list_jobs(search: str = "", status: str = "", limit: int = 20) -> dict:
    """List job openings. Filter by status (Active/Draft/Closed) or search title/description."""
    query = supabase.table("jobs").select("*").is_("deleted_at", "null")
    search_filter = ilike_any(["title", "description"], search)
    if search_filter:
        query = query.or_(search_filter)
    if status:
        query = query.eq("status", validate_choice(status, JOB_STATUSES, "status"))
    return {"jobs": query.order("created_at", desc=True).limit(validate_limit(limit)).execute().data or []}


@tool
def add_job(
    title: str,
    country: str = "",
    salary_min: str = "",
    salary_max: str = "",
    currency: str = "KWD",
    description: str = "",
    requirements: str = "",
    status: str = "Active",
) -> dict:
    """Create a job opening. Salary fields describe the employer's offer to the worker (not fees)."""
    try:
        smin = float(salary_min) if str(salary_min).strip() else None
        smax = float(salary_max) if str(salary_max).strip() else None
    except ValueError:
        raise ToolInputError("salary_min and salary_max must be numbers.") from None
    if smin is not None and smax is not None and smin > smax:
        raise ToolInputError("salary_min cannot exceed salary_max.")
    if not re.fullmatch(r"[A-Z]{3}", (currency or "").strip().upper()):
        raise ToolInputError("currency must be a 3-letter ISO code, e.g. KWD.")
    data = {
        "title": require_text(title, "title", 200),
        "country": country.strip() or None,
        "salary_min": smin,
        "salary_max": smax,
        "currency": currency.strip().upper(),
        "description": description or None,
        "requirements": requirements or None,
        "status": validate_choice(status, JOB_STATUSES, "status"),
    }
    rows = supabase.table("jobs").insert(data).execute().data
    return rows[0] if rows else fail("Insert returned no row.", "internal_error")


@tool
def update_job(job_id: str, updates: str) -> dict:
    """Update a job. `updates` is a JSON object, e.g. {"status": "Closed"}."""
    jid = validate_uuid(job_id, "job_id")
    data = clean_updates(updates, {"status": JOB_STATUSES})
    _one("jobs", jid, "id", include_deleted=True, label="Job")
    rows = supabase.table("jobs").update(data).eq("id", jid).execute().data
    return rows[0] if rows else {"id": jid}


# ============================================================
# APPOINTMENT TOOLS
# ============================================================


@tool
def list_appointments(status: str = "", candidate_id: str = "", from_date: str = "", limit: int = 20) -> dict:
    """List appointments by date (Africa/Nairobi). Optional status, candidate and from_date (YYYY-MM-DD) filters."""
    query = supabase.table("appointments").select("*, candidates(name)").is_("deleted_at", "null")
    if status:
        query = query.eq("status", validate_choice(status, APPOINTMENT_STATUSES, "status"))
    if candidate_id:
        query = query.eq("candidate_id", validate_uuid(candidate_id, "candidate_id"))
    if from_date:
        query = query.gte("date", validate_date(from_date, "from_date"))
    rows = query.order("date").limit(validate_limit(limit)).execute().data or []
    for a in rows:
        a["candidate_name"] = (a.pop("candidates", None) or {}).get("name")
    return {"timezone": "Africa/Nairobi", "appointments": rows}


@tool
def schedule_appointment(
    title: str,
    date: str,
    time: str = "",
    candidate_id: str = "",
    appointment_type: str = "Interview",
    notes: str = "",
) -> dict:
    """Schedule an appointment. date YYYY-MM-DD, time HH:MM (Africa/Nairobi local time)."""
    cid = optional_uuid(candidate_id, "candidate_id")
    if cid:
        _one("candidates", cid, "id", label="Candidate")
    data = {
        "title": require_text(title, "title", 200),
        "date": validate_date(date),
        "time": validate_time(time) if str(time).strip() else None,
        "candidate_id": cid,
        "type": require_text(appointment_type or "Interview", "appointment_type", 60),
        "status": "Scheduled",
        "notes": notes or None,
    }
    rows = supabase.table("appointments").insert(data).execute().data
    if rows:
        _log("appointment", rows[0]["id"], "appointment_created", f"Appointment '{data['title']}' on {data['date']} scheduled", cid)
    return rows[0] if rows else fail("Insert returned no row.", "internal_error")


# ============================================================
# TASK TOOLS
# ============================================================


@tool
def list_tasks(status: str = "", candidate_id: str = "", due_by: str = "", limit: int = 20) -> dict:
    """List tasks by due date. Filters: status (Pending/In Progress/Completed/Overdue), candidate, due_by (YYYY-MM-DD)."""
    query = supabase.table("tasks").select("*").is_("deleted_at", "null")
    if status:
        query = query.eq("status", validate_choice(status, TASK_STATUSES, "status"))
    if candidate_id:
        query = query.eq("candidate_id", validate_uuid(candidate_id, "candidate_id"))
    if due_by:
        query = query.lte("due_date", validate_date(due_by, "due_by"))
    return {"tasks": query.order("due_date").limit(validate_limit(limit)).execute().data or []}


@tool
def add_task(title: str, description: str = "", priority: str = "Medium", due_date: str = "", candidate_id: str = "") -> dict:
    """Create a task. Priority: Low/Medium/High/Urgent. due_date YYYY-MM-DD. Optional candidate link."""
    cid = optional_uuid(candidate_id, "candidate_id")
    if cid:
        _one("candidates", cid, "id", label="Candidate")
    data = {
        "title": require_text(title, "title", 200),
        "description": description or None,
        "status": "Pending",
        "priority": validate_choice(priority, TASK_PRIORITIES, "priority"),
        "due_date": validate_date(due_date, "due_date") if str(due_date).strip() else None,
        "candidate_id": cid,
    }
    rows = supabase.table("tasks").insert(data).execute().data
    if rows:
        _log("task", rows[0]["id"], "task_created", f"Task '{data['title']}' created", cid)
    return rows[0] if rows else fail("Insert returned no row.", "internal_error")


@tool
def update_task(task_id: str, updates: str) -> dict:
    """Update a task. `updates` is a JSON object, e.g. {"status": "Completed"}."""
    tid = validate_uuid(task_id, "task_id")
    data = clean_updates(updates, {"status": TASK_STATUSES, "priority": TASK_PRIORITIES})
    if "due_date" in data and data["due_date"]:
        data["due_date"] = validate_date(data["due_date"], "due_date")
    if data.get("status") == "Completed":
        data.setdefault("completed_at", utc_now_iso())
    _one("tasks", tid, "id", include_deleted=True, label="Task")
    rows = supabase.table("tasks").update(data).eq("id", tid).execute().data
    return rows[0] if rows else {"id": tid}


# ============================================================
# REPORTING TOOLS (Jamal: Strategist)
# ============================================================


def _month_start_utc() -> str:
    now = datetime.now(NAIROBI)
    return now.replace(day=1, hour=0, minute=0, second=0, microsecond=0).isoformat()


@tool
def get_dashboard_stats() -> dict:
    """Headline numbers: candidates, active jobs, open tasks, placements."""
    candidates = _all(lambda: supabase.table("candidates").select("stage").is_("deleted_at", "null"))
    jobs = supabase.table("jobs").select("id", count="exact").eq("status", "Active").is_("deleted_at", "null").execute()
    tasks = _all(lambda: supabase.table("tasks").select("status").is_("deleted_at", "null"))
    return {
        "generated_at": utc_now_iso(),
        "generated_at_local": to_nairobi(utc_now_iso()),
        "total_candidates": len(candidates),
        "active_jobs": jobs.count or 0,
        "open_tasks": sum(1 for t in tasks if t.get("status") in ("Pending", "In Progress", "Overdue")),
        "candidates_placed": sum(1 for c in candidates if normalize_stage(c.get("stage")) == "Placed"),
    }


@tool
def get_reports_summary() -> dict:
    """Live KPI summary (same figures as the Reports/Dashboard pages): funnel, placements this month, expiring documents, tasks due today, leads."""
    today = nairobi_today()
    in_30 = (datetime.now(NAIROBI).date() + timedelta(days=30)).isoformat()
    candidates = _all(lambda: supabase.table("candidates").select("id, stage, country_applying_to, updated_at, created_at").is_("deleted_at", "null"))
    funnel = {s: 0 for s in PIPELINE_STAGES}
    other: dict = {}
    by_country: dict = {}
    for c in candidates:
        s = normalize_stage(c.get("stage")) or "New"
        bucket = funnel if s in funnel else other
        bucket[s] = bucket.get(s, 0) + 1
        k = c.get("country_applying_to") or "Unknown"
        by_country[k] = by_country.get(k, 0) + 1
    month_start = _month_start_utc()
    placed_log = _all(lambda: supabase.table("activity_log").select("candidate_id, changes").eq("action", "stage_change").gte("created_at", month_start))
    placed_ids = {r["candidate_id"] for r in placed_log if (r.get("changes") or {}).get("to") == "Placed" and r.get("candidate_id")}
    placed_ids |= {c["id"] for c in candidates if normalize_stage(c.get("stage")) == "Placed" and (c.get("updated_at") or "") >= month_start[:10]}
    docs = supabase.table("documents").select("id, document_type, expiry_date, candidate_id").is_("deleted_at", "null").not_.is_(
        "expiry_date", "null").lte("expiry_date", in_30).limit(500).execute().data or []
    tasks = _all(lambda: supabase.table("tasks").select("status, due_date").is_("deleted_at", "null").neq("status", "Completed"))
    leads = _all(lambda: supabase.table("leads").select("status").is_("deleted_at", "null"))
    lead_counts = {s: 0 for s in LEAD_STATUSES}
    for lead in leads:
        lead_counts[lead.get("status") or "new"] = lead_counts.get(lead.get("status") or "new", 0) + 1
    return {
        "generated_at_local": to_nairobi(utc_now_iso()),
        "total_active_candidates": len(candidates),
        "pipeline_funnel": funnel,
        "off_pipeline": other,
        "by_destination": dict(sorted(by_country.items(), key=lambda kv: -kv[1])),
        "placements_this_month": len(placed_ids),
        "documents_expired": sum(1 for d in docs if d["expiry_date"] < today),
        "documents_expiring_30d": sum(1 for d in docs if d["expiry_date"] >= today),
        "tasks_due_today": sum(1 for t in tasks if t.get("due_date") == today),
        "tasks_overdue": sum(1 for t in tasks if t.get("due_date") and t["due_date"] < today),
        "leads_by_status": lead_counts,
    }


# ============================================================
# AUTOMATION JOB QUEUE (Juma: Operator, and every engine)
# ============================================================


@tool
def enqueue_automation_job(job_type: str, payload: str = "{}") -> dict:
    """Queue work for a Hermes engine. job_type: cv_build | lead_enrich | whatsapp_send | doc_ocr | followup_sweep. payload: JSON object (see README contract)."""
    data = validate_job_payload(job_type, parse_json_object(payload))
    rows = supabase.table("automation_jobs").insert({"job_type": job_type, "payload": data, "status": "pending"}).execute().data
    return rows[0] if rows else fail("Insert returned no row.", "internal_error")


@tool
def list_pending_jobs(job_type: str = "", status: str = "pending", limit: int = 20) -> dict:
    """List queued jobs, oldest first. status defaults to pending (also: claimed, done, failed)."""
    query = supabase.table("automation_jobs").select("*").eq("status", validate_choice(status, AUTOMATION_JOB_STATUSES, "status"))
    if job_type:
        query = query.eq("job_type", validate_choice(job_type, AUTOMATION_JOB_TYPES, "job_type"))
    return {"jobs": query.order("created_at").limit(validate_limit(limit)).execute().data or []}


@tool
def claim_automation_job(job_type: str = "", worker: str = "") -> dict:
    """Atomically claim the oldest pending job (optionally of one type). Returns the job, or data=null if the queue is empty."""
    types = [validate_choice(job_type, AUTOMATION_JOB_TYPES, "job_type")] if job_type else None
    rows = supabase.rpc("claim_automation_jobs", {
        "p_worker": (worker or WORKER_NAME)[:60], "p_job_types": types, "p_limit": 1,
    }).execute().data or []
    return rows[0] if rows else None


@tool
def complete_automation_job(job_id: str, status: str = "done", result: str = "{}", error: str = "") -> dict:
    """Finish a claimed job. status: done | failed. result: JSON object. On failure pass `error` (shown to staff)."""
    jid = validate_uuid(job_id, "job_id")
    final = validate_choice(status, ("done", "failed"), "status")
    payload = parse_json_object(result, "result")
    if final == "failed":
        payload.setdefault("error", require_text(error or "Failed", "error", 500))
    job = _one("automation_jobs", jid, label="Automation job")
    if job["status"] in ("done", "failed"):
        return fail(f"Job {jid} is already {job['status']}.", "conflict")
    rows = supabase.table("automation_jobs").update({
        "status": final, "result": payload, "finished_at": utc_now_iso(),
        "claimed_at": job.get("claimed_at") or utc_now_iso(),
    }).eq("id", jid).execute().data
    cand = str((job.get("payload") or {}).get("candidate_id") or "")
    try:
        cand = validate_uuid(cand) if cand else None
    except ToolInputError:
        cand = None
    _log("automation_job", jid, f"automation_job_{final}", f"{job['job_type']} {final}", cand)
    return rows[0] if rows else {"id": jid, "status": final}


# ============================================================
# LEADS (Ali: Researcher)
# ============================================================


@tool
def upsert_lead(
    name: str,
    phone: str = "",
    email: str = "",
    source: str = "hermes",
    country_interest: str = "",
    job_interest: str = "",
    status: str = "",
    notes: str = "",
    external_ref: str = "",
    enrichment: str = "{}",
) -> dict:
    """Create or update a lead. Matches an existing lead by external_ref, then phone, then email. Converted leads are never downgraded."""
    phone_norm = normalize_phone(phone) if phone else ""
    if phone and not phone_norm:
        raise ToolInputError(f"phone '{phone}' is not a valid number.")
    if not (phone_norm or email.strip() or external_ref.strip()):
        raise ToolInputError("Give at least one of phone, email or external_ref so the lead can be de-duplicated.")
    data = {
        "name": require_text(name, "name", 200),
        "phone": phone_norm or None,
        "email": email.strip().lower() or None,
        "source": require_text(source or "hermes", "source", 60),
        "country_interest": country_interest.strip() or None,
        "job_interest": job_interest.strip() or None,
        "notes": notes or None,
        "external_ref": external_ref.strip() or None,
        "enrichment": parse_json_object(enrichment, "enrichment"),
        "updated_at": utc_now_iso(),
    }
    if status:
        data["status"] = validate_choice(status, LEAD_STATUSES, "status")
        if data["status"] == "converted":
            raise ToolInputError("Leads are converted to candidates by staff in the CRM (one click), not by setting status.")
    existing = None
    for column in ("external_ref", "phone", "email"):
        if data[column]:
            found = supabase.table("leads").select("*").eq(column, data[column]).is_("deleted_at", "null").limit(1).execute().data
            if found:
                existing = found[0]
                break
    if existing:
        merged = {k: v for k, v in data.items() if v not in (None, "", {})}
        if existing.get("status") == "converted":
            merged.pop("status", None)
        if data["enrichment"]:
            merged["enrichment"] = {**(existing.get("enrichment") or {}), **data["enrichment"]}
        rows = supabase.table("leads").update(merged).eq("id", existing["id"]).execute().data
        return {"created": False, "lead": rows[0] if rows else existing}
    data.setdefault("status", "new")
    rows = supabase.table("leads").insert(data).execute().data
    if rows:
        _log("lead", rows[0]["id"], "lead_created", f"Lead {data['name']} added by the Researcher engine")
    return {"created": True, "lead": rows[0] if rows else None}


@tool
def list_leads(search: str = "", status: str = "", limit: int = 20) -> dict:
    """List leads, newest first. Filters: search (name/phone/email), status (new/contacted/qualified/converted/disqualified)."""
    query = supabase.table("leads").select("*").is_("deleted_at", "null")
    search_filter = ilike_any(["name", "phone", "email"], search)
    if search_filter:
        query = query.or_(search_filter)
    if status:
        query = query.eq("status", validate_choice(status, LEAD_STATUSES, "status"))
    return {"leads": query.order("created_at", desc=True).limit(validate_limit(limit)).execute().data or []}


# ============================================================
# CV DRAFTS (Salmin: Designer / CV Builder engine)
# ============================================================

CV_TEXT_FIELDS = ("full_name", "email", "phone", "objective", "experience", "education", "skills", "languages", "references")


@tool
def save_cv_draft(
    candidate_id: str,
    title: str,
    content: str = "{}",
    pdf_base64: str = "",
    file_name: str = "",
    automation_job_id: str = "",
    template: str = "professional",
) -> dict:
    """Store a finished CV: uploads the PDF (base64) to private storage, links it as the candidate's Resume/CV document and creates a cv_drafts row awaiting staff approval."""
    cid = validate_uuid(candidate_id, "candidate_id")
    candidate = _one("candidates", cid, "id, name", label="Candidate")
    job_id = optional_uuid(automation_job_id, "automation_job_id")
    fields = parse_json_object(content, "content")
    document_id = pdf_path = None
    if pdf_base64:
        try:
            pdf = base64.b64decode(pdf_base64, validate=True)
        except ValueError:
            raise ToolInputError("pdf_base64 is not valid base64.") from None
        if not pdf.startswith(b"%PDF"):
            raise ToolInputError("pdf_base64 must decode to a PDF file.")
        if len(pdf) > 10 * 1024 * 1024:
            raise ToolInputError("PDF is larger than 10 MB.")
        safe = re.sub(r"[^\w.\- ]+", "_", file_name or f"CV_{candidate['name']}.pdf").strip() or "CV.pdf"
        if not safe.lower().endswith(".pdf"):
            safe += ".pdf"
        pdf_path = f"{cid}/hermes/{int(datetime.now().timestamp() * 1000)}_{safe}"
        supabase.storage.from_(DOCUMENTS_BUCKET).upload(pdf_path, pdf, {"content-type": "application/pdf"})
        try:
            doc = supabase.table("documents").insert({
                "candidate_id": cid, "document_type": "Resume/CV", "file_name": safe, "file_path": pdf_path,
                "file_url": None, "file_size": len(pdf), "mime_type": "application/pdf",
            }).execute().data[0]
        except Exception:
            supabase.storage.from_(DOCUMENTS_BUCKET).remove([pdf_path])
            raise
        document_id = doc["id"]
    row = {
        "candidate_id": cid,
        "title": require_text(title, "title", 200),
        "template": (template or "professional")[:60],
        "status": "pending_review",
        "source": "hermes",
        "automation_job_id": job_id,
        "document_id": document_id,
        "pdf_path": pdf_path,
        "content": fields,
        **{k: (str(fields[k]) if fields.get(k) is not None else None) for k in CV_TEXT_FIELDS},
    }
    draft = supabase.table("cv_drafts").insert(row).execute().data[0]
    _log("document", document_id, "cv_draft_created", f"CV draft '{row['title']}' ready for review", cid,
         {"cv_draft_id": draft["id"], "document_id": document_id, "automation_job_id": job_id})
    return draft


@tool
def list_cv_drafts(candidate_id: str = "", status: str = "", limit: int = 20) -> dict:
    """List CV drafts (newest first). Filters: candidate, status (draft/pending_review/approved/rejected)."""
    query = supabase.table("cv_drafts").select("id, candidate_id, title, status, source, document_id, review_notes, approved_at, created_at")
    if candidate_id:
        query = query.eq("candidate_id", validate_uuid(candidate_id, "candidate_id"))
    if status:
        query = query.eq("status", validate_choice(status, CV_DRAFT_STATUSES, "status"))
    return {"cv_drafts": query.order("created_at", desc=True).limit(validate_limit(limit)).execute().data or []}


if __name__ == "__main__":
    mcp.run(transport="stdio")
