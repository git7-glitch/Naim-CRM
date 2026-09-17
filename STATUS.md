# NAIM CRM — Production readiness status

Started: 2026-09-17. This ledger records verified results, not promises. Production readiness is NOT established.

Legend: [ ] pending; [~] in progress; [x] done and tested; [!] blocked (reason); [✓] verified already-fixed (evidence).

## Master Prompt Instructions Ledger

### Operating rules / project
- [x] Create STATUS.md before implementation. Initial directory inspection was necessary to avoid overwriting an existing ledger.
- [ ] Maintain every task, phase, instruction and verification evidence in this ledger; update and commit after every completed task; record dated work and commit references.
- [ ] On resumption re-read STATUS.md; verify current code, not predecessor commit 28e12cf or historical line numbers. Classify broken / partial / already fixed.
- [ ] Use only selected trevor93/Naim-CRM repository, main branch; do not clone or substitute another repo. Small meaningful commits and regular authenticated pushes.
- [ ] Build, run and test fixes before completion; never claim blocked work is complete; record blockers and continue independent tasks.
- [ ] Preserve React 19/Vite/Tailwind SPA, Supabase Postgres/Auth/Storage/RLS, Netlify, FastMCP and progressive WebMCP. English UI, EN/AR/SW business context; Boss Abdalla Mohamed and staff.
- [ ] Money law: Type A employer pays, candidate never charged; Type B at most one month salary only after deployment/work/first salary. Enforcement belongs exclusively to NAIM SYSTEM guard. No CRM billing, invoicing, collections or money movement features.
- [ ] CRM is source of truth for candidates/jobs/documents. Hermes handles automation, never n8n or frontend AI APIs. No model/service-role secrets in frontend or git; ignore .env; browser uses anon key/session only.
- [!] Platform limitation: built-in one-click hosting targets Cloudflare, while requested target is Netlify and separate Python MCP hosting. Preserve requested architecture; external deployment requires access.

### Phase 1 — verify first, CRM-1 through CRM-12 in order
- [!] CRM-1 code fixed and 3 regression tests passing; private bootstrap + 001_security.sql, null stored URL, rollback preserved, signed preview (600s, refresh), authenticated downloads, no public URL consumers. BLOCKED: apply to actual Supabase and live upload/view/anonymous denial tests (credentials absent).
- [ ] CRM-2 MCP reads SUPABASE_SERVICE_ROLE_KEY only server-side; loud .env.example warning; never browser bundle.
- [ ] CRM-3 audit recursive profile RLS; SECURITY DEFINER is_admin with fixed search_path, revoked public/granted authenticated execution; test both admin and staff profile loads.
- [ ] CRM-4 audit every Reports card source; live service-layer stage/country/placements queries whenever configured; labeled organized demo only dev/demo; loading/empty/error states; exports and printing use live data. Configured empty production remains empty, not demo.
- [ ] CRM-5 verify/add Netlify SPA catch-all to /index.html status 200 and test deep links.
- [ ] CRM-6 audit all frontend/MCP/SQL stage literals against CANDIDATE_STAGES; remove ghost stages only if present; DB CHECK/enum; record grep/test evidence.
- [ ] CRM-7 replace naive utcnow with timezone-aware UTC; Africa/Nairobi user-facing dates.
- [ ] CRM-8 shared tested safe search util for frontend candidate/appointment/job/task and all other search entry points; equivalent tested MCP sanitization; no raw PostgREST interpolation.
- [ ] CRM-9 preserve organized development seed/module; never render/seed demos in configured production; README policy.
- [ ] CRM-10 production missing Supabase must hard-fail, never demo admin; dev demo permanent prominent banner.
- [ ] CRM-11 verify no money model/features; README external NAIM SYSTEM compliance ownership.
- [ ] CRM-12 WhatsApp DB templates, enqueue whatsapp_send via agent, processed status; no WhatsApp server inside CRM.

### Phase 2 — only after Phase 1 completed/verified
- [ ] Dashboard 2.0 live stage funnel, placements this month, expiring good-conduct/medical docs, today's tasks, real charts.
- [ ] Cmd-K global candidates/jobs/tasks/documents search using safe search util.
- [ ] Drag/drop canonical-stage Kanban with optimistic update, rollback and transition validation (no New→Placed jump).
- [ ] Candidate document checklist: passport/CV/medical/good-conduct/visa, missing/expiry indicators, signed viewing only.
- [ ] activity_log migration and attributed service writes; candidate history UI.
- [ ] Toasts and notification bell feed for expiring docs/stale candidates/configurable N days/tasks due.
- [ ] Route code splitting, skeletons, error boundaries, empty states, every-page responsive/accessibility audit.
- [ ] Verify all-entity soft delete/recycle and clean restore.
- [ ] Admin/staff permissions enforced both UI and RLS; test direct access, not UI only.

### Phase 3 — FastMCP / Hermes backend docking port
- [ ] Verify service-role isolation, aware dates, sanitized filters (CRM-2/7/8).
- [ ] Every tool returns consistent structured {ok,data,error} envelope.
- [ ] Add/verify enqueue_automation_job, complete_automation_job, list_pending_jobs, get_candidate_full including docs/tasks/stage history, upsert_lead.
- [ ] Validate every tool: IDs exist, canonical stages, enum checks and other inputs.
- [ ] mcp-server/README.md documents every tool, parameters and example calls.

