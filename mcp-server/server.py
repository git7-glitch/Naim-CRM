"""
Naim CRM MCP Server — the Hermes Agent docking port.

Runs SERVER-SIDE ONLY with the Supabase service_role key (CRM-2).
Timestamps are timezone-aware (CRM-7) and every free-text search is
sanitised before it reaches a PostgREST filter (CRM-8).
"""

import os
import sys

from dotenv import load_dotenv
from fastmcp import FastMCP
from supabase import create_client

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from crm_helpers import (  # noqa: E402
    APPOINTMENT_STATUSES,
    CANONICAL_STAGES,
    JOB_STATUSES,
    TASK_PRIORITIES,
    TASK_STATUSES,
    assert_service_role_key,
    clean_updates,
    ilike_any,
    to_nairobi,
    utc_now_iso,
    validate_choice,
    validate_stage,
)

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL:
    raise ValueError("SUPABASE_URL must be set in mcp-server/.env")
if os.getenv("SUPABASE_KEY") and not SUPABASE_SERVICE_ROLE_KEY:
    raise ValueError(
        "SUPABASE_KEY is no longer read. Set SUPABASE_SERVICE_ROLE_KEY (server-side only) — "
        "the anon key cannot pass RLS policies scoped TO authenticated."
    )
assert_service_role_key(SUPABASE_SERVICE_ROLE_KEY)

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
mcp = FastMCP("Naim CRM", instructions="Tools for managing the Naim Investments Recruitment CRM system.")

# ============================================================
# CANDIDATE TOOLS
# ============================================================


@mcp.tool()
def list_candidates(
    search: str = "",
    stage: str = "",
    country: str = "",
    limit: int = 20,
    offset: int = 0,
) -> str:
    """List and search candidates. Filter by stage, country, or search by name/email/phone/passport."""
    limit = max(1, min(int(limit), 100))
    offset = max(0, int(offset))
    query = supabase.table("candidates").select("*").is_("deleted_at", "null")

    search_filter = ilike_any(["name", "email", "phone", "passport_number"], search)
    if search_filter:
        query = query.or_(search_filter)
    if stage:
        try:
            query = query.eq("stage", validate_stage(stage))
        except ValueError as exc:
            return str(exc)
    if country:
        query = query.eq("country_applying_to", country)

    result = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    candidates = result.data

    if not candidates:
        return "No candidates found."

    lines = [f"Found {len(candidates)} candidate(s):"]
    for c in candidates:
        lines.append(
            f"- [{c['id']}] {c['name']} | Stage: {c['stage']} | "
            f"Phone: {c.get('phone') or 'N/A'} | Country: {c.get('country_applying_to') or 'N/A'}"
        )
    return "\n".join(lines)


@mcp.tool()
def get_candidate(candidate_id: str) -> str:
    """Get full details of a candidate by ID."""
    result = supabase.table("candidates").select("*").eq("id", candidate_id).limit(1).execute()
    if not result.data:
        return "Candidate not found."
    c = result.data[0]

    lines = [
        f"Name: {c['name']}",
        f"Email: {c.get('email') or 'N/A'}",
        f"Phone: {c.get('phone') or 'N/A'}",
        f"Stage: {c['stage']}",
        f"Job Title: {c.get('job_title') or 'N/A'}",
        f"Salary: {c.get('salary') or 'N/A'} {c.get('currency') or ''}",
        f"Country Applying To: {c.get('country_applying_to') or 'N/A'}",
        f"Passport: {c.get('passport_number') or 'N/A'}",
        f"Nationality: {c.get('nationality') or 'N/A'}",
        f"Gender: {c.get('gender') or 'N/A'}",
        f"Education: {c.get('education_level') or 'N/A'}",
        f"Created: {to_nairobi(c.get('created_at'))}",
        f"Updated: {to_nairobi(c.get('updated_at'))}",
    ]
    return "\n".join(lines)


