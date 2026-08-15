# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

---

## 🚨 RULE 0 — THIS PROJECT POINTS AT THE PRODUCTION DATABASE

**`.env.local` holds LIVE production Supabase credentials.** There is no staging copy and no
snapshot to roll back to. Anything you run locally — `npm run dev`, a script, a one-off `node -e`,
an MCP/CLI call, a migration — hits real DepEd learner records for the Schools Division of Bayugan
City. Deleted data is gone permanently.

**Never do any of the following, in any tool, ever — not even when a task seems to require it:**

- `DELETE`, `TRUNCATE`, or `DROP` (table, column, schema, type, index, constraint, policy, function, trigger) against the live database
- `UPDATE` without a `WHERE`, or any bulk mutation whose blast radius you have not counted first
- `supabase db reset`, `db push --force`, `db remote commit`, or anything that re-applies the migration history
- Rewriting, renaming, deleting, or editing an **already-applied** migration file in `supabase/migrations/` — history is immutable; write a new numbered migration instead
- "Cleanup", "seeding", "test data", or "let me just recreate the table" operations
- Running an ad-hoc script against `SUPABASE_SERVICE_ROLE_KEY` — that key bypasses every RLS policy

**Read-only is always safe.** `SELECT`, `EXPLAIN`, schema introspection, reading migration files,
and `npm run build` / `lint` / `tsc` need no permission.

**When a task genuinely needs destructive SQL:** do not run it. Write the statement into a new
migration file (or print it in your reply), state exactly which rows/objects it affects and how
many, and hand it to the user to run themselves. Getting explicit approval for one destructive
statement does **not** authorize the next one.

**Migrations are additive.** Prefer `ADD COLUMN` / new table / new policy. When a column or
constraint must change, guard it (`IF EXISTS` / `IF NOT EXISTS`) and preserve existing rows — see
migration 111's re-banding header and migration 116's lesson about `CREATE TABLE IF NOT EXISTS`
silently skipping constraint changes.

**If you are unsure whether an action touches production data, stop and ask.**

---

## System Overview

A **School Management System (SMS)** for the Schools Division of Bayugan City (DepEd). Manages schools, students, enrollment, sections, subjects, grades, attendance, learner health, books (allocations/issuances), staff, rooms, schedules, Form 137 requests, and DepEd School Forms (SF1–SF10).

**Main modules:** Enrollment, Subjects, Sections, Students, Schedules, Attendance, Learner Health, Books, Staff, Rooms, Form Requests, Manage Requests (transfers), DepEd Reports, Report Cards, Evaluations, ECCD Assessments, Key Performance Indicators, Settings, Teacher Dashboard, Student Portal, Division Admin.

**User roles and access:**
- **Staff** (`school_head`, `admin`, `registrar`, `librarian`) — full school data via sidebar modules
- **Teachers** — restricted view: their sections, subjects, grade entry, books issue/return
- **Division admins** — manage schools and users across the division (no `school_id` required)
- **Students** — separate portal (LRN + DOB auth), read-only grades/dashboard
- **Public** — browse schools/learners, submit Form 137/document requests

All valid user types: `school_head`, `teacher`, `registrar`, `admin`, `super admin`, `division_admin`, `librarian`

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Frontend | React 19, Tailwind CSS 4, shadcn/ui (Radix UI) |
| Backend/DB | Supabase (PostgreSQL + Auth) |
| State | Redux Toolkit (`userSlice`, `listSlice`) |
| Forms | React Hook Form + Zod + `@hookform/resolvers` |
| Auth | Supabase Auth (staff) + JWT cookie via `jose` (student portal) |
| PDF | jsPDF (DepEd forms, report cards) |
| Excel | xlsx (list/report exports) |
| Other | date-fns, lucide-react, nprogress, react-hot-toast |

---

## Development Commands

```bash
npm run dev      # Start dev server (localhost:3000)
npm run build    # Production build
npm run start    # Run production server
npm run lint     # ESLint
```

