# NAIM CRM — Production readiness status

Started: 2026-09-17. Resumed: 2026-09-28. This ledger records verified results, not promises. **Production readiness is NOT established yet.**

Legend: [ ] pending; [~] in progress / code landed, verification pending; [x] done and tested; [!] blocked (reason); [✓] verified already-fixed (evidence).

## Verification caveat (read first)

The 2026-09-28 sessions edit the repo through the GitHub API. They have **no network to install npm/pip dependencies**, so `npm run build`, the Vite app and a live browser/Supabase run could NOT be executed against the repo. What WAS verified:

* Session 1: sanitizer JS 4/4, MCP helpers Python 8/8, server.py py_compile OK.
* Session 2 (Phase 2): every new/changed module compiled together with **esbuild** (full `src/App.jsx` graph, code-split into one chunk per route, 0 errors; unchanged modules stubbed with their real export names); every lucide icon name checked against the library's canonical exports; **17/17 new node tests pass** (stage transitions incl. JS==SQL parity, document checklist, notifications, permissions); ghost-stage grep over `src/` + `supabase/` clean; all 37 pushed files re-verified byte-for-byte against the tested copies by git blob SHA.

Every item marked [~] still needs, on the owner's machine or CI: `npm ci && npm test && npm run build && npm run test:mcp`, migrations applied (001→004), then a live smoke test.

## Master Prompt Instructions Ledger

### Operating rules / project
- [x] STATUS.md exists in repo root and is the resume point (created 2026-09-17, commit 9910219).
- [~] Maintain every task/instruction/evidence here; update + commit after each task; dated work log with commit hashes.
- [x] VERIFY-FIRST: each CRM item below was checked against current code (not commit 28e12cf line numbers). Findings recorded per item.
- [x] Work only on the selected repo **jayvendah17/Naim-CRM**, branch main (owner instruction, Master Prompt v2 §1); no clone of another repo. Small meaningful commits pushed to main.
- [~] Build, run and test fixes before completion (see caveat above).
- [x] Preserve stack: React 19/Vite/Tailwind SPA, Supabase Postgres/Auth/Storage/RLS, Netlify, FastMCP, progressive WebMCP. English UI. No new npm dependencies added in Phase 2 (lockfile untouched; drag-and-drop is native HTML5, charts use the existing recharts).
- [✓] MONEY LAW: no payment/invoicing/charging code exists; README documents that enforcement lives in the NAIM SYSTEM guard (CRM-11). Phase 2 added none.
- [x] No secrets in repo/frontend: browser uses anon key only (src/supabase/client.js); service_role only in mcp-server env; .env gitignored.
- [x] Architecture law: CRM exposes surfaces (automation_jobs, MCP); automation runs in Hermes, not n8n, not in the CRM. No frontend LLM calls.
- [x] Netlify deploy is owner-managed (owner will deploy; no NETLIFY_AUTH_TOKEN used).