@mcp.tool()
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
) -> str:
    """Add a new candidate to the CRM. Stage must be one of the canonical stages."""
    if not name.strip():
        return "Name is required."
    try:
        validate_stage(stage)
    except ValueError as exc:
        return str(exc)
    data = {
        "name": name.strip(),
        "phone": phone,
        "email": email,
        "stage": stage,
        "job_title": job_title,
        "country_applying_to": country_applying_to,
        "passport_number": passport_number,
        "nationality": nationality,
        "notes": notes,
    }
    result = supabase.table("candidates").insert(data).execute()
    candidate = result.data[0] if result.data else None
    if candidate:
        return f"Candidate added successfully! ID: {candidate['id']}, Name: {candidate['name']}"
    return "Failed to add candidate."


@mcp.tool()
def update_candidate(candidate_id: str, updates: str) -> str:
    """Update a candidate. Pass updates as a JSON string, e.g. '{"stage": "Interview", "notes": "Rescheduled"}'."""
    try:
        update_data = clean_updates(updates, {"stage": CANONICAL_STAGES})
    except ValueError as exc:
        return str(exc)

    result = supabase.table("candidates").update(update_data).eq("id", candidate_id).execute()
    if result.data:
        return f"Candidate {candidate_id} updated: {', '.join(sorted(update_data))}"
    return "Failed to update candidate (not found?)."


@mcp.tool()
def move_candidate_stage(candidate_id: str, new_stage: str) -> str:
    """Move a candidate to a new recruitment stage (canonical stages only)."""
    try:
        validate_stage(new_stage)
    except ValueError as exc:
        return str(exc)

    result = supabase.table("candidates").update(
        {"stage": new_stage, "updated_at": utc_now_iso()}
    ).eq("id", candidate_id).execute()

    if result.data:
        c = result.data[0]
        return f"Candidate '{c['name']}' moved to stage: {new_stage}"
    return "Failed to update candidate stage (not found?)."


@mcp.tool()
def delete_candidate(candidate_id: str) -> str:
    """Soft-delete a candidate (moves to recycle bin)."""
    result = supabase.table("candidates").update(
        {"deleted_at": utc_now_iso()}
    ).eq("id", candidate_id).execute()
    if result.data:
        return f"Candidate {candidate_id} moved to recycle bin."
    return "Failed to delete candidate (not found?)."


@mcp.tool()
def get_candidate_stats() -> str:
    """Get candidate statistics: count by stage, total count, etc."""
    all_result = supabase.table("candidates").select("stage").is_("deleted_at", "null").execute()
    candidates = all_result.data

    if not candidates:
        return "No candidates in the system."

    stage_counts = {}
    for c in candidates:
        s = c.get("stage") or "Unknown"
        stage_counts[s] = stage_counts.get(s, 0) + 1

    lines = [f"Total Candidates: {len(candidates)}", "", "By Stage:"]
    for stage, count in sorted(stage_counts.items(), key=lambda x: -x[1]):
        lines.append(f"  {stage}: {count}")
    return "\n".join(lines)


# ============================================================
# JOB TOOLS
# ============================================================


@mcp.tool()
def list_jobs(
    search: str = "",
    status: str = "",
    limit: int = 20,
) -> str:
    """List jobs. Filter by status (Active/Draft/Closed) or search by title/description."""
    limit = max(1, min(int(limit), 100))
    query = supabase.table("jobs").select("*").is_("deleted_at", "null")
    search_filter = ilike_any(["title", "description"], search)
    if search_filter:
        query = query.or_(search_filter)
    if status:
        try:
            query = query.eq("status", validate_choice(status, JOB_STATUSES, "status"))
        except ValueError as exc:
            return str(exc)

    result = query.order("created_at", desc=True).limit(limit).execute()
    jobs = result.data

    if not jobs:
        return "No jobs found."

    lines = [f"Found {len(jobs)} job(s):"]
    for j in jobs:
        lines.append(
            f"- [{j['id']}] {j['title']} | Country: {j.get('country') or 'N/A'} | "
            f"Salary: {j.get('salary_min') or 'N/A'}-{j.get('salary_max') or 'N/A'} | Status: {j['status']}"
        )
    return "\n".join(lines)


