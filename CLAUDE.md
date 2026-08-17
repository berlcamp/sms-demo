# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
- **Volunteer teachers** (`volunteer_teacher`, migration 140) — a teacher with no plantilla item. Identical to `teacher` everywhere **except that they may not enrol learners**; use `isTeacherRole()` / `canEnrolLearners()` from `lib/constants/userTypes.ts` rather than comparing to the literal `"teacher"`
- **Division admins** — manage schools and users across the division (no `school_id` required)
- **Students** — separate portal (LRN + DOB auth), read-only grades/dashboard
- **Public** — browse schools/learners, submit Form 137/document requests

The legal set of `sms_users.type` lives in the `sms_users_type_check` constraint (001 → 011 → 031 → 067 → 095 → 102 → 135 → 140); labels and login rules live in `lib/constants/userTypes.ts`.

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

**⚠ Vercel installs with pnpm, not npm.** Both `package-lock.json` and `pnpm-lock.yaml` are tracked,
but Vercel picks pnpm (the presence of `pnpm-lock.yaml` decides it) and runs `--frozen-lockfile`.
**When you add or remove a dependency, you must update `pnpm-lock.yaml`** — `npm install` alone
touches only `package-lock.json`, and the deploy then fails with `ERR_PNPM_OUTDATED_LOCKFILE`
*after* the commit is already on `main`, so the feature looks pushed but never ships. Regenerate
without disturbing `node_modules`:

```bash
npx pnpm@10 install --lockfile-only          # rewrite pnpm-lock.yaml from package.json
npx pnpm@10 install --frozen-lockfile --lockfile-only   # verify it the way CI does
```

Running the scripts above with `npm` is fine; it is only dependency changes that must reach both
lockfiles.

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
| **Schedules** | `schedules/`, `sections/ViewSubjectsModal.tsx` (Manage Schedules), `lib/utils/scheduleConflicts.ts` | **One row per time block.** A subject that meets Mon/Wed 8–9 and Fri 2–3 is *two* `sms_subject_schedules` rows, not one row with per-day times — the calendar filters row by row and teaching load / SF7 sum row by row, so this needs no schema change. The Add/Edit modal builds several blocks at once and saves one row each; on edit, block 1 updates the opened row and any block added beside it inserts. Blocks of the same schedule overlapping each other is a hard error (a class cannot meet twice at once); clashing with *other* schedules is overridable — see migration 124 |
| **Books** | `books/allocations`, `books/issuances`; teacher `books/issue`, `return-to-manager` | Allocation: manager→teacher; Issuance: teacher→student |
| **School Form 10** | `formrequests/requests`, `(public)/requests` | Status: pending → approved → completed |
| **Transfer enrollment** | `manage-requests/`, `enrollment/components/EnrollmentWizard.tsx` | Immediate enrollment + record request; see Transfer Workflow below |
| **DepEd reports** | `reports/`, `lib/pdf/` | SF1–SF10; school year, section, student filters |
| **Grade monitoring** | `grade-monitoring/`, migration 107 | School head / admin view of which teachers encoded grades per subject/section/period; denominator is `sms_subject_schedules`, encoded means `grade > 0` |
| **School calendar** | `settings/calendar/`, `lib/utils/schoolCalendar.ts`, migration 125 | Non-class days (holidays, suspensions, pre-opening weeks) and their inverse (`class_day` make-ups). The authoritative school-day denominator for the attendance grid, SF2 and the report card — never re-derived from "count the weekdays". Schools edit their own entries; the division office enters shared ones (NULL `school_id`) from Division Office → School Calendar |
| **Learner health** | `health/` | SF8; height, weight, nutritional status (DepEd wasting bands; migration 111) |
| **School Report Card** | `reports/school-report-card/`, `lib/pdf/generateSchoolReportCard.ts`, migration 112 | Annual school-level accountability doc (16 sections) — NOT the learner SF9 report card. Every section is user-entered; `src_autofill` only prefills the 6 derivable ones. Snapshot, never re-derived: it is signed and published. |
| **Key Performance Indicators** | `school-reports/kpi/`, `lib/utils/kpi.ts`, `lib/constants/kpi.ts`, migration 118 | DepEd Memo 12 Oct 2022 "Guide in Computing KPIs". Access (GER/NER/GIR/NIR/Transition), efficiency (promotion/graduation, repetition, school leaver, CSR, completion, coefficient of efficiency, years input per graduate, simple dropout — reconstructed cohort **and** old method), ratios (teacher/classroom/seat/toilet-bowl-learner, GPI, IQR). Nothing is snapshot: two RPCs derive everything live. PSA population, seats and toilet bowls have no source in the system and live in `sms_kpi_reference`. Scope switches between one school and division-wide (`p_school_id` NULL) |
| **Learner Manifestation Tagging** | `teacher/anecdotal/manifestation/`, `lib/constants/manifestation.ts`, `lib/pdf/generateSnedConsentForm.ts`, migration 119 | DepEd LIS SPED tagging pipeline: tag manifestation/s → print SNED parent consent form → adviser designs intervention → School Head renders TA on it → tagged **and** consented learners are identified for SNED enrollment. "Identified" is derived (`items > 0 && consent granted`), never stored; only the enrollment outcome is. This record **feeds** the LIS, it does not replace it (`lis_tagged` mirrors that step). Tagging does not require consent — the adviser tags first, then seeks it. LSEN codes are app-validated in `lib/constants/manifestation.ts`, not CHECK-constrained, so DepEd list revisions don't invalidate history |
| **Instructional Supervision** | `supervision/` (School Head), `teacher/supervision/`, `lib/constants/supervision.ts`, `lib/utils/supervision.ts`, `lib/utils/calendar.ts`, `lib/pdf/generateCotForms.ts`, `lib/pdf/generateSupervisoryPlan.ts`, migration 121 | PMES/COT observation cycle: School Head writes a term supervisory plan → teachers (or the School Head) **suggest** an observation slot → School Head approves → participants export the approved slot to their own calendar → observers file COT forms. See Instructional Supervision below |
| **Exam answer keys & OMR scanning** | `teacher/examinations/exam/[id]`, `division/examinations/exam/[id]`, `components/examinations/ExamScanWorkspace.tsx`, `lib/omr/`, `lib/pdf/generateAnswerSheets.ts`, migration 132 | Key → pre-printed answer sheet → scan → score → item analysis → learner slips. See Exam Answer Keys & Scanning below |
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