### Phase 1 — CRM-1 … CRM-12
- [!] **CRM-1** private bucket + signed URLs. Code fixed 2026-09-17 (commit b993fa0): 001_security.sql, file_url null on upload, getSignedUrl(path, 600), no getPublicUrl consumers, 3 tests. Phase 2 document center views only via getSignedUrl. BLOCKED: apply to live Supabase + live upload/view/anon-denial test (needs production project).
- [x] **CRM-2** MCP service_role. Found STILL BROKEN (read SUPABASE_KEY, .env.example pointed at anon). Fixed: reads SUPABASE_SERVICE_ROLE_KEY only, refuses anon/publishable JWTs (`assert_service_role_key`), loud .env.example warning. Also found server.py used `.or(` / `.is(` (Python keywords → SyntaxError, server could never start); now `or_`/`is_`. Evidence: test_crm_helpers KeyTests pass; py_compile OK. Commit fb4c97b. Live run pending key.
- [!] **CRM-3** RLS recursion. Verified: current schema's recursive policy is the admin UPDATE policy (SELECT is `USING (true)`); 001_security.sql replaces it with SECURITY DEFINER `is_admin()` (search_path fixed, EXECUTE revoked from public, granted to authenticated) and blocks self-escalation. BLOCKED: admin + staff login test on live DB.
- [~] **CRM-4** Reports live. Verified: every card used static reportsData.js. Fixed: src/services/reportsService.js (paged past 1000-row cap, stage/country/placements/tasks/jobs/appointments, Nairobi dates); ReportsPage uses live data whenever Supabase is configured, demo only in dev demo mode with "Demo data" badge; skeleton/error/empty states; export + print use live rows. Commit a265e9e. Pending: build + live check.
- [x] **CRM-5** SPA 404s. Verified: netlify.toml had NO redirect. Added `/* → /index.html 200` + security headers (no Origin-Agent-Cluster, no Permissions-Policy override). Commit fb4c97b. Deep-link check on deploy pending (new routes /pipeline and /candidates/:id rely on it).
- [~] **CRM-6** Stage vocabulary. Verified: **NOT fixed** as reported. StatusDropdown offered 2 ghost stages and fed the Candidates page, edit form and CV Builder; candidateService + CandidatesPage auto-delete used 'Hired'; demo/report fixtures used ghosts; MCP had its own copy; no DB constraint. Fixed: StatusDropdown derives from CANDIDATE_STAGES; normalizeStage() folds legacy values read-side; TERMINAL_STAGES for auto-delete; migration 002 remaps old rows + CHECK + NOT NULL; tests/stage-vocabulary.test.mjs. Commits fb4c97b, a265e9e, 513316c, b4fd865. **2026-09-28 session 2 straggler found:** DashboardPage.jsx kept a private dropdown with 'Interviewing'/'Hired' (would fail `npm test`); replaced by the canonical StatusDropdown (commit ee836b7). Grep of src/ + supabase/ now clean. Pending: run `npm test`.
- [x] **CRM-7** Timestamps. Verified: 6× `datetime.utcnow().isoformat()`. Replaced with `utc_now_iso()` (timezone.utc); human output via `to_nairobi()` (Africa/Nairobi, tzdata added). Test: TimeTests pass. Commit fb4c97b.
- [x] **CRM-8** Filter injection. Verified still present in candidate/job/task services (`.or()` raw), appointment (`ilike` raw), globalSearchService (partial strip) and MCP f-strings. Fixed: src/utils/sanitizeSearch.js (`sanitizeSearch`, `ilikeAny`, Unicode whitelist, 100-char cap) used at every entry point; Python mirror. Phase 2 search entry points (pipeline search, Cmd-K) reuse it. Tests: sanitize-search 4/4, SanitizeTests pass. Commits fb4c97b, a265e9e.
- [~] **CRM-9** Demo data policy. demoData.js + reportsData.js labelled DEV SEED; README policy; global search no longer serves demo CVs in production. Phase 2: Header's hardcoded demo notifications replaced by the live feed; Dashboard KPIs label demo figures "Demo data" and only in dev demo mode. Pending: audit DocumentsPage/documentsStore for demo fallbacks while configured; production DB clean (Phase 4).
- [x] **CRM-10** Skeleton key. Verified: AuthContext granted DEMO admin whenever !isSupabaseConfigured, including production. Fixed: `isDemoMode` (dev only) / `isMisconfiguredProduction`; App renders ConfigErrorScreen in prod; permanent DemoModeBanner in dev; profile-load failure grants nothing; public register removed (invite-only). Commit a265e9e. Pending build check.
- [✓] **CRM-11** No money model. Evidence: src/services has no payment/invoice/billing module; App.jsx routes contain none (re-checked after Phase 2: none added). README section.
- [x] **CRM-12** WhatsApp. Fixed: migration 003 (automation_jobs + attribution trigger; whatsapp_templates admin-managed, seeded); page loads DB templates, "Send via agent" enqueues whatsapp_send, status polling; wa.me kept as manual fallback. Phase 2 added WhatsApp to the sidebar (it was only reachable by URL/search). Live test blocked on Supabase.

### Phase 2 — next-generation upgrades
Started 2026-09-28 on the owner's explicit instruction ("proceed to Phase 2") while CRM-1/3 remain blocked only on the live Supabase project. All code below is landed; **apply migration 004 before deploying this frontend** (services filter on the new deleted_at columns).

