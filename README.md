# Naim CRM

Operations app of **Naim Investments Ltd** (recruitment agency, Mombasa, Kenya → Gulf placements).
The CRM is the single source of truth for **candidates, jobs, stages, documents, tasks and appointments**.

> Production URL: _pending first Netlify deploy (owner-managed)_ · Task ledger: [STATUS.md](STATUS.md)

## Architecture

| Layer | What | Notes |
| --- | --- | --- |
| Frontend | React 19 + Vite + Tailwind SPA | Netlify, anon key + user session only; route-level code splitting |
| Data | Supabase Postgres + Auth + Storage | RLS on every table; `documents` bucket is **private** (signed URLs, 600 s) |
| Backend port | `mcp-server/server.py` (FastMCP) | Hermes Agent operates the CRM with the **service_role** key, server-side only |
| Browser port | WebMCP (`navigator.modelContext`) | Phase 3.5, feature-detected; see `docs/WEBMCP.md` |
| Automation | Hermes Agent (Naim, Juma, Salmin, Jamal, Ali, Mohamed) | Consumes `automation_jobs`; see `docs/HERMES-INTEGRATION.md`. n8n is retired. |

The CRM never calls LLM APIs and never embeds AI keys. All intelligence runs in Hermes.

## Features (Phase 2, next generation)

* **Dashboard 2.0** – live KPI cards (active candidates, placements this month, expiring documents, tasks due today /
  overdue) and real charts (pipeline funnel, 6-month intake, candidates by destination) from Supabase. Demo figures
  appear only in dev demo mode, labelled **Demo data**.
* **Global search (Ctrl/Cmd + K)** – pages, candidates, jobs, tasks, appointments, documents and CVs; every remote
  filter goes through `sanitizeSearch()`/`ilikeAny()` (CRM-8). Candidate and document results open the candidate's
  profile. Works on phones as a full-width bar.
* **Pipeline board** (`/pipeline`) – drag-and-drop Kanban over the canonical stages, with a "Move to…" menu on every
  card for keyboard and touch users. Moves are optimistic and roll back on failure.
* **Stage-transition rules** – checkpoints can't be skipped: **Interview → Offer → Visa Processing → Placed** must each
  be passed in order (e.g. New → Placed is refused). Other stages are optional; moving back, rejecting, withdrawing or
  parking as Pending is allowed; Completed is final (only back to Placed). One rule set in
  `src/utils/stageTransitions.js`, mirrored by the DB trigger `enforce_stage_transition` (migration 004), so the rule
  holds for the UI, Hermes/MCP and SQL alike.
* **Candidate profile** (`/candidates/:id`) – details, validated stage changes, document center, history, linked tasks
  and appointments, and **Build CV with AI** (queues a `cv_build` job for Hermes).
* **Document center** – per-candidate checklist (passport, CV, medical, good conduct, visa) with Missing / Expired /
  ≤30 days / ≤90 days / Valid indicators and editable expiry dates. Viewing always uses a fresh signed URL.
* **Activity log** – `activity_log` table, written by the service layer for browser changes and by a DB trigger for
  Hermes/service-role changes (no double entries). Append-only; actor and time are forced server-side.
* **Notifications** – bell feed + a once-per-session toast for urgent items: expiring/expired documents, candidates with
  no update in 14 days, tasks due today or overdue. Refreshes every 5 minutes and on window focus.
* **Recycle Bin** – candidates, jobs, tasks, appointments and documents are all soft-deleted; bulk restore / permanent
  delete. Permanently deleting a document also removes its stored file.
* **Polish** – lazy-loaded pages, skeleton loaders, error boundaries (with stale-chunk reload), empty states, mobile
  navigation drawer, skip link, labelled form controls.

## Roles & permissions (enforced in the database, not only the UI)

