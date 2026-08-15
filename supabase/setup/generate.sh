#!/bin/bash
# =============================================================================
# Regenerate the merged fresh-install parts from supabase/migrations/
# =============================================================================
# Usage:  bash supabase/setup/generate.sh
#
# Reads only. Writes only supabase/setup/0{1..7}_*.sql. Touches no database and
# needs no credentials. 08_bootstrap_first_account.sql is hand-written and is
# NOT regenerated.
#
# Run this after adding migrations, instead of editing the parts by hand.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$(cd "$HERE/../migrations" && pwd)"
OUT="$HERE"

# Part boundaries. Add a new range here when migration numbers pass the last one.
part_for() {
  local n=$((10#${1:0:3}))
  if   [ "$n" -le 29 ];  then echo "01_core_foundation"
  elif [ "$n" -le 59 ];  then echo "02_multi_school_transfers"
  elif [ "$n" -le 79 ];  then echo "03_division_reports_landing"
  elif [ "$n" -le 99 ];  then echo "04_class_record_assessments"
  elif [ "$n" -le 119 ]; then echo "05_analytics_health_kpi"
  elif [ "$n" -le 129 ]; then echo "06_supervision_calendar"
  else                        echo "07_enrollment_exams_als"; fi
}

title_for() {
  case "$1" in
    01_core_foundation)          echo "Core schema, rooms, schedules, attendance, books, health, requests" ;;
    02_multi_school_transfers)   echo "Multi-school support, transfers, settings, ECCD, evaluations, report cards" ;;
    03_division_reports_landing) echo "Promotion & graduation, MPS, division reports, landing pages, storage" ;;
    04_class_record_assessments) echo "Class record, CRLA / Phil-IRI / RMA assessments, TOS, exam creator" ;;
    05_analytics_health_kpi)     echo "Item analysis, ARAL, anecdotal, grade monitoring, School Report Card, KPI" ;;
    06_supervision_calendar)     echo "Instructional supervision, schedule override, school calendar, request access" ;;
    07_enrollment_exams_als)     echo "Enrollment identity & isolation, OMR exam scanning, ALS, multi-school users" ;;
  esac
}

PARTS=(01_core_foundation 02_multi_school_transfers 03_division_reports_landing
       04_class_record_assessments 05_analytics_health_kpi 06_supervision_calendar
       07_enrollment_exams_als)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
for p in "${PARTS[@]}"; do : > "$TMP/$p"; done

# `ls | sort` is the ordering a migration runner uses, and the ordering the
# verification replay used. Numbers 091/092/098/135 are duplicated across files,
# so full-filename order — not the numeric prefix — is what disambiguates them.
for f in $(ls "$MIG" | sort); do
  echo "$f" >> "$TMP/$(part_for "$f")"
done

total=0
idx=0
for p in "${PARTS[@]}"; do
  idx=$((idx+1))
  dest="$OUT/$p.sql"
  files="$(cat "$TMP/$p")"
  count=$(echo "$files" | wc -l | tr -d ' ')
  total=$((total+count))
  {
    echo "-- ============================================================================"
    echo "-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART $idx OF 7"
    echo "-- $(title_for "$p")"
    echo "-- ============================================================================"
    echo "-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead."
    echo "-- A byte-for-byte concatenation of the $count migrations listed below, in the"
    echo "-- exact order a migration runner would apply them."
    echo "--"
    echo "-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already"
    echo "-- has the migration history applied — use supabase/migrations/ for that."
    echo "--"
    echo "-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,"
    echo "-- so a failure rolls the whole part back and leaves nothing half-applied."
    echo "--"
    echo "-- Migrations merged into this part:"
    echo "$files" | sed 's/^/--   /'
    echo "-- ============================================================================"
    echo
    echo "BEGIN;"
    echo
    echo "SET search_path TO procurements, public;"
    echo
    if [ "$idx" -eq 1 ]; then
      cat <<'SHIM'
-- ----------------------------------------------------------------------------
-- COMPATIBILITY SHIM (not from any migration file)
--
-- Migration 123 attaches its triggers with procurements.update_updated_at_column(),
-- but every other migration defines and uses public.update_updated_at_column().
-- Nothing in the migration history ever creates the procurements-schema copy, so
-- 123 fails on a database built purely from these files. The live production
-- database has the function from an out-of-band manual run; this recreates that
-- state so a fresh install matches. Body is identical to the public one in 001.
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS procurements;

CREATE OR REPLACE FUNCTION procurements.update_updated_at_column()
RETURNS TRIGGER AS $shim$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$shim$ LANGUAGE plpgsql;

SHIM
    fi
    for f in $files; do
      echo "-- ============================================================================"
      echo "-- >>> BEGIN $f"
      echo "-- ============================================================================"
      echo
      cat "$MIG/$f"
      echo
      echo "-- <<< END $f"
      echo
    done
    if [ "$idx" -eq 1 ]; then
      cat <<'PARITY'
-- ----------------------------------------------------------------------------
-- APP PARITY (not from any migration file)
--
-- Two things the application code requires that no migration produces. Both are
-- applied at the END of this part, after 001 has created sms_users.
--
-- 1. user_id must be NULLABLE. 001 declares it NOT NULL, but /division/users
--    (AddModal) inserts a staff row with no user_id at all -- the person has no
--    Supabase Auth account until they first sign in, at which point AuthGuard
--    backfills it ("user created by division admin before first login"). With
--    the NOT NULL in force, adding any user from the UI fails outright.
--
-- 2. email must be UNIQUE, under exactly the name sms_users_email_key. 001
--    creates only a non-unique index. AuthGuard resolves the signed-in account
--    with .eq("email", ...).single(), which errors on duplicates, and AddModal
--    reports "Email already exists" by matching error 23505 against that
--    constraint name -- so the name is load-bearing, not cosmetic.
--
-- The production database evidently has both from out-of-band manual changes;
-- this is what lets a fresh install behave the same. Guarded, so re-running is
-- harmless.
-- ----------------------------------------------------------------------------
DO $parity$
BEGIN
  ALTER TABLE procurements.sms_users ALTER COLUMN user_id DROP NOT NULL;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'procurements.sms_users'::regclass
      AND conname  = 'sms_users_email_key'
  ) THEN
    ALTER TABLE procurements.sms_users
      ADD CONSTRAINT sms_users_email_key UNIQUE (email);
  END IF;
END
$parity$;

PARITY
    fi
    echo "COMMIT;"
  } > "$dest"
  printf "%-32s %3s migrations  %8s bytes\n" "$p.sql" "$count" "$(wc -c < "$dest" | tr -d ' ')"
done

echo "---"
echo "merged $total of $(ls "$MIG" | wc -l | tr -d ' ') migration files"
