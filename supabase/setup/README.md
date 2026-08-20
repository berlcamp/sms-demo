# Fresh install — merged setup scripts

Stands up the whole School Management System database on a **brand-new, empty Supabase
project** in 8 SQL runs instead of 141.

Built for cloning the system to another division for a demo. The schema name stays
`procurements` — nothing in the app changes, only `.env.local`.

> **These files are for empty databases only.**
> Never run them against a database that already has the migration history applied
> (including the Bayugan production project). For an existing database, use
> `supabase/migrations/` as normal — history there is immutable and additive.

---

## What these files are

Each part is a byte-for-byte concatenation of the migrations in `supabase/migrations/`,
in the exact order a migration runner applies them. Nothing was rewritten, reordered,
condensed, or "cleaned up" — a merged part produces the same database as replaying the
individual files, and each part runs as a single transaction, so a failure rolls the
whole part back rather than leaving it half-applied.

| File | Migrations | Contents |
|------|-----------|----------|
| `01_core_foundation.sql` | 001–029 (28) | Core schema, rooms, schedules, attendance, books, learner health, requests |
| `02_multi_school_transfers.sql` | 030–059 (30) | Multi-school support, transfers, settings, ECCD, evaluations, report cards |
| `03_division_reports_landing.sql` | 060–079 (20) | Promotion & graduation, MPS, division reports, landing pages, storage buckets |
| `04_class_record_assessments.sql` | 080–099 (24) | Class record, CRLA / Phil-IRI / RMA assessments, TOS, exam creator |
| `05_analytics_health_kpi.sql` | 100–119 (20) | Item analysis, ARAL, anecdotal, grade monitoring, School Report Card, KPI |
| `06_supervision_calendar.sql` | 120–129 (10) | Instructional supervision, schedule override, school calendar, request access |
| `07_enrollment_exams_als.sql` | 130–137 (9) | Enrollment identity & isolation, OMR exam scanning, ALS, multi-school users, schema grants |
| `08_bootstrap_first_account.sql` | — | Seeds the first **super admin** and school. Hand-written. |