| Capability | Staff (`user` / `manager`) | Admin |
| --- | --- | --- |
| Create / edit candidates, jobs, tasks, appointments, documents | ✅ | ✅ |
| Delete (moves to Recycle Bin) | ✅ | ✅ |
| Restore from Recycle Bin | ❌ (trigger `guard_recycle_bin_restore`) | ✅ |
| Permanent delete (rows + stored files) | ❌ (RLS DELETE policies) | ✅ |
| Change roles / page permissions | ❌ (001 `protect_profile_privileges`) | ✅ |
| Manage WhatsApp templates | ❌ (003 RLS) | ✅ |
| Settings and Recycle Bin pages | hidden + route-guarded | ✅ |

New invitees get the staff page set by default (migration 004). Page visibility lives in `src/utils/permissions.js`.

## Revenue law: no money model (CRM-11)

Naim Investments operates under a strict revenue law. **Type A:** the employer pays; the candidate is never charged.
**Type B:** the candidate pays at most one month's salary, and only after being deployed, working and receiving the first salary.

Enforcement lives in the separate **NAIM SYSTEM compliance guard**, outside this repo. Therefore the CRM has
**no payment collection, invoicing, billing or money-movement feature, by design.** Salary fields describe the job
offer only. Do not add a billing module.

## Demo data policy (CRM-9 / CRM-10)

* `src/services/demoData.js` (and `src/components/reports/reportsData.js`) is the official, organized **dev seed**.
* Demo data renders **only** in a dev build with no Supabase config (`npm run dev` without `.env`), under a permanent
  red **DEMO MODE — NOT PRODUCTION** banner.
* A **production build without Supabase config refuses to run** and shows a configuration error screen. There is no
  silent demo admin.
* The production database launches **clean**: never import demo rows into it.

## Environment

Frontend (`.env`, gitignored; on Netlify set as site environment variables):

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon / publishable key>
```

MCP server (`mcp-server/.env`, on the VPS only): see `mcp-server/.env.example`.
`SUPABASE_SERVICE_ROLE_KEY` must **never** appear in a `VITE_*` variable, the browser, or git. The server refuses to
start with an anon/publishable key.

## Database setup (order matters)

Run in the Supabase SQL editor, in this order:

1. `supabase-schema.sql` (bootstrap)
2. `supabase/migrations/001_security.sql` (private bucket, `is_admin()` SECURITY DEFINER, no self-escalation)
3. `supabase/migrations/002_candidate_stages.sql` (canonical stage CHECK constraint)
4. `supabase/migrations/003_automation_jobs_whatsapp.sql` (Hermes job queue, WhatsApp templates)
5. `supabase/migrations/004_phase2.sql` (document expiry, soft delete everywhere, activity log, stage-transition
   trigger, admin-only restore/permanent delete)
6. later migrations in numeric order

**Deploy the Phase 2 frontend only after 004 is applied**: the services filter on the new `deleted_at` columns.

Auth: enable email/password, **disable public sign-ups** (Authentication → Providers → Email → "Allow new users to
sign up" off) and invite users from Authentication → Users → Invite. Promote the Boss's account to admin:

```sql
UPDATE users_profiles SET role = 'admin', page_permissions = ARRAY['dashboard','candidates','pipeline','jobs','appointments','tasks','documents','reports','settings','associates','cv-builder','job-generator','receptionist-view','recycle-bin','whatsapp']
WHERE id = (SELECT id FROM auth.users WHERE email = '<admin email>');
```

## Develop

```
npm ci
npm run dev          # demo mode if no .env
npm test             # node tests: document security, search sanitizer, stage vocabulary,
                     # stage transitions, document checklist, notifications, permissions
npm run test:mcp     # python unit tests for the MCP helpers
npm run build
```

MCP server: `cd mcp-server && pip install -r requirements.txt && python server.py` (stdio transport).

## Deploy (Netlify)

Build `npm run build`, publish `dist` (already in `netlify.toml`, which also provides the SPA deep-link redirect
and security headers). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify; never commit them.

## Canonical candidate stages

`New, Source, Screening, Interview, Assessment, Shortlist, Offer, Contract Signing, Visa Processing, Onboarding,
Placed, Completed, Rejected, Withdrawn, Pending, Draft` (defined once in `src/utils/constants.js`, mirrored in the MCP
server and enforced by a DB CHECK constraint; `npm test` fails if they drift).
