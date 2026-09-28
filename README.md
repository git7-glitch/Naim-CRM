# Naim CRM

Operations app of **Naim Investments Ltd** (recruitment agency, Mombasa, Kenya → Gulf placements).
The CRM is the single source of truth for **candidates, jobs, stages, documents, tasks and appointments**.

> Production URL: _pending first Netlify deploy (owner-managed)_ · Task ledger: [STATUS.md](STATUS.md)

## Architecture

| Layer | What | Notes |
| --- | --- | --- |
| Frontend | React 19 + Vite + Tailwind SPA | Netlify, anon key + user session only |
| Data | Supabase Postgres + Auth + Storage | RLS on every table; `documents` bucket is **private** (signed URLs, 600 s) |
| Backend port | `mcp-server/server.py` (FastMCP) | Hermes Agent operates the CRM with the **service_role** key, server-side only |
| Browser port | WebMCP (`navigator.modelContext`) | Phase 3.5, feature-detected; see `docs/WEBMCP.md` |
| Automation | Hermes Agent (Naim, Juma, Salmin, Jamal, Ali, Mohamed) | Consumes `automation_jobs`; see `docs/HERMES-INTEGRATION.md`. n8n is retired. |

The CRM never calls LLM APIs and never embeds AI keys. All intelligence runs in Hermes.

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
5. later migrations in numeric order

Auth: enable email/password, **disable public sign-ups** (Authentication → Providers → Email → "Allow new users to
sign up" off) and invite users from Authentication → Users → Invite. Promote the Boss's account to admin:

```sql
UPDATE users_profiles SET role = 'admin', page_permissions = ARRAY['dashboard','candidates','jobs','appointments','tasks','documents','reports','settings','associates','cv-builder','job-generator','receptionist-view','recycle-bin','whatsapp']
WHERE id = (SELECT id FROM auth.users WHERE email = '<admin email>');
```

## Develop

```
npm ci
npm run dev          # demo mode if no .env
npm test             # node tests: document security, search sanitizer, stage vocabulary
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