## Exam Answer Keys & Scanning (OMR)

The chain, in order: **key → sheet → scan → score → analysis → slip**.

1. **Answer key** (`AnswerKeyEditor`) — a flat `item_number → letter` key in `sms_exam_answer_keys`. Prefillable from the authored Exam Builder questions, but **not derived from them**: the common case is a paper exam that was never typed into the builder, and a 50-letter key takes a minute where 50 questions take an afternoon. Prefill is one-way — editing a question later does not rewrite a key that sheets have already been printed against.
2. **Answer sheet** (`lib/pdf/generateAnswerSheets.ts`) — one A4 page per learner, **jsPDF not HTML-print**, because the browser print dialog may rescale and every millimetre has to survive the round trip. The learner's `sms_students.id` is **bubble-encoded and pre-shaded at print time** with a mod-10 check digit; learners never write an identifying number. A sheet therefore belongs to one named learner and must not be photocopied for the class.
3. **Scan** (`ScanScorePanel`) — images or multi-page PDFs (pdf.js, lazily imported). Upload → decode → **review** → save. The review step is not optional and nothing is written per sheet: one explicit Save writes the batch, so an interrupted scan leaves stored results untouched.
4. **Analysis** — migration 101's maths, unchanged, now also rendered straight on the Results tab. `ItemAnalysisPanel` falls back to the answer key when an exam has no authored questions, so a scanned paper exam still gets an analysis.
5. **Slip** (`lib/pdf/generateExamResultSlips.ts`) — two per A4 page, showing the learner's own answer beside the key per item.

**`lib/omr/layout.ts` is the single source of truth for sheet geometry.** The generator draws from it and the decoder samples from it; no other module may hard-code a position. Changing it invalidates **already-printed** sheets, which encode the old geometry physically.