- [~] **Dashboard 2.0.** Verified first: the half-built kpiService (e419d3c) queried non-existent columns (`doc_type`, and `documents.expiry_date` did not exist), used a 6-item ghost stage list, counted placements as 'Completed', and imported a `demoKPIs` export that doesn't exist (would break the build once imported). Rewritten: canonical stages, Nairobi month bounds, paged past 1000 rows, placements this month = activity_log stage→Placed ∪ candidates currently Placed updated this month. New `components/dashboard/DashboardInsights.jsx` (own lazy chunk): KPI cards (active candidates, placements this month, expiring documents expired/≤30d/≤90d, tasks due today + overdue), recharts funnel / 6-month intake / destinations, expiring-document and due-task lists. Commits c14e747, df7fdc8, ee836b7.
- [~] **Cmd-K global search** across pages/candidates/jobs/tasks/appointments/documents/CVs via sanitizeSearch/ilikeAny. Verified first: already existed (desktop only; candidate hits went to a filtered list). Upgraded: Ctrl/Cmd+K and a full-width bar on phones, candidate hits open the profile, document hits open that candidate's document center, Pipeline page indexed, deleted rows skipped. Commits c14e747, 7f18b06.
- [~] **Drag-and-drop Kanban** (`/pipeline`): native HTML5 DnD over the 12 pipeline stages (+ optional Pending/Draft/Rejected/Withdrawn columns), keyboard/touch "Move to…" menu listing only legal targets, illegal columns dimmed while dragging, optimistic update + rollback + toast. **Transition validation:** checkpoints Interview → Offer → Visa Processing → Placed can't be skipped (New→Placed refused); rules in `src/utils/stageTransitions.js`, mirrored by `is_valid_stage_transition()` + trigger `enforce_stage_transition` (migration 004) so MCP/Hermes/SQL obey it too. Evidence: tests/stage-transitions.test.mjs 7/7 incl. JS==SQL array parity. Commits 5cb7557, cd4c332, 7f18b06.
- [~] **Document center** (candidate profile → Documents): checklist passport / CV / medical / good conduct / visa with Missing, Expired, ≤30d, ≤90d, Valid, "No expiry set" indicators; newest renewal wins; upload with expiry date; inline expiry edit; view/download via signed URL only; delete → Recycle Bin. Migration 004 adds `documents.expiry_date`. Evidence: tests/document-checklist.test.mjs 4/4. Commits 5cb7557, cd4c332, df7fdc8. Follow-up: the legacy DocumentsPage (documentsStore) does not show expiry yet.
- [~] **activity_log** table + service-layer writes + candidate history UI. Append-only (no UPDATE/DELETE policies), actor + timestamp forced by trigger, browser writes via `activityService.logActivity` (candidate create/update/stage/delete/restore, document upload/update/delete/restore, task + appointment events, cv_build enqueue), service_role (Hermes) writes logged by DB trigger so there are no double entries. UI: `ActivityTimeline` on the profile. Commits 5cb7557, cd4c332, 7f18b06.
- [~] **Notifications**: bell feed (expiring/expired documents, candidates with no update in 14 days, tasks due today/overdue), per-user read state, refresh every 5 min + on focus, one urgent-alerts toast per session. Replaced the hardcoded demo notifications. Evidence: tests/notifications.test.mjs. Commits 5cb7557, c14e747, 9944afb.
- [~] **Performance & polish**: route-level code splitting (every page a lazy chunk, recharts isolated), Suspense skeletons, ErrorBoundary per route with stale-chunk reload, skeleton/empty/error states on all Phase 2 surfaces, mobile off-canvas nav + mobile search + responsive header, skip link, labelled controls. Commit 9944afb. **Not yet done:** a page-by-page mobile/accessibility audit of the large legacy pages (Candidates, Jobs, Tasks, Documents, CV Builder, Appointments) needs a real browser; folded into Phase 6 QA + Lighthouse.
- [~] **Soft-delete recycle bin for all entities.** Verified first: only candidates (and jobs) were soft-deleted; tasks, appointments and documents were HARD-deleted (documents also destroyed the stored file); the bin page listed candidates only, showed a hardcoded "Deleted about 2 months ago", and claimed a 30-day auto-delete that did not exist. Fixed: deleted_at on tasks/appointments/documents (migration 004), all deletes (incl. task auto-delete) are soft, bin lists all five types with bulk restore / permanent delete, file removed from storage only on permanent delete, honest policy text. Commits 5cb7557, cd4c332, c14e747, ee836b7. Pending: live restore round-trip per entity.
- [~] **Admin vs staff in UI AND RLS.** DB (migration 004): permanent DELETE admin-only on candidates/jobs/tasks/appointments/documents + storage objects; restore from bin admin-only (trigger `guard_recycle_bin_restore`); plus existing 001 (roles/permissions self-escalation guard) and 003 (templates admin-only). UI: `utils/permissions.js` guards routes and filters the sidebar; Settings + Recycle Bin admin-only; staff default page set on invite. Evidence: tests/permissions.test.mjs 5/5 (incl. SQL policy assertions). Commits 5cb7557, 9944afb. Pending: live admin vs staff test with salminabdalla93@gmail.com (admin) and salminmoha09@gmail.com (staff).

Phase 2 known follow-ups: CandidatesPage edits/bulk stage changes now go through transition validation and will show an error for illegal jumps (intended); MCP `update_candidate_stage` should mirror the rule in crm_helpers so Hermes gets a clean `{ok:false}` instead of a DB exception (Phase 3).