Regenerate parts 01–07 after adding migrations — see [Regenerating](#regenerating).

---

## Install

### 1. Create the Supabase project

New project, new database password. Nothing else to configure yet.

### 2. Run parts 01–07, in order

SQL Editor → paste each file → Run. Wait for each to finish before starting the next;
later parts alter tables that earlier parts create.

Parts are 70–140 KB. If the browser editor struggles with a paste that size, use `psql`
against the project's connection string instead:

```bash
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f 01_core_foundation.sql
```

### 3. Expose the schema to the API — *do not skip this*

Dashboard → **Project Settings → API → Exposed schemas** → add `procurements`,
keeping `public` in the list.

The app talks to `procurements` through PostgREST. Until this is set, every single
query fails and the app looks completely broken while the database is in fact fine.
`public` must stay because `get_school_landing_hero`, `get_sms_user_info`,
`check_schedule_conflicts`, `days_overlap`, `times_overlap` and
`update_updated_at_column` all live there — the landing page calls one of them
directly via `.schema("public").rpc(...)`.

### 4. Run `08_bootstrap_first_account.sql`

Seeds `berlcamp@gmail.com` as a **super admin** plus the first school. Change the
names/codes in the `>>> EDIT THESE <<<` block if you want; the defaults work as-is.
Nothing else needs to exist first, and it is safe to re-run.

Do this **before** the first sign-in, not after. This app has no password form — it
signs in with **Google OAuth only** (`components/LoginBox.tsx`), so the `auth.users` row
is created by Google at first sign-in. What must already exist at that moment is the
`sms_users` row: `/auth/callback` looks the caller up by email and, finding nothing,
signs the session straight back out to `/auth/unverified`.

`user_id` is left NULL until then — `AuthGuard` backfills it on first sign-in, the same
path staff added from `/division/users` take.

### 5. Enable Google sign-in

**Authentication → Providers → Google** → enable, and paste a Client ID and Secret.

You can reuse the Google Cloud OAuth client the production project already uses — just
add the new project's callback to its **Authorized redirect URIs** in Google Cloud
Console:

```
https://<new-project-ref>.supabase.co/auth/v1/callback
```

Then set **Authentication → URL Configuration**:

- **Site URL** — `http://localhost:3000` while demoing locally (the deployed URL later)
- **Redirect URLs** — add `http://localhost:3000/auth/callback`

Getting these wrong is the usual cause of a Google round-trip that lands back on the
login page instead of `/home`.

**Why super admin rather than division_admin:** migrations 094/113/115 put `super admin`
in the *full-access* branch of every RLS policy, so it is not confined to one school's
rows the way `school_head` or `registrar` are. One login reaches every module of every
school, and `SchoolSwitcher` lets it change the active school — which is what you want
when demoing. It is also the role that can then create everything else from
`/division/users`.

### 6. Point the app at the new project

In the cloned checkout's `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://<new-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>
STUDENT_PORTAL_JWT_SECRET=<generate a NEW random secret>
```

Generate a fresh JWT secret (`openssl rand -base64 48`) rather than copying Bayugan's
— reusing it would let a token minted by one deployment be accepted by the other.

**Use a separate checkout directory with its own `.env.local`.** Swapping credentials
back and forth inside the production working copy is how a "demo" script ends up
running against live learner records.

---

## After installing

The database is empty apart from the bootstrap row. From the division admin login you
can add schools and users at `/division/users`, then work through enrollment normally.

`supabase/seed.sql` is **not** part of this flow — it carries hardcoded row ids from an
old dataset. For a demo, entering a few learners through the UI produces something more
convincing anyway.

Storage buckets (`diplomas`, `school-management`) are created by the migrations, so they
appear automatically. Note `school-management` is public by design (migration 078) —
anyone with an object URL can read it.

---

## Notes worth knowing

**Part 01 contains two blocks that come from no migration.** Both are marked in the file
and reflect places where the live production schema has drifted from the migration
history — a fresh install needs them to behave like production.

*Compatibility shim (before the migrations).* Migration 123 attaches its triggers with
`procurements.update_updated_at_column()`, while every other migration defines and uses
`public.update_updated_at_column()`. No migration ever creates the `procurements` copy,
so a database built purely from the migration files fails at 123. The production
database has that function from an out-of-band manual run; part 01 recreates it. Same
class of problem as migration 116.

*App parity (after the migrations).* Two things the application requires that no
migration produces:

- **`sms_users.user_id` must be nullable.** Migration 001 declares it `NOT NULL`, but
  `/division/users` (`AddModal`) inserts a staff row with no `user_id` — the person has
  no Supabase Auth account until their first sign-in, at which point `AuthGuard`
  backfills it. With the `NOT NULL` in force, adding any user from the UI fails.
- **`sms_users.email` must be unique, named exactly `sms_users_email_key`.** 001 creates
  only a non-unique index. `AuthGuard` resolves the account with
  `.eq("email", …).single()`, which errors on duplicates, and `AddModal` reports "Email
  already exists" by matching error `23505` against that constraint name — so the name
  is load-bearing.

Neither is a change to production; production evidently already has both. They only
bring a from-scratch database up to the same state.

**Table privileges come from migration 137, not from the earlier migrations.** Grants were
only ever issued ad-hoc before that — 21 live tables, `sms_users` among them, were never
granted to anybody. Production doesn't show it because it has blanket grants from an
out-of-band run, but a from-scratch database fails at the first post-login read with
`42501 permission denied for table sms_users`. 137 grants the whole schema to
`authenticated` / `service_role` and sets DEFAULT PRIVILEGES so later tables inherit it.
`anon` is deliberately left as 005/015/034 declared it — 45 tables here have no RLS policy,
so a blanket `anon` grant would publish learner records. Same caveat applies to
`authenticated`, which anyone completing Google OAuth holds even if `/auth/callback` then
signs them out; on those 45 tables the grant is the only gate.

**Duplicate migration numbers.** Numbers 091, 092, 098 and 135 each have more than one
file. Ordering falls out of the full filename, which is what these parts preserve. If
you ever replay the individual migrations yourself, sort by full filename, not by the
numeric prefix.

**A fresh install is cleaner than production.** Migration 116's lesson was that
`CREATE TABLE IF NOT EXISTS` silently skipped FK changes on tables that already existed.
On an empty database those statements actually execute, so this install matches the
migration files exactly — which the production database, for historical reasons, does not.

**Vercel deploys with pnpm.** A separate Vercel project is fine, but if you change
dependencies, `pnpm-lock.yaml` has to be regenerated too or the deploy fails with
`ERR_PNPM_OUTDATED_LOCKFILE`. See the root `CLAUDE.md`.

---

## Regenerating

Parts 01–07 are generated, not hand-maintained. After adding migrations:

```bash
bash supabase/setup/generate.sh
```

It concatenates every file in `supabase/migrations/` in `ls | sort` order, splits on the
number ranges in the table above, wraps each part in `BEGIN`/`COMMIT`, and prepends the
compatibility shim to part 01. It reads only — no database, no credentials.

Edit the parts and your changes are lost on the next run, and the parts drift from the
migration history. Change the migrations, then regenerate.

`08_bootstrap_first_account.sql` is hand-written and is **not** regenerated.

When migration numbers pass the last range, add a new range to `part_for()` in the
script — otherwise everything new keeps piling into part 07.

---

## How this was verified

On a local throwaway Postgres (never against any Supabase project), with the
Supabase-managed objects the migrations depend on — the `anon` / `authenticated` /
`service_role` roles, `auth.uid()`, `auth.role()`, `auth.users`, `storage.buckets`,
`storage.objects` — stubbed in:

> Covers migrations 001–136. Migration 137 (schema grants) was added afterwards, in
> response to the `42501` failure a real Supabase install hit — grants are not observable
> on the stubbed local Postgres this verification ran against, which is exactly why the
> gap survived it.

1. All 140 migrations were replayed one at a time onto an empty database. This is what
   surfaced the migration 123 failure described above.
2. The 7 merged parts were applied to a second empty database. All succeeded.
3. `pg_dump --schema-only` of both databases was diffed: **identical**, apart from
   pg_dump's own random nonce and whitespace inside the shim function body.
4. Object counts matched exactly across both: 98 tables, 1134 columns, 74 functions,
   372 RLS policies, 94 triggers, 420 indexes, 1313 constraints, 96 RLS-enabled tables,
   2 storage buckets.
5. The app-parity block was checked against the behaviour it exists for: an
   `AddModal`-style insert with no `user_id` succeeds, and a duplicate email raises
   `23505` naming `sms_users_email_key` — the exact error the UI matches on.
6. `08_bootstrap_first_account.sql` was run through the real Google-OAuth sequence:
   seed on an empty project (creates the super admin with `user_id` NULL) → callback
   lookup by email finds the row → Google creates the `auth.users` row → `AuthGuard`
   backfills `user_id` → seed re-run, which **kept** the backfilled `user_id` rather
   than nulling it, and produced no duplicate rows.
7. The query `AuthGuard` runs at login was replayed against the seeded database and
   returns exactly one row, which is what `.single()` requires.

The two parity statements are the only intentional difference from a plain
140-migration replay; everything else is identical.

Not covered: Supabase-specific behaviour that only exists on a real project — PostgREST
schema exposure, Storage API enforcement of the `storage.objects` policies, and Auth.
Those are exercised the first time the demo app actually loads.