@mcp.tool()
def add_job(
    title: str,
    country: str = "",
    salary_min: str = "",
    salary_max: str = "",
    currency: str = "KWD",
    description: str = "",
    requirements: str = "",
) -> str:
    """Create a new job posting."""
    if not title.strip():
        return "Title is required."
    try:
        data = {
            "title": title.strip(),
            "country": country,
            "salary_min": float(salary_min) if salary_min else None,
            "salary_max": float(salary_max) if salary_max else None,
            "currency": currency,
            "description": description,
            "requirements": requirements,
            "status": "Active",
        }
    except ValueError:
        return "salary_min and salary_max must be numbers."
    result = supabase.table("jobs").insert(data).execute()
    if result.data:
        j = result.data[0]
        return f"Job created! ID: {j['id']}, Title: {j['title']}"
    return "Failed to create job."


@mcp.tool()
def update_job(job_id: str, updates: str) -> str:
    """Update a job. Pass updates as JSON, e.g. '{"status": "Closed"}'."""
    try:
        update_data = clean_updates(updates, {"status": JOB_STATUSES})
    except ValueError as exc:
        return str(exc)

    result = supabase.table("jobs").update(update_data).eq("id", job_id).execute()
    if result.data:
        return f"Job {job_id} updated."
    return "Failed to update job (not found?)."


# ============================================================
# APPOINTMENT TOOLS
# ============================================================


@mcp.tool()
def list_appointments(status: str = "", limit: int = 20) -> str:
    """List appointments ordered by date. Filter by status (Scheduled/Completed/Cancelled/Rescheduled)."""
    limit = max(1, min(int(limit), 100))
    query = supabase.table("appointments").select("*, candidates(name)")
    if status:
        try:
            query = query.eq("status", validate_choice(status, APPOINTMENT_STATUSES, "status"))
        except ValueError as exc:
            return str(exc)
    result = query.order("date", desc=False).limit(limit).execute()
    appts = result.data

    if not appts:
        return "No appointments found."

    lines = [f"Found {len(appts)} appointment(s):"]
    for a in appts:
        cand = a.get("candidates") or {}
        cand_name = cand.get("name", "N/A") if cand else "N/A"
        lines.append(
            f"- [{a['id']}] {a['title']} | Candidate: {cand_name} | "
            f"Date: {a['date']} {a.get('time') or ''} (EAT) | Status: {a['status']}"
        )
    return "\n".join(lines)


@mcp.tool()
def schedule_appointment(
    title: str,
    date: str,
    time: str = "",
    candidate_id: str = "",
    appointment_type: str = "Interview",
    notes: str = "",
) -> str:
    """Schedule a new appointment. Date format: YYYY-MM-DD, time HH:MM (Africa/Nairobi local time)."""
    if not title.strip():
        return "Title is required."
    if candidate_id:
        found = supabase.table("candidates").select("id").eq("id", candidate_id).limit(1).execute()
        if not found.data:
            return f"Candidate {candidate_id} not found."
    data = {
        "title": title.strip(),
        "date": date,
        "time": time or None,
        "candidate_id": candidate_id or None,
        "type": appointment_type,
        "status": "Scheduled",
        "notes": notes,
    }
    result = supabase.table("appointments").insert(data).execute()
    if result.data:
        a = result.data[0]
        return f"Appointment scheduled! ID: {a['id']}, Title: {a['title']}, Date: {a['date']} {a.get('time') or ''}"
    return "Failed to schedule appointment."


# ============================================================
# TASK TOOLS
# ============================================================