**The decoder** (`lib/omr/decode.ts`) is dependency-free and DOM-free — no OpenCV, no WASM — so the same code runs in the browser and in node tests. Otsu threshold → corner-marker blob search → homography → orientation → bubble sampling. The homography off the four corner markers is what absorbs scale, a crooked feed and the perspective of a hand-held photo, which is why the sheet needs no particular DPI. Row reading is **relative, not a fixed ink cutoff**: the winner must beat its runner-up, so faint pencil reads and two real marks stay a multi-mark. Anything uncertain is flagged for the teacher — the module never invents an answer to avoid asking.

**Limits:** 100 items per sheet (4 columns × 25); 8-digit student ids; 2–5 choices per item, per item.

**`answers[]` sits beside `correct_items`, it does not replace it.** `correct_items` stays the input to the analysis and every pre-132 row still has it. `answers` additionally keeps the raw response per item, which is what a distractor analysis and a marked-up learner slip need and what `correct_items` can never reconstruct. Rows encoded by hand keep an empty array and lose nothing.

**Tests:** `npm test` (vitest — layout invariants, decoder against synthetically rendered sheets including rotated/skewed/faint/low-res, scoring, and the generated PDF's marker geometry) and `npm run test:e2e` (Playwright). The E2E suite starts its own dev server on port 3123 with `NEXT_PUBLIC_SUPABASE_URL` pointed at a host that does not exist, so **no test can reach the production database even if a route escapes interception** — see the header of `playwright.config.ts`.

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
| 124 | Schedule conflict override — adds `sms_subject_schedules.conflict_override` (default FALSE) and an early return in `check_schedule_conflicts_trigger()`. The 004/117 trigger blocked every room/teacher/section double-booking outright, which schools genuinely need to break for combined classes (two grade levels in one room under one teacher) and shared halls. The Add Schedule modal now shows the conflict warning with a **"Save anyway — this double-booking is intentional"** checkbox; the flag is written only when a conflict was actually detected at save time, so editing the clash away puts the row back under enforcement. **The exemption is per-row, not global:** an overridden row still occupies its slot and still warns the *next* person scheduling against it, who must accept it themselves. Both Duplicate modals carry the flag forward, else the copy of a shared slot is blocked by the trigger the original was exempt from. Surfaced as a `SharedSlotBadge` on the schedules list and the section's Manage Schedules modal |
| 125 | School calendar — `sms_school_calendar_days` (per school **or** division-wide via NULL `school_id`, per the 106/118 convention). One row is a date **range** (`start_date`/`end_date`), so "first two weeks, enrolment, no classes" is a single editable row. `day_type` = holiday / no_class / suspension / **class_day**, the last being the inverse entry (classes ARE held) that overrides any blocking row covering the same date — make-up classes, including on a Saturday, which is the only way a weekend can enter the grid. `period` ('whole' \| 'am' \| 'pm') because suspensions here are routinely half-day. Before this, the grid enumerated every Mon–Fri and treated a blank cell as present, so a holiday credited every learner a full day while SF2's *No. of Days of Classes* counted the same inflated weekday slots — numerator and denominator wrong in opposite directions. Resolution lives in `lib/utils/schoolCalendar.ts` and is applied identically by the attendance grid, SF2 and the report card. **Nothing is deleted:** attendance rows already saved against a date later marked a holiday are ignored at read time, not removed, so a mis-entered holiday is fully reversible |
| 132 | Exam answer keys + scanned answer sheets — `sms_exam_answer_keys` (flat `item_number → correct_answer`, one row per item; `choice_count` 2–5 governs both what is printed and what the decoder reads; `correct_answer` free TEXT per the 119 precedent, NULL = unkeyed and excluded from scoring rather than marked wrong for everybody). Additive columns on `sms_exam_result_students`: `answers TEXT[]` (raw response per item, positional; `''` blank, `'?'` unresolved multi-mark), `scan_source`, `scanned_at`. **Nothing is backfilled and nothing is replaced** — `correct_items` remains the analysis input, so every hand-encoded result predating this keeps working untouched. The key is its own table rather than a read of 099's authored questions because the common case is a paper exam that was never typed into the Exam Builder; prefilling from the questions is a convenience, not the mechanism |
| 122 | ILAW lesson plan attachments — 121 modelled the "Attach ILAW Lesson Plan" line as a URL; this makes it a real upload. Renames `lesson_plan_url` → `lesson_plan_path` (guarded, so it is safe whether or not 121 was already applied) and adds `lesson_plan_name` for display. Files go under `supervision-lesson-plans/` in the `school-management` bucket, per the 088/089/110 prefix convention. **The prefix is load-bearing:** 078's INSERT policy only admits `landing-hero/`, so the new prefix-scoped write policies here are what make uploads pass RLS at all. ⚠ That bucket is **public** (`public = true`, 078) — a lesson plan is readable by anyone holding the object URL. The uuid in the path is obscurity, not access control; genuine restriction would need a private bucket (the `diplomas` pattern in 026) |
| 134 | Multi-school users — `sms_user_schools` (user ↔ school, the set of schools a person may work in), backfilled 1:1 from `sms_users.school_id` so nobody's access changes on apply. **`sms_users.school_id` keeps its meaning as the school they are working in *right now***, which is why none of the ~50 client queries and none of the RLS policies that bind to it (037/115, 038, 057, 078/094, 123, 129, 131) needed touching — switching rewrites that one column through `sms_switch_active_school`, which rejects any school not in the assignment set. A client-side override like the super admin's localStorage one (094/113/115) was rejected: that works only because super admin sits in the *full-access* branch of every policy, and a school_head with two schools has no such branch. Also closes a pre-existing hole — 001's blanket `authenticated` UPDATE policy let any user set their own `school_id` to any school from the console; `sms_users_guard_school_change` now confines a self-service change to the assigned set (division-level actors and service_role unrestricted). Trade-off worth knowing: while switched to school B, the user does not appear in school A's staff pickers, which read `sms_users.school_id`; already-saved assignments hold the user's id, not their school, so they are unaffected |
| 133 | Subject program (ALS) — the Program dropdown on Subjects was 034's `is_madrasah` boolean, so a third program could not be stored at all. Adds `sms_subjects.program` (`regular` \| `madrasah` \| `als`, CHECK-constrained because each value carries application behaviour) as the source of truth. **`is_madrasah` is kept, not replaced:** since 034 it has meant two things — selective per-learner enrolment via `sms_student_subjects`, and exclusion from the general average (076, 128, SF9/SF10/Form 137/report card) — and ALS shares both, so it becomes a *derived* mechanism flag maintained by `sync_subject_program_trigger` (`program IN ('madrasah','als')`). Every existing consumer, including 107's `get_grade_encoding_status` RPC and signed forms, keeps working untouched. The sync is two-directional so a writer that knows only the old boolean still lands on a consistent row. Backfill is 1:1 (`is_madrasah` true → `madrasah`), so no subject changes behaviour when this is applied. Labels come from `lib/constants/subjects.ts`; Grade Monitoring looks the program up client-side because its RPC predates this |
| 135 | Teachers may enrol learners — 130 locked the two enrollment RPCs to STAFF_TYPES from `lib/requests/auth.ts` on the assumption that teachers never enrol, but the Teacher Menu has linked to the full `/enrollment` module since the first commit, the page has no role gate, and 131's RLS already admits any same-school staff. So a teacher could enrol a new or existing same-school learner through the wizard's direct INSERT, and was refused only on the two RPC paths (transferee, and bulk re-enrol of promoted/retained) with *"Your role (teacher) may not enrol learners."* Adds `teacher` to the roster in `assert_enrollment_staff`; **nothing else 130 established is relaxed** — identity still comes from `auth.uid()`, `enrolled_by`/`approved_by` are still overwritten with the resolved caller, and a teacher is school-scoped like every other school-level role (NULL or mismatched `p_school_id` is still refused). `tutor` stays out. STAFF_TYPES itself is deliberately unchanged: that roster governs the *requests queue*, which is registrar/school-head work — a teacher's transferee enrolment still opens the outgoing record request, but acting on the queue remains staff-only |
| 138 | Room dimension + section classroom — backs the **Classroom Enrollment and Size** report. Adds `sms_rooms.dimension` (free TEXT, "40 x 30" metres, shape validated in `lib/utils/roomDimension.ts` per the 119/132 precedent — the figure is transcribed from the building inventory as one value and printed back verbatim) and `sms_sections.room_id` (`ON DELETE SET NULL`, per the 116 lesson that the delete rule is what bites). Sections had **no** room until now: a room only ever appeared on a *schedule* (004's `sms_subject_schedules.room_id`), which answers "where does this subject meet", not "which classroom is this section's" — and a section with no schedules yet still has a classroom. Both columns nullable, nothing backfilled: an unassigned section simply prints blank |
| 139 | Cross-school teacher double-booking — `check_schedule_conflicts` was plain `LANGUAGE plpgsql`, so its scan of `sms_subject_schedules` ran under **the caller's** RLS (115) and the teacher check answered a different question per role: school staff saw only their own school, so a teacher standing in a classroom at the other school at 10:00 was never detected, while `division_admin` / `super admin` saw everything and were refused over a row nobody at the school could look at. Now `SECURITY DEFINER` with a pinned `search_path`, and the message **names the other school** when the clash is there. Room and section are untouched — each belongs to exactly one school, so neither can ever match across schools. 117's Temporary rules and 124's `conflict_override` escape hatch are unchanged, so an intentional shared teacher is still savable through "Save anyway". One function replaced, no DML. **Tightens what school staff may save** (a clash that silently passed now raises), which is the bug — the header carries the query to count affected rows before applying |
| 136 | ALS section type — widens 008's `section_type` CHECK with `als` and pairs it to 133's subject program: an **ALS subject is scheduled in an ALS section and nowhere else, and an ALS section carries ALS subjects and nothing else**. Enforced by a trigger on `sms_subject_schedules` (`check_als_program_section_match`) because that is the only place a subject meets a section — there is no section↔subject table — and because the two sides live in different tables, which a CHECK cannot see. Nothing existing can violate it: `als` was not a legal section type before this, so no section is one and no schedule pairs them wrongly; existing rows are neither rewritten nor re-validated. The UI filters both subject pickers (the section's Manage Schedules modal and the standalone Add Schedule modal) off the section's type, so the trigger is a backstop rather than the first line. Crossing the boundary on an **existing** row is blocked in the app instead: a section already carrying schedules cannot be switched into or out of ALS, and neither can a subject — the schedules have to be removed first, mirroring the grade-level guard that predates it |
| 140 | Volunteer teacher role — `volunteer_teacher`, a teacher with no plantilla item (parent, LSB-funded helper, retiree) who advises a section, carries a load and encodes grades. Widens `sms_users_type_check`, and refuses that role in **both** enrolment gates: `can_write_enrollment` (131), which backs the three write policies on `sms_enrollments`, and `assert_enrollment_staff` (135), which backs the two enrolment RPCs and `close_duplicate_enrollment`. Both are needed — the RPCs are `SECURITY DEFINER` and run past RLS. The app is a third, courtesy layer: the sidebar drops Enrollment from the Teacher Menu, `/enrollment` renders `ModuleAccessDenied`, and Promote / Retain / Transfer Out are withheld on a teacher's section page. Everything else the Teacher Menu offers is unchanged, because those pages resolve the person through `section_adviser_id` / `teacher_id`, not through the role name — which is why every teacher-facing gate now asks `isTeacherRole()` instead of `=== "teacher"`. **No DepEd personnel count moves:** 071's teaching/non-teaching summaries, 112's SRC and 118's teacher-learner ratio stay keyed to the literal `'teacher'` (a plantilla item, which a volunteer is not), and the volunteer's staff record files under the `teacher` staff category, which the Non-Teaching matrix drops — counted in neither, deliberately. No RLS policy widened, no row modified; nobody can hold the role before it is applied, so no existing account changes |

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
12. **`sms_users.school_id` is the *active* school, `sms_user_schools` is the *permitted set*** (migration 134) — a user may be assigned to several schools but is only ever in one at a time, which is what every school-scoped query and RLS policy reads. Never widen a policy to "any assigned school"; change the active school through `sms_switch_active_school` instead. Assignments are edited only at `/division/users`.