### Phase 3 — FastMCP hardening
- [x] service_role, tz-aware datetimes, sanitized filters (CRM-2/7/8).
- [ ] {ok, data, error} envelope on every tool.
- [ ] enqueue_automation_job, complete_automation_job, list_pending_jobs, get_candidate_full (candidate + docs + tasks + stage history from activity_log), upsert_lead.
- [~] Input validation: stages/enums/limits validated now; ID existence checks partial (appointments). Add stage-transition validation (mirror of stageTransitions.js).
- [ ] mcp-server/README.md documenting every tool.

### Phase 3.5 — WebMCP
- [ ] src/webmcp/registerTools.js, feature-detected, register after auth / unregister on logout, same service layer + RLS.
- [ ] Read tools: search_candidates, get_candidate_summary, get_reports_summary.
- [ ] Write tools with visible confirmation: add_candidate, update_candidate_stage (transition-validated via changeCandidateStage), create_task, book_appointment, enqueue_automation_job.
- [x] Origin isolation preserved (netlify.toml sets no Origin-Agent-Cluster, no document.domain, default tools policy).
- [!] Origin-trial token + Tool Inspector test need the production origin (owner deploy) and a trial registration.
- [ ] docs/WEBMCP.md + README token-renewal notes.

### Phase 4 — Supabase production
- [!] Production project URL + anon key + service_role key needed from owner (asked once, 2026-09-28).
- [ ] Apply schema + migrations 001→004 (+ later) in order; record evidence.
- [ ] RLS on every table (incl. activity_log); anon-key no-leak test; role tests.
- [ ] Private bucket upload + signed view end-to-end.
- [!] Accounts: invite admin salminabdalla93@gmail.com and staff salminmoha09@gmail.com; disable public sign-ups (owner action in Supabase dashboard, or with service_role access).
- [ ] Production DB launches clean (no dev seed rows).

### Phase 5 — Hermes automation surfaces
- [x] automation_jobs table (migration 003).
- [~] UI hooks: WhatsApp "Send via agent" done; "Build CV with AI" (cv_build) on the candidate profile done in Phase 2 (enqueue + status polling, commit df7fdc8); Leads (lead_enrich) pending.
- [ ] leads table + Leads page + one-click convert.
- [ ] cv_drafts integration (Hermes PDF → storage → candidate document, approve).
- [ ] docs/HERMES-INTEGRATION.md with per-agent job_type contracts (Naim, Juma, Salmin, Jamal, Ali, Mohamed).
- [x] No frontend LLM calls or AI keys.

### Phase 6 — Netlify + QA
- [!] Deploy is owner-managed; production URL pending.
- [ ] Verify deep links, login, CRUD, signed documents, live reports, no demo in prod, WebMCP on prod origin.
- [ ] Full manual QA per page (incl. mobile audit of legacy pages); Lighthouse pass.
- [~] README: overview/architecture/env/migration order (now 001→004)/policies/Phase 2 features/roles matrix done; production URL + Hermes/WebMCP docs pending.

### Definition of done
- [ ] Every box [x]/[✓] or owner-accepted [!]; live URL; secured Supabase; closing message only when true.

## Running work log

- 2026-09-17 — Ledger created (9910219). CRM-1 privatized documents + tests (b993fa0).
- 2026-09-28 — Resumed from STATUS.md. Verified CRM-2..12 against current code.
  - fb4c97b — CRM-2/5/7/8 + CRM-6 core.
  - a265e9e — CRM-4 live Reports, CRM-10 demo lockdown + invite-only login, CRM-6 CV Builder/report fixtures, global search fix, stage-vocabulary test.
  - 513316c — CRM-6 CandidatesPage auto-delete on TERMINAL_STAGES (+ a11y labels).
  - b4fd865 — CRM-6/9 demoData labelled DEV SEED, canonical 'Interview'.
  - 8471b0a — CRM-12 WhatsApp agent queue + migration 003, README (CRM-9/11), ledger.
  - e419d3c — Dashboard 2.0 KPI service draft (found broken in session 2, rewritten).
- 2026-09-28 (session 2) — Phase 2, from Master Prompt v2 supplied by the owner.
  - 5cb7557 — migration 004 (expiry, soft delete, activity_log, stage-transition trigger, admin-only restore/purge, staff defaults) + pure rule modules + 4 test files (17/17 pass).
  - cd4c332 — service layer: activity writes, changeCandidateStage, soft delete for documents/tasks/appointments, job restore/purge, constants.
  - c14e747 — live KPI, notification, multi-entity recycle bin and search services.
  - 9944afb — app shell: route code splitting, page guards, ErrorBoundary, notifications bell, mobile nav.
  - 7f18b06 — Pipeline board, ActivityTimeline, mobile Cmd-K.
  - df7fdc8 — Dashboard insights, candidate profile, document center.
  - ee836b7 — Dashboard page (ghost-stage straggler removed), Recycle Bin page, README.
  - (this commit) — ledger.