@mcp.tool()
def list_tasks(status: str = "", limit: int = 20) -> str:
    """List tasks. Filter by status (Pending/In Progress/Completed/Overdue)."""
    limit = max(1, min(int(limit), 100))
    query = supabase.table("tasks").select("*")
    if status:
        try:
            query = query.eq("status", validate_choice(status, TASK_STATUSES, "status"))
        except ValueError as exc:
            return str(exc)
    result = query.order("due_date", desc=False).limit(limit).execute()
    tasks = result.data

    if not tasks:
        return "No tasks found."

    lines = [f"Found {len(tasks)} task(s):"]
    for t in tasks:
        lines.append(
            f"- [{t['id']}] {t['title']} | Priority: {t['priority']} | "
            f"Status: {t['status']} | Due: {t.get('due_date') or 'N/A'}"
        )
    return "\n".join(lines)


@mcp.tool()
def add_task(
    title: str,
    description: str = "",
    priority: str = "Medium",
    due_date: str = "",
) -> str:
    """Create a new task. Priority: Low/Medium/High/Urgent."""
    if not title.strip():
        return "Title is required."
    try:
        validate_choice(priority, TASK_PRIORITIES, "priority")
    except ValueError as exc:
        return str(exc)
    data = {
        "title": title.strip(),
        "description": description,
        "status": "Pending",
        "priority": priority,
        "due_date": due_date or None,
    }
    result = supabase.table("tasks").insert(data).execute()
    if result.data:
        t = result.data[0]
        return f"Task created! ID: {t['id']}, Title: {t['title']}"
    return "Failed to create task."


@mcp.tool()
def update_task(task_id: str, updates: str) -> str:
    """Update a task. Pass updates as JSON, e.g. '{"status": "Completed"}'."""
    try:
        update_data = clean_updates(updates, {"status": TASK_STATUSES, "priority": TASK_PRIORITIES})
    except ValueError as exc:
        return str(exc)

    result = supabase.table("tasks").update(update_data).eq("id", task_id).execute()
    if result.data:
        return f"Task {task_id} updated."
    return "Failed to update task (not found?)."


# ============================================================
# REPORTING TOOLS
# ============================================================


@mcp.tool()
def get_dashboard_stats() -> str:
    """Get dashboard statistics: total candidates, active jobs, pending tasks, placements."""
    candidates = supabase.table("candidates").select("stage").is_("deleted_at", "null").execute().data
    jobs = supabase.table("jobs").select("id").eq("status", "Active").is_("deleted_at", "null").execute().data
    tasks = supabase.table("tasks").select("status").execute().data

    pending_tasks = sum(1 for t in tasks if t["status"] in ("Pending", "In Progress"))
    placed = sum(1 for c in candidates if c.get("stage") == "Placed")

    lines = [
        "=== Naim CRM Dashboard ===",
        f"Generated: {to_nairobi(utc_now_iso())}",
        f"Total Candidates: {len(candidates)}",
        f"Active Jobs: {len(jobs)}",
        f"Pending Tasks: {pending_tasks}",
        f"Candidates Placed: {placed}",
        "",
        "Stage Breakdown:",
    ]
    stage_counts = {}
    for c in candidates:
        s = c.get("stage") or "Unknown"
        stage_counts[s] = stage_counts.get(s, 0) + 1
    for stage, count in sorted(stage_counts.items(), key=lambda x: -x[1]):
        lines.append(f"  {stage}: {count}")

    return "\n".join(lines)


@mcp.tool()
def get_candidates_by_country() -> str:
    """Get candidate count grouped by destination country."""
    result = supabase.table("candidates").select("country_applying_to").is_("deleted_at", "null").execute()
    candidates = result.data

    if not candidates:
        return "No candidates found."

    country_counts = {}
    for c in candidates:
        country = c.get("country_applying_to") or "Unknown"
        country_counts[country] = country_counts.get(country, 0) + 1

    lines = ["Candidates by Country:"]
    for country, count in sorted(country_counts.items(), key=lambda x: -x[1]):
        lines.append(f"  {country}: {count}")
    return "\n".join(lines)


if __name__ == "__main__":
    mcp.run(transport="stdio")