**Required env vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STUDENT_PORTAL_JWT_SECRET`

---

## Architecture

**Project structure:**
```
app/
├── (protected)/          # Staff app - requires Supabase auth
│   ├── home, enrollment, subjects, sections, students, schedules, attendance, health
│   ├── books/             # Allocations, issuances
│   ├── staff, rooms
│   ├── evaluations/       # Evaluation questionnaire management (student→teacher, teacher→principal)
│   ├── manage-requests/   # Document requests, incoming/outgoing record requests, transfer record viewer
│   ├── settings/          # Record edit locks, promotion deadline, principal config
│   ├── teacher/           # Teacher-specific: dashboard, sections, subjects, grades, books, evaluations, eccd
│   ├── formrequests/
│   ├── reports/           # DepEd SF1–SF10, SF10 historical grades encoding
│   └── division/          # Schools, users, reports, dashboard (division_admin only)
├── (public)/              # Auth, login, requests
├── (landing)/             # Public schools/learners pages
├── student-portal/        # Student app - LRN + DOB JWT auth (dashboard, grades, evaluations)
hooks/                     # Custom React hooks (useSchoolSettings, useBooks, useGpaThresholds, use-mobile)
lib/
├── supabase/              # client, server, admin, middleware
├── redux/                 # store, userSlice, listSlice, providers
├── utils/, pdf/, constants/, student-portal/, notifications/, requests/
components/                # Shared UI, AuthGuard, AppSidebar, etc.
├── dashboards/            # Role-specific: DefaultDashboard, SchoolDashboard, TeacherDashboard, DivisionDashboard
├── notifications/         # NotificationBell, NotificationDropdown
├── system-guide/          # SystemGuideDialog (help system)
├── ui/                    # shadcn/Radix UI primitives
types/                     # database.ts, index.ts
supabase/migrations/       # 66+ migrations, tables in procurements schema
```

**Auth flows:**
- **Staff:** `AuthGuard` → Supabase session → `sms_users` lookup → Redux `userSlice` (user, type, school_id)
- **Student:** LRN + DOB → `verifyStudent` server action (`lib/student-portal/actions.ts`) → JWT cookie → `StudentAuthGuard`
- **CRUD:** Client-side `supabase.from("sms_*")` with `school_id` filter where applicable

**Supabase schema:** All SMS tables live in the `procurements` schema. **Critical:** `lib/supabase/server.ts` defaults to the `public` schema — when adding server-side queries for SMS tables, you must specify `procurements` explicitly. The client and admin clients already target `procurements`.

**Redux `listSlice`:** Generic cache for list pages. Reset with `addList([])` on filter change. All list fetchers use an `isMounted` flag to avoid setState after unmount.

---

## Key Features & Locations

| Feature | Location | Notes |
|---------|----------|-------|
| **Auth (staff)** | `AuthGuard`, `auth/callback`, `auth/unverified` | Session → `sms_users` → Redux |
| **Auth (student)** | `lib/student-portal/actions.ts`, `StudentAuthGuard` | LRN + DOB, JWT cookie |
| **School guard** | `SchoolIdGuard` | Blocks non–division_admin users without `school_id` |
| **Sidebar** | `AppSidebar` | Role-based: allModuleItems, teacherItems, divisionItems |
| **Grade entry** | `teacher/grades`, `TeacherGradeEntryTable` | Validates schedule/adviser before edit; 4 grading periods |
| **Books** | `books/allocations`, `books/issuances`; teacher `books/issue`, `return-to-manager` | Allocation: manager→teacher; Issuance: teacher→student |
| **School Form 10** | `formrequests/requests`, `(public)/requests` | Status: pending → approved → completed |
| **Transfer enrollment** | `manage-requests/`, `enrollment/components/EnrollmentWizard.tsx` | Immediate enrollment + record request; see Transfer Workflow below |
| **DepEd reports** | `reports/`, `lib/pdf/` | SF1–SF10; school year, section, student filters |
| **Grade monitoring** | `grade-monitoring/`, migration 107 | School head / admin view of which teachers encoded grades per subject/section/period; denominator is `sms_subject_schedules`, encoded means `grade > 0` |
| **Learner health** | `health/` | SF8; height, weight, nutritional status (DepEd wasting bands; migration 111) |
| **School Report Card** | `reports/school-report-card/`, `lib/pdf/generateSchoolReportCard.ts`, migration 112 | Annual school-level accountability doc (16 sections) — NOT the learner SF9 report card. Every section is user-entered; `src_autofill` only prefills the 6 derivable ones. Snapshot, never re-derived: it is signed and published. |
| **Key Performance Indicators** | `school-reports/kpi/`, `lib/utils/kpi.ts`, `lib/constants/kpi.ts`, migration 118 | DepEd Memo 12 Oct 2022 "Guide in Computing KPIs". Access (GER/NER/GIR/NIR/Transition), efficiency (promotion/graduation, repetition, school leaver, CSR, completion, coefficient of efficiency, years input per graduate, simple dropout — reconstructed cohort **and** old method), ratios (teacher/classroom/seat/toilet-bowl-learner, GPI, IQR). Nothing is snapshot: two RPCs derive everything live. PSA population, seats and toilet bowls have no source in the system and live in `sms_kpi_reference`. Scope switches between one school and division-wide (`p_school_id` NULL) |
| **Learner Manifestation Tagging** | `teacher/anecdotal/manifestation/`, `lib/constants/manifestation.ts`, `lib/pdf/generateSnedConsentForm.ts`, migration 119 | DepEd LIS SPED tagging pipeline: tag manifestation/s → print SNED parent consent form → adviser designs intervention → School Head renders TA on it → tagged **and** consented learners are identified for SNED enrollment. "Identified" is derived (`items > 0 && consent granted`), never stored; only the enrollment outcome is. This record **feeds** the LIS, it does not replace it (`lis_tagged` mirrors that step). Tagging does not require consent — the adviser tags first, then seeks it. LSEN codes are app-validated in `lib/constants/manifestation.ts`, not CHECK-constrained, so DepEd list revisions don't invalidate history |
| **Instructional Supervision** | `supervision/` (School Head), `teacher/supervision/`, `lib/constants/supervision.ts`, `lib/utils/supervision.ts`, `lib/utils/calendar.ts`, `lib/pdf/generateCotForms.ts`, `lib/pdf/generateSupervisoryPlan.ts`, migration 121 | PMES/COT observation cycle: School Head writes a term supervisory plan → teachers (or the School Head) **suggest** an observation slot → School Head approves → participants export the approved slot to their own calendar → observers file COT forms. See Instructional Supervision below |
| **Evaluations** | `evaluations/`, `teacher/evaluations/`, `student-portal/(portal)/evaluations/` | Student→teacher and teacher→principal; Likert-scale (1–5); migration 054 |
| **Report cards** | `lib/pdf/generateReportCard.ts`, migration 055 | PrintCardModal, core value ratings per student per school year |
| **ECCD assessments** | `teacher/eccd/` | Early childhood development checklist/assessment entry |
| **Settings** | `(protected)/settings/` | Record edit locks (prev school year), promotion deadline, school principal name/title |
| **Student portal** | `student-portal/(portal)/dashboard`, `grades`, `evaluations` | Read-only grades + teacher evaluations via server actions |

---

## Instructional Supervision (PMES / COT)

The paper cycle the module reproduces, in order:

1. **Plan** — School Head writes an *Instructional Supervisory Plan* per term (T1 Jun–Aug, T2 Sep–Nov, T3 Jan–Mar) at `/supervision/plan`. Nine-column matrix, printed landscape.
2. **Suggest** — a teacher proposes a slot from `/teacher/supervision`, or the School Head creates one from `/supervision`. Carries the per-teacher slip fields: position, rated/non-rated, term, grade & section, pre-conference, actual observation, focus KRA, focus indicator, ILAW lesson plan.
3. **Approve** — School Head approves or rejects. **Editing an approved slot returns it to `proposed` and clears the decision** — an approval refers to a specific date, so a moved observation must be re-approved.
4. **Calendar** — only `approved` / `completed` slots expose calendar actions: an *Add to Google Calendar* template link and a downloadable `.ics` (which also carries the pre-conference as its own event). **No Google OAuth** — nothing writes to a calendar silently. `calendar_exported_at` is advisory: it records that someone took the export, never that an event exists.
5. **Observe** — each assigned observer files an **Annex E-2 rating sheet** and optionally **Annex E-4 notes**. With more than one observer an **Annex E-3 Inter-Observer Agreement** is required; with one, the E-2 *is* the final rating sheet. A `non_rated` (fleeting) observation produces notes only, no rating sheet.

**Observers are a designation, not a role** (`sms_supervision_observers`, per school year, set at `/supervision/observers`). Master teachers routinely observe; the School Head is not required to. On `/teacher/supervision` a designated observer sees a second tab and may edit **only their own** rating sheet.

**The two axes of a COT form** — conflating them is the classic error:
- **Career stage** fixes the *rating scale only*. Indicator text is written in Proficient Teacher language for everyone. T I–III → 2–6, T IV–VII → 3–7, MT I–II → 4–8, MT III–V → 5–9.
- **School year** fixes *which indicators appear*. The PMES rotates a 9/9/8 set on a three-year cycle (`COT_INDICATOR_CYCLE`, anchored at SY 2025-2026).

Both are stored on the observation row (`career_stage`, `form_cycle_sy`) and **never re-derived at print time** — a teacher promoted mid-year must not retroactively change the scale of a form already signed on paper. `suggestCareerStage()` only *suggests* a stage from the free-text `sms_users.position`; the scheduling form always lets the School Head override it.

**"NO" (Not Observed) is not a zero and not a blank** — it automatically scores the *lowest level of the career stage* (2/3/4/5), and that value is written to `rating` as well as the flag. **"N/A"** excludes the indicator entirely. The E-3 final rating is a reasoned consensus and is **explicitly not an average** — nothing in the code computes one.

Indicator codes are free TEXT resolved against `lib/constants/supervision.ts`, per the 119 precedent, so a DepEd revision is a constants change rather than a migration that invalidates signed forms.

---

## Transfer Enrollment Workflow (Immediate Enrollment)

All inter-school transfers go through a **record request** for data access — but the student is **immediately enrolled and active** at the new school. The `StudentEntryMode` type has only `"new" | "existing" | "transferee"`.

**Step 1 — Destination school enrolls transferee:**
- LRN lookup finds student at different school → `transferee` mode (regardless of origin status)
- `enroll_student_with_record_request` RPC creates record request (`pending`) + enrollment (`approved`/`active`)
- Student is immediately active at the new school; grade level auto-suggested from previous record
- If an old enrollment exists at the same school/year (e.g., student returning), it is reactivated instead of inserting a duplicate

**Step 2 — Origin school approves/rejects record access:**
- Manage Requests → Incoming Requests tab at origin school
- `respond_to_record_request` RPC: approve → `record_access_granted = true`, origin enrollment → `transferred_out`; reject → denies access only, student stays enrolled at destination
- RLS policies on `sms_grades`, `sms_attendance`, `sms_enrollments`, `sms_eccd_assessments`, `sms_learner_health` grant read access via `has_record_access()` function

**Step 3 — Destination school views records (optional):**
- Manage Requests → Outgoing Requests tab shows "View Records" button for approved requests
- `TransferRecordViewer` displays grades + enrollment history from origin school (read-only)
- If student is disqualified based on records, "Remove Student" action drops enrollment and reverts student to origin school (`remove_transfer_student` RPC)

**Enrollment lifecycle statuses:** `active`, `completed`, `transferred_out`, `dropped`, `pending_transfer`, `retained`, `promoted`, `graduated`

**Key locations:**
- Enrollment wizard: `enrollment/components/EnrollmentWizard.tsx`
- Outgoing requests (view records, remove student): `manage-requests/components/record-requests/OutgoingRequestsTab.tsx`
- Incoming requests (approve/reject): `manage-requests/components/record-requests/IncomingRequestsTab.tsx`
- Record viewer: `manage-requests/components/record-requests/TransferRecordViewer.tsx`
- Transfer out (teacher): `teacher/components/TransferOutModal.tsx`
- Change enrollment status: `enrollment/components/ChangeStatusModal.tsx`
- RPCs: `supabase/migrations/066_simplify_transfer_enrollment.sql` (current), `038_multi_school_transfers.sql` (base)

---

## Evaluations System

Two evaluation types managed through `sms_evaluations`, `sms_evaluation_questions`, and `sms_evaluation_responses`:

- **Student → Teacher:** Students rate teachers via student portal (`student-portal/(portal)/evaluations/`). Staff create questionnaires in `(protected)/evaluations/`.
- **Teacher → Principal:** Teachers submit evaluations from `teacher/evaluations/`.

Ratings use a Likert scale (1–5) with `StarRating` component. Duplicate submissions are prevented by unique constraint. Types: `EvaluationType`, `EvaluationRespondentType` in `types/index.ts`.

**Key locations:**
- Questionnaire management: `evaluations/`
- Teacher submission: `teacher/evaluations/`
- Student submission: `student-portal/(portal)/evaluations/`
- Server actions: `lib/student-portal/actions.ts` (`getActiveStudentEvaluations`, `submitStudentEvaluation`)
- Migration: `supabase/migrations/054_evaluations.sql`

---

## Report Cards & Core Values

Report card PDF generation with core value ratings stored per student per school year in `sms_report_card_core_values` (migration 055). School principal name/title configured in Settings (migration 053) and used as signatories.

**Key locations:**
- PDF generator: `lib/pdf/generateReportCard.ts`
- Principal config: `(protected)/settings/`, `hooks/useSchoolSettings.ts`
- Migration: `supabase/migrations/055_report_card_core_values.sql`

---

## Notable Recent Migrations

| Migration | Feature |
|-----------|---------|
| 050 | Added `promoted` and `graduated` enrollment statuses |
| 051 | Dropped deprecated `sms_section_students` (use `sms_enrollments`) |
| 052 | Transfer out metadata (reason, destination school) |
| 053 | School principal settings (name, title for signatories) |
| 054 | Evaluations system (questions, responses, types) |
| 055 | Report card core values table |
| 056 | Sync student enrollment status trigger |
| 057 | Transfer two-stage approval workflow (superseded by 066) |
| 058 | Allow edit promoted student grades setting |
| 059 | ECCD refactor |
| 060 | Principal to teacher evaluation |
| 061 | Atomic enroll for promoted/retained students |
| 062 | Promotion deadline + graduation lock triggers |
| 063 | Historical grades attachment |
| 064 | Fix transfer for promoted/graduated/retained students |
| 065 | Fix promotion deadline trigger type mismatch (TEXT vs BIGINT) |
| 066 | Simplified transfer: immediate enrollment + record request for data access + `remove_transfer_student` RPC |
| 070 | MPS (Mean Percentage Score) — teacher-entered per subject/section/quarter/school-year with mastery-level reporting |
| 106 | School-authored assessment materials — nullable `school_id` on CRLA / Phil-IRI / RMA materials (NULL = division-wide, set = that school only) |
| 107 | Grade encoding status — `get_grade_encoding_status` RPC backing the school head Grade Monitoring page (read-only aggregate; no new tables) |
| 108 | CRLA Grade 3 English — collapses that grade+language to the DepEd 2-task / 20-point flat form (no Task 2L/2H branch); re-bands existing records |
| 109 | Fix `division_classroom_needs` — filtered on `sms_enrollments.status` (approval) instead of `enrollment_status` (lifecycle), so enrolled was always 0; also counts by `e.school_id` not `students.school_id` |
| 110 | Storage policies for `crla-materials/` and `philiri-materials/` now admit `school_head` / `assistant_school_head` (were division-only), so school-authored materials from 106 can carry file attachments |
| 111 | Learner health BMI bands — `nutritional_status` widened from `underweight/normal/overweight/obese` to the DepEd wasting scale (`severely_wasted, wasted, normal, overweight, obese`); existing `underweight` rows re-banded to `wasted` (see caveat in the migration header) |
| 112 | School Report Card — `sms_src_submissions` (typed header) + `sms_src_sections` (JSONB bodies) + `src_autofill` RPC; mirrors the 072 submission pattern |
| 113 | Fix SRC 403 for `super admin` — 112's write policies omitted the role, so the page's draft INSERT was denied. Super admin joins the full-access branch (not school-matched: `AuthGuard` swaps their `school_id` for the active-school override), per the 094 precedent |
| 115 | Fix `sms_subjects` / `sms_subject_schedules` RLS — adds `super admin` to the full-access branch (per 113), **and** repairs school isolation: 037/095 wrote the match as an unqualified `u.school_id = school_id` inside a subquery over `sms_users`, which bound to the inner table (`u.school_id = u.school_id`, always true and type-valid, so the bug was silent), leaving cross-school writes unblocked since 037. Outer table now qualified. No casts: `sms_users.school_id` is BIGINT (013 converted it from TEXT), as are both `school_id` columns being compared |
| 116 | Repair FK delete rules into `sms_subjects` — every FK was declared `ON DELETE CASCADE` inside a `CREATE TABLE **IF NOT EXISTS**` (001, 004, 034, 070, 080, 096). Where the table already existed the statement was skipped, so the pre-existing FK kept `NO ACTION` and the declared cascade was never in effect — deleting any subject failed with 23503 on `sms_subject_schedules`. Migration files and live schema had disagreed since 004. Rediscovers each FK from `pg_constraint` rather than by name and re-creates any with the wrong rule (`sms_tos` → `SET NULL`, the rest → `CASCADE`); idempotent. **Lesson: `CREATE TABLE IF NOT EXISTS` silently skips constraint changes — never use it to alter an existing table's FKs.** |
| 118 | Key Performance Indicators — `sms_kpi_reference` (PSA projected population by official school-age band + seat/toilet inventory; nullable `school_id` = division-wide row, per the 106 convention) plus two `SECURITY INVOKER` RPCs: `kpi_enrollment_facts` (enrollment / repeaters / EOSY outcomes by grade level, **sex and age** — NER and GPI need both, and levels overlap so bands cannot be pre-aggregated) and `kpi_resource_facts` (per-school enrollment, teachers, classrooms — one row per school because the IQR compares schools). Both accept `p_school_id` NULL for a division roll-up. Repeater = same learner, same grade level, consecutive school years, within scope. SHS semester rows are collapsed per (learner, grade) so Grades 11–12 are not double counted |
| 119 | Learner Manifestation Tagging — `sms_manifestation_tags` (one row per learner per school year: LIS class branch, observation, parent consent, LIS mirror flag, SNED outcome), `sms_manifestation_tag_items` (the manifestation/s — a learner may carry several; `code` is free TEXT, app-validated, so DepEd LSEN list revisions don't invalidate rows), `sms_manifestation_interventions` (adviser's plan; the `ta_*` columns hold the School Head's technical assistance on that one intervention). Also adds `sms_school_settings.sned_coordinator_name` for the consent-form signatory, per the 053 precedent. RLS = authenticated with app-layer roster scoping, matching 105 |
| 121 | Instructional Supervision — `sms_supervision_observers` (per-school-year *designation*, not a role check: master teachers routinely observe), `sms_supervision_plans` / `_plan_entries` (School Head term matrix; `teachers` is free TEXT because a row may name individuals **or** a group like "All Primary Grade Teachers"), `sms_supervision_schedules` (the suggest → approve slot, with `career_stage` confirmed at scheduling time), `sms_supervision_schedule_observers` (`slot` 1–3, matching the Annex E-3 signature lines), `sms_cot_observations` (one row per filed form; `kind` = rating / agreement / notes, with partial unique indexes because the rule differs per kind and `observer_id` is NULL on agreements), `sms_cot_ratings`. `rating` has **no range CHECK** — the legal band depends on the parent row's `career_stage`, which a per-row CHECK cannot see, so `lib/constants/supervision.ts` is the only place the bands are written down. RLS = authenticated with app-layer scoping, matching 105/119 |
| 122 | ILAW lesson plan attachments — 121 modelled the "Attach ILAW Lesson Plan" line as a URL; this makes it a real upload. Renames `lesson_plan_url` → `lesson_plan_path` (guarded, so it is safe whether or not 121 was already applied) and adds `lesson_plan_name` for display. Files go under `supervision-lesson-plans/` in the `school-management` bucket, per the 088/089/110 prefix convention. **The prefix is load-bearing:** 078's INSERT policy only admits `landing-hero/`, so the new prefix-scoped write policies here are what make uploads pass RLS at all. ⚠ That bucket is **public** (`public = true`, 078) — a lesson plan is readable by anyone holding the object URL. The uuid in the path is obscurity, not access control; genuine restriction would need a private bucket (the `diplomas` pattern in 026) |

---

## Coding Conventions

- **TypeScript:** No `any` types
- **School scoping:** Always filter by `school_id` when `user.school_id` is present
- **Search input:** Use `escapeIlikePattern()` from `@/lib/utils` for all user-supplied `ilike` strings (SQL injection prevention)
- **School year:** Use `getCurrentSchoolYear()` / `getSchoolYearOptions()` from `@/lib/utils/schoolYear`
- **Redux hooks:** `useAppSelector`, `useAppDispatch` from `@/lib/redux/hook`
- **Page-specific components:** Co-locate in a `components/` subfolder alongside the page (e.g. `teacher/components/`)
- **UI primitives:** `components/ui/` holds all shadcn/Radix components

---

## Critical Invariants

1. **School scoping** — All data filtered by `school_id` for school-level roles; never omit this filter
2. **Grade validation** — Teacher must appear in `sms_subject_schedules` or be section adviser before grade edits are permitted
3. **Student portal auth** — JWT cookie only; students never touch Supabase Auth
4. **`SchoolIdGuard`** — `division_admin` is the only role that can have a null `school_id`
5. **Book return codes** — Valid values: `FM`, `TDO`, `NEG` (type `BookReturnCode`)
6. **Grading periods** — 1–4; grades keyed by `(student_id, subject_id, section_id, grading_period, school_year)`
7. **Schema mismatch** — `lib/supabase/server.ts` uses `public` schema; client/admin use `procurements` — always check which client you're using for server-side SMS queries
8. **Transfer immediate enrollment** — Transferees are immediately `active` at the new school. Record requests only control data access to previous school records. Origin school approval grants read access; rejection only denies data visibility (enrollment stays active). Use `remove_transfer_student` RPC if student must be removed after record review.
9. **No pre-released bypass** — All transferees use record request flow, even if already marked `transferred_out` at origin
10. **Enrollment reactivation** — When a student returns to a school where they had a stale enrollment (transferred_out, dropped, etc.) for the same school year, the existing row is reactivated instead of inserting a duplicate (unique constraint: `student_id, school_id, school_year, semester`)
11. **Type safety for BIGINT columns** — `sms_school_settings.school_id` is `TEXT` while most other `school_id` columns are `BIGINT`. Use `::TEXT` cast in SQL when comparing across these tables. In frontend, use `Number()` when passing string IDs to `.eq()` on BIGINT columns.