### Phase 3.5 — progressive browser WebMCP
- [ ] Verify current official Chrome API, availability, origin-trial and security guidance rather than assuming prompt preview claims are current.
- [ ] src/webmcp/registerTools.js feature detection; ordinary browsers unchanged; authenticated registration and logout cleanup; same UI service layer and user RLS; no elevated keys or cross-origin iframe registration.
- [ ] Strict schemas and structured outputs: search_candidates(query,stage?,country?), get_candidate_summary(candidate_id), get_reports_summary().
- [ ] Strict schemas and visible confirmation for add_candidate(name,phone,email?,country_interest?), update_candidate_stage(candidate_id,canonical stage) with transition checks.
- [ ] Strict schemas and visible confirmation for create_task(title,due_date,candidate_id?), book_appointment(candidate_id,datetime,purpose), enqueue_automation_job(job_type,payload).
- [ ] Preserve origin isolation; no Origin-Agent-Cluster:?0 or document.domain; default tools policy self.
- [!] Production-origin trial enrollment/token and real browser Tool Inspector verification require production origin, owner/browser availability and actual program eligibility. Ship feature-detected code regardless.
- [ ] docs/WEBMCP.md exposure/schemas/Inspector/testing flag/security; README trial token renewal; install valid origin-bound token only if issued.

### Phase 4 — Supabase production activation
- [!] Production project credentials and migration authority not yet supplied/verified. Asked owner once for secure configuration; continue independent work.
- [ ] Apply complete schema and all ordered supabase/migrations to production; record migration evidence.
- [ ] RLS enabled every table; unauthenticated anon-key no-leak tests, authenticated role tests.
- [ ] Private bucket end-to-end upload/signed viewing verification.
- [!] Boss admin and staff email addresses/invitation access required; enable email/password, invite accounts, disable public signup; do not invent credentials.
- [ ] Production clean database, no development seed rows.

### Phase 5 — Hermes automation surfaces (never n8n)
- [ ] automation_jobs: UUID/job_type/payload/status/result/requested_by/claimed_at/finished_at/created_at; pending/claimed/done/failed constraints; RLS authenticated read/insert; attribution protected; no client claim/complete update policy.
- [ ] Candidate Build CV with AI → cv_build; WhatsApp Send via agent → whatsapp_send; Leads enrichment → lead_enrich; polling/realtime pending-to-done/error status.
- [ ] Leads table/page name/phone/source/country interest/status/notes/converted_candidate_id; Hermes upsert; one-click atomic candidate conversion.
- [ ] cv_drafts: Hermes PDF storage/candidate document links, CRM draft render and one-click approval.
- [ ] docs/HERMES-INTEGRATION.md: shapes/tools/job_type contracts/examples; Naim chief of staff; Juma Operator queue/pipeline; Salmin Designer CV drafts; Jamal Strategist reports; Ali Researcher leads; Mohamed Assistant intake/scheduling. Name contracts by agent responsibility.
- [ ] No frontend LLM calls or AI keys, including WebMCP; automation executed on owner VM/VPS via Hermes skills and MCP.

### Phase 6 — Netlify and final QA
- [!] Netlify site/repository-link/environment/deployment authorization not yet supplied/verified; no substitute Cloudflare deployment.
- [ ] Deploy selected GitHub main branch to Netlify; set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in environment only.
- [ ] Verify production deep links/login/all CRUD/private document upload and signed view/live reports/no production demo.
- [ ] Verify WebMCP production-origin registration/trial token and Tool Inspector tests in supported browser.
- [ ] Full every-page manual QA with recorded results.
- [ ] Lighthouse performance/accessibility pass and address poor results.
- [ ] README overview/features/architecture/env/migration order/Hermes/WebMCP/production URL/data models/entry routes/missing features/next steps/deployment status/user guide.

### Definition of done / final handoff
- [ ] Every checklist item done/verified or honestly blocked AND owner-accepted; production app live, secured Supabase active, working account instructions.
- [ ] Deliver actual production link and login/invite instructions with STATUS.md ledger. Use requested fully-completed wording ONLY if verified true; otherwise explicitly identify outstanding work. Owner acceptance of blockers is not presumed.

## Running work log

- 2026-09-17 — Inspected workspace root (existing React CRM, not template); created required ledger before implementation. Production access request sent. Commit: 9910219.

## Verification evidence

- CRM-1 initially BROKEN: original documentService.js:20/27, DocumentPreview.jsx:29, DocumentsPage.jsx:463, supabase-schema.sql:182/190. All identified consumers removed or signed. `node --experimental-vm-modules --test tests/*.test.mjs`: 3/3 pass; `npm run build`: PASS (existing large bundle warning). PM2 static preview `/documents`: HTTP 200. These mocked tests do not establish live Storage security.
- Repository identity verified: origin https://github.com/trevor93/Naim-CRM.git, branch main; fetched remote, no missing upstream commits. GitHub credentials setup succeeded. No SUPABASE/NETLIFY environment variable names were present.
- 2026-09-17 — CRM-1 implementation and migration staged; current schema recursive UPDATE policy and self-escalation discovered; 001_security.sql also prepares CRM-3 protection. Implementation commit: see next `fix: privatize candidate documents` commit (ledger committed with change).
