-- ============================================================================
-- NATIONAL SCHOOL BUILDING INVENTORY (NSBI)
-- ============================================================================
-- The DepEd School Building Inventory Form — a physical-plant census a school
-- files roughly every two years, headed "as of May 31, <year>", and signed by
-- four people: School Head, Planning Officer III, Supply Officer, Engineer III.
--
-- WHY THIS IS A SEPARATE MODULE AND NOT A REPORT OVER LIVE DATA
--   The form is signed on paper. Reprinting the 2026 inventory in 2028 must
--   produce the identical document the Engineer III put their name on. If
--   Table 2 were a live read of sms_rooms, renaming a room or correcting its
--   condition two years later would silently alter a filed, certified return.
--   So everything here is SNAPSHOT at entry time and never re-derived — the
--   rule 112 established for the School Report Card, 121 for a COT form's
--   career_stage, and 152 for a Phil-IRI form's comprehension_total.
--
--   The one concession is nsbi_prefill_rooms(), a ONE-WAY copy out of
--   sms_rooms into this module's own rows. After the copy the inventory owns
--   its data outright. That is the 132 answer-key precedent: prefilling is a
--   convenience, never the mechanism.
--
-- ISOLATION — this migration is additive and self-contained by construction:
--   * No ALTER against any pre-existing table. sms_rooms, sms_sections,
--     sms_schools and sms_kpi_reference are untouched.
--   * No existing CHECK widened. In particular sms_rooms.condition keeps the
--     four values 071 gave it, so 109's classroom-needs RPC, 118's KPI ratios
--     and 137's Classroom Enrollment report cannot move. The NSBI's own
--     condition lists (seven values for a building, five for a room) live only
--     on these new tables.
--   * No foreign key points INTO this module from anywhere else, so the whole
--     thing could be dropped without touching the rest of the system.
--   * No existing RLS policy, trigger or function is replaced.
--   * No DELETE, DROP or TRUNCATE anywhere below, and the only ALTERs are
--     ENABLE ROW LEVEL SECURITY on the three new tables. The single UPDATE in
--     the file lives inside nsbi_copy_from_previous and writes one row of
--     sms_nsbi_submissions — the empty draft the caller is copying INTO.
--
-- Column numbering in the comments (Col. 1 … Col. 18) is the form's own, and
-- is reproduced on the printed output because the division office checks
-- against it.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- 1. sms_nsbi_submissions — the header, one row per school per inventory date
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_nsbi_submissions (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL
    REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,

  -- Keyed on the inventory date, NOT the school year: the form is biennial and
  -- is headed with its own as-of date ("as of May 31, 2026"), which is also
  -- what the printed pages carry. Never substitute today's date at print time.
  as_of_date DATE NOT NULL,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'submitted', 'locked')),

  -- Page 1 header. Kept here rather than on sms_schools so the module stays
  -- hermetic — nothing else in the system reads coordinates today, and the
  -- figure is a fact "as of" this inventory like everything else on the form.
  latitude  NUMERIC(9, 6) CHECK (latitude  BETWEEN -90  AND 90),
  longitude NUMERIC(9, 6) CHECK (longitude BETWEEN -180 AND 180),

  -- --------------------------------------------------------------------
  -- Table 3 — Temporary Learning Space/s and Makeshift Room/s (Cols. 1–4)
  -- --------------------------------------------------------------------
  tls_count                 INT CHECK (tls_count >= 0),
  tls_sections_count        INT CHECK (tls_sections_count >= 0),
  makeshift_count           INT CHECK (makeshift_count >= 0),
  makeshift_sections_count  INT CHECK (makeshift_sections_count >= 0),

  -- --------------------------------------------------------------------
  -- Table 4B — Stand-Alone Water and Sanitation Facilities (Cols. 1–11)
  -- A stand-alone block is built apart from any school building, so it
  -- belongs to the submission and not to a row in sms_nsbi_buildings.
  -- --------------------------------------------------------------------
  standalone_bowls_male           INT CHECK (standalone_bowls_male >= 0),
  standalone_bowls_female         INT CHECK (standalone_bowls_female >= 0),
  standalone_bowls_pwd            INT CHECK (standalone_bowls_pwd >= 0),
  standalone_bowls_shared         INT CHECK (standalone_bowls_shared >= 0),
  standalone_bowls_nonfunctional  INT CHECK (standalone_bowls_nonfunctional >= 0),
  standalone_washbasins           INT CHECK (standalone_washbasins >= 0),
  standalone_urinals              INT CHECK (standalone_urinals >= 0),
  standalone_urinal_troughs       INT CHECK (standalone_urinal_troughs >= 0),
  standalone_septic_tank          BOOLEAN,
  standalone_faucets_with_water     INT CHECK (standalone_faucets_with_water >= 0),
  standalone_faucets_without_water  INT CHECK (standalone_faucets_without_water >= 0),

  -- --------------------------------------------------------------------
  -- Table 5 — Existing Number of Usable Furniture (Cols. 1–12)
  -- Typed columns rather than one JSONB blob: these are the figures a
  -- division office sums across schools, and four of them are the same
  -- components 118 already stores for the KPI seat-learner ratio.
  -- --------------------------------------------------------------------
  furniture_kinder_modular_table  INT CHECK (furniture_kinder_modular_table >= 0),
  furniture_kinder_chair          INT CHECK (furniture_kinder_chair >= 0),
  furniture_armchair              INT CHECK (furniture_armchair >= 0),
  furniture_school_desk           INT CHECK (furniture_school_desk >= 0),
  furniture_other_table           INT CHECK (furniture_other_table >= 0),
  furniture_other_chair           INT CHECK (furniture_other_chair >= 0),
  furniture_1seater_elementary    INT CHECK (furniture_1seater_elementary >= 0),
  furniture_1seater_jhs           INT CHECK (furniture_1seater_jhs >= 0),
  furniture_1seater_shs           INT CHECK (furniture_1seater_shs >= 0),
  furniture_2seater_elementary    INT CHECK (furniture_2seater_elementary >= 0),
  furniture_2seater_jhs           INT CHECK (furniture_2seater_jhs >= 0),
  furniture_2seater_shs           INT CHECK (furniture_2seater_shs >= 0),

  -- --------------------------------------------------------------------
  -- Table 6 — Other Facilities/Amenities (13 Yes/No flags)
  -- JSONB keyed on the amenity code, value TRUE/FALSE, absent = unanswered.
  -- Not 13 boolean columns: DepEd revises this list (bike racks and pathway
  -- cover are recent additions), and per 112 a template-shaped body that
  -- follows the form's revisions belongs in JSONB. It still rolls up —
  -- amenities->>'permanent_perimeter_fence' is perfectly queryable.
  -- Codes are app-validated in lib/constants/nsbi.ts, per the 119 precedent.
  -- --------------------------------------------------------------------
  amenities JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- --------------------------------------------------------------------
  -- Table 7 — Access going to School (check all applicable)
  -- Arrays rather than JSONB: both are flat sets, and an array aggregates
  -- and indexes cleanly for a later division roll-up.
  -- --------------------------------------------------------------------
  access_road_types TEXT[] NOT NULL DEFAULT '{}',
  transport_types   TEXT[] NOT NULL DEFAULT '{}',

  -- [{ role, name, title }] for school_head / planning_officer /
  -- supply_officer / engineer. Only the school head is derivable
  -- (sms_school_settings.principal_name), per the 112 signatories precedent.
  -- NOTE the printed form is not uniform: the Supply Officer signs page 1
  -- only. The per-page signature sets live in lib/constants/nsbi.ts.
  signatories JSONB NOT NULL DEFAULT '[]'::jsonb,

  notes TEXT,
  submitted_at TIMESTAMPTZ,
  submitted_by_user_id BIGINT
    REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (school_id, as_of_date)
);

COMMENT ON TABLE procurements.sms_nsbi_submissions IS
  'DepEd School Building Inventory header: one per (school, as_of_date). Snapshot — never re-derived from live data, because the form is signed on paper (migration 154).';

COMMENT ON COLUMN procurements.sms_nsbi_submissions.as_of_date IS
  'The inventory date the form is headed with ("as of May 31, 2026"). Printed from this column, never from the current date.';

COMMENT ON COLUMN procurements.sms_nsbi_submissions.amenities IS
  'Table 6. { amenity_code: boolean }; an absent key means unanswered, which is distinct from No. Codes validated in lib/constants/nsbi.ts.';

CREATE INDEX IF NOT EXISTS idx_nsbi_submissions_school
  ON procurements.sms_nsbi_submissions (school_id, as_of_date DESC);

DROP TRIGGER IF EXISTS update_sms_nsbi_submissions_updated_at
  ON procurements.sms_nsbi_submissions;
CREATE TRIGGER update_sms_nsbi_submissions_updated_at
  BEFORE UPDATE ON procurements.sms_nsbi_submissions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 2. sms_nsbi_buildings — Table 1 (Cols. 1–18) + Table 4A (Cols. 1–12)
-- ============================================================================
-- Table 4A is per building, so its eleven counts live on the building row
-- rather than in a table of their own: there is exactly one 4A line per
-- building on the form, and splitting them would buy nothing but a join.
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_nsbi_buildings (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL
    REFERENCES procurements.sms_nsbi_submissions(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,

  building_name TEXT NOT NULL,                        -- Col. 1

  -- Col. 2. Free TEXT, app-validated against the ~150 types in
  -- lib/constants/nsbi.ts, per the 119/132 precedent: DepEd revises this list
  -- (the guide's own last entry in each group is a catch-all), and a CHECK
  -- would turn a list revision into a migration that invalidates signed forms.
  building_type TEXT,

  fund_sources TEXT[] NOT NULL DEFAULT '{}',          -- Col. 3, multi-select
  specific_fund_source TEXT,                          -- Col. 4

  -- Col. 5. SEVEN values — the building list, which is longer than the room
  -- list in Table 2 and longer again than sms_rooms.condition's four. The
  -- three enums are deliberately independent of one another.
  condition TEXT CHECK (
    condition IS NULL OR condition IN (
      'good',
      'needs_minor_repair',
      'needs_major_repair',
      'ongoing_construction',
      'for_completion',
      'for_condemnation',
      'condemned'
    )
  ),

  storeys    INT CHECK (storeys >= 0),                -- Col. 6
  room_count INT CHECK (room_count >= 0),             -- Col. 7
  year_completed INT CHECK (year_completed BETWEEN 1800 AND 2200),  -- Col. 8

  classification TEXT CHECK (                         -- Col. 9
    classification IS NULL
    OR classification IN ('permanent', 'semi_permanent')
  ),

  -- Cols. 10–13. Nullable on purpose: "not yet answered" has to stay
  -- distinguishable from an answered "No" on a form that is signed as
  -- complete.
  pwd_accessible                BOOLEAN,
  major_repair_last_5y          BOOLEAN,
  has_certificate_of_acceptance BOOLEAN,
  in_deped_book_of_accounts     BOOLEAN,

  building_materials TEXT[] NOT NULL DEFAULT '{}',    -- Col. 14, multi-select

  date_of_acquisition DATE,                           -- Col. 15
  acquisition_cost NUMERIC(14, 2) CHECK (acquisition_cost >= 0),  -- Col. 16
  book_value       NUMERIC(14, 2),                    -- Col. 17
  insurance_info TEXT,                                -- Col. 18

  -- ---- Table 4A, this building's water and sanitation facilities ----
  bowls_male           INT CHECK (bowls_male >= 0),
  bowls_female         INT CHECK (bowls_female >= 0),
  bowls_pwd            INT CHECK (bowls_pwd >= 0),
  bowls_shared         INT CHECK (bowls_shared >= 0),
  bowls_nonfunctional  INT CHECK (bowls_nonfunctional >= 0),
  washbasins           INT CHECK (washbasins >= 0),
  urinals              INT CHECK (urinals >= 0),
  urinal_troughs       INT CHECK (urinal_troughs >= 0),
  septic_tank          BOOLEAN,
  faucets_with_water     INT CHECK (faucets_with_water >= 0),
  faucets_without_water  INT CHECK (faucets_without_water >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_nsbi_buildings IS
  'NSBI Table 1 (Summary of Existing Building) plus that building''s Table 4A water and sanitation counts (migration 154).';

COMMENT ON COLUMN procurements.sms_nsbi_buildings.book_value IS
  'Col. 17: acquisition cost less depreciation plus cost of repair plus accumulation cost. No non-negative CHECK — the guide defines it as a computed accounting figure and does not forbid a negative result.';

COMMENT ON COLUMN procurements.sms_nsbi_buildings.condition IS
  'Col. 5, seven values. Deliberately NOT sms_rooms.condition (four values, migration 071) — that enum feeds 109/118/137 and is not widened by this module.';

CREATE INDEX IF NOT EXISTS idx_nsbi_buildings_submission
  ON procurements.sms_nsbi_buildings (submission_id, sort_order);

DROP TRIGGER IF EXISTS update_sms_nsbi_buildings_updated_at
  ON procurements.sms_nsbi_buildings;
CREATE TRIGGER update_sms_nsbi_buildings_updated_at
  BEFORE UPDATE ON procurements.sms_nsbi_buildings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 3. sms_nsbi_rooms — Table 2 (Cols. 1–8)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_nsbi_rooms (
  id BIGSERIAL PRIMARY KEY,
  submission_id BIGINT NOT NULL
    REFERENCES procurements.sms_nsbi_submissions(id) ON DELETE CASCADE,
  building_id BIGINT NOT NULL
    REFERENCES procurements.sms_nsbi_buildings(id) ON DELETE CASCADE,
  sort_order INT NOT NULL DEFAULT 0,

  floor_number INT CHECK (floor_number >= 0),   -- Col. 2
  room_number  TEXT,                            -- Col. 3

  -- Col. 4. FIVE values — Table 2's list drops 'ongoing_construction' and
  -- 'for_completion', which describe a building and not a room.
  condition TEXT CHECK (
    condition IS NULL OR condition IN (
      'good',
      'needs_minor_repair',
      'needs_major_repair',
      'for_condemnation',
      'condemned'
    )
  ),

  room_usage TEXT CHECK (                       -- Col. 5
    room_usage IS NULL
    OR room_usage IN ('instructional', 'non_instructional', 'combination')
  ),

  -- Col. 6. An ARRAY THAT PERMITS DUPLICATES, which is the whole point: the
  -- guide's own example is a room shared by two SPED classes at the same time,
  -- recorded as "SPED classroom and SPED classroom". The count of entries is
  -- the count of concurrent usages, so a set type would silently lose data.
  -- Codes are app-validated (lib/constants/nsbi.ts), not CHECK-constrained.
  actual_usages TEXT[] NOT NULL DEFAULT '{}',

  -- Cols. 7–8. Two numeric columns, because the form has two columns. Width is
  -- the chalkboard side and length the window side, per the guide. Prefill
  -- splits sms_rooms.dimension ("40 x 30") into these.
  width_m  NUMERIC(6, 2) CHECK (width_m  > 0),
  length_m NUMERIC(6, 2) CHECK (length_m > 0),

  -- Provenance only, so nsbi_prefill_rooms can tell which rooms it already
  -- copied. NOTHING joins through this for display: the inventory prints
  -- entirely from its own columns, which is why ON DELETE SET NULL is safe and
  -- why retiring a room never disturbs a filed return.
  source_room_id BIGINT
    REFERENCES procurements.sms_rooms(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE procurements.sms_nsbi_rooms IS
  'NSBI Table 2 (Existing Rooms per Building). Snapshot of the room as it stood on the submission''s as_of_date (migration 154).';

COMMENT ON COLUMN procurements.sms_nsbi_rooms.actual_usages IS
  'Col. 6. Duplicates are meaningful: two concurrent SPED classes in one room is ["sped_classroom","sped_classroom"], per the answering guide.';

COMMENT ON COLUMN procurements.sms_nsbi_rooms.source_room_id IS
  'Provenance for nsbi_prefill_rooms deduplication only. Never read for display — the printed form uses this table''s own columns.';

CREATE INDEX IF NOT EXISTS idx_nsbi_rooms_building
  ON procurements.sms_nsbi_rooms (building_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_nsbi_rooms_submission
  ON procurements.sms_nsbi_rooms (submission_id);
CREATE INDEX IF NOT EXISTS idx_nsbi_rooms_source
  ON procurements.sms_nsbi_rooms (source_room_id)
  WHERE source_room_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_sms_nsbi_rooms_updated_at
  ON procurements.sms_nsbi_rooms;
CREATE TRIGGER update_sms_nsbi_rooms_updated_at
  BEFORE UPDATE ON procurements.sms_nsbi_rooms
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- 4. RLS
-- ============================================================================
-- Shape copied from can_write_src as migration 113 left it:
--   * division_admin / division_type / super admin — full access. Super admin
--     belongs in THIS branch and not the school-matched one, because AuthGuard
--     swaps their school_id for the persisted active-school override, so the
--     school they act for routinely differs from sms_users.school_id (094/113).
--   * school_head / assistant_school_head / admin / registrar — own school,
--     and only while the submission is not 'locked'.
--   * SELECT — any authenticated user, as with the SRC.
-- Not widened to librarian or to any teacher role: the NSBI is a physical-plant
-- return the School Head certifies.
-- ============================================================================
ALTER TABLE procurements.sms_nsbi_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_nsbi_buildings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_nsbi_rooms       ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION procurements.can_write_nsbi(p_submission_id BIGINT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = procurements, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM procurements.sms_nsbi_submissions s
    JOIN procurements.sms_users u ON u.user_id = auth.uid()
    WHERE s.id = p_submission_id
      AND u.is_active
      AND (
        u.type IN ('division_admin', 'division_type', 'super admin')
        OR (
          u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
          AND u.school_id = s.school_id
          AND s.status <> 'locked'
        )
      )
  );
$$;

GRANT EXECUTE ON FUNCTION procurements.can_write_nsbi(BIGINT) TO authenticated;

COMMENT ON FUNCTION procurements.can_write_nsbi(BIGINT) IS
  'Write gate for the NSBI tables. SECURITY DEFINER so the policy can read sms_users regardless of the caller''s own visibility. Mirrors can_write_src (112/113).';

-- ---- sms_nsbi_submissions ----
DROP POLICY IF EXISTS "nsbi_submissions_select" ON procurements.sms_nsbi_submissions;
CREATE POLICY "nsbi_submissions_select"
  ON procurements.sms_nsbi_submissions FOR SELECT
  USING (auth.role() = 'authenticated');

-- INSERT cannot call can_write_nsbi (there is no row id yet): gate on the
-- target school directly, exactly as 112/113 do for the SRC.
DROP POLICY IF EXISTS "nsbi_submissions_insert" ON procurements.sms_nsbi_submissions;
CREATE POLICY "nsbi_submissions_insert"
  ON procurements.sms_nsbi_submissions FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM procurements.sms_users u
      WHERE u.user_id = auth.uid()
        AND u.is_active
        AND (
          u.type IN ('division_admin', 'division_type', 'super admin')
          OR (
            u.type IN ('school_head', 'assistant_school_head', 'admin', 'registrar')
            AND u.school_id = sms_nsbi_submissions.school_id
          )
        )
    )
  );

DROP POLICY IF EXISTS "nsbi_submissions_update" ON procurements.sms_nsbi_submissions;
CREATE POLICY "nsbi_submissions_update"
  ON procurements.sms_nsbi_submissions FOR UPDATE
  USING (procurements.can_write_nsbi(id));

DROP POLICY IF EXISTS "nsbi_submissions_delete" ON procurements.sms_nsbi_submissions;
CREATE POLICY "nsbi_submissions_delete"
  ON procurements.sms_nsbi_submissions FOR DELETE
  USING (procurements.can_write_nsbi(id));

-- ---- sms_nsbi_buildings ----
DROP POLICY IF EXISTS "nsbi_buildings_select" ON procurements.sms_nsbi_buildings;
CREATE POLICY "nsbi_buildings_select"
  ON procurements.sms_nsbi_buildings FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "nsbi_buildings_insert" ON procurements.sms_nsbi_buildings;
CREATE POLICY "nsbi_buildings_insert"
  ON procurements.sms_nsbi_buildings FOR INSERT
  WITH CHECK (procurements.can_write_nsbi(submission_id));

DROP POLICY IF EXISTS "nsbi_buildings_update" ON procurements.sms_nsbi_buildings;
CREATE POLICY "nsbi_buildings_update"
  ON procurements.sms_nsbi_buildings FOR UPDATE
  USING (procurements.can_write_nsbi(submission_id));

DROP POLICY IF EXISTS "nsbi_buildings_delete" ON procurements.sms_nsbi_buildings;
CREATE POLICY "nsbi_buildings_delete"
  ON procurements.sms_nsbi_buildings FOR DELETE
  USING (procurements.can_write_nsbi(submission_id));

-- ---- sms_nsbi_rooms ----
DROP POLICY IF EXISTS "nsbi_rooms_select" ON procurements.sms_nsbi_rooms;
CREATE POLICY "nsbi_rooms_select"
  ON procurements.sms_nsbi_rooms FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "nsbi_rooms_insert" ON procurements.sms_nsbi_rooms;
CREATE POLICY "nsbi_rooms_insert"
  ON procurements.sms_nsbi_rooms FOR INSERT
  WITH CHECK (procurements.can_write_nsbi(submission_id));

DROP POLICY IF EXISTS "nsbi_rooms_update" ON procurements.sms_nsbi_rooms;
CREATE POLICY "nsbi_rooms_update"
  ON procurements.sms_nsbi_rooms FOR UPDATE
  USING (procurements.can_write_nsbi(submission_id));

DROP POLICY IF EXISTS "nsbi_rooms_delete" ON procurements.sms_nsbi_rooms;
CREATE POLICY "nsbi_rooms_delete"
  ON procurements.sms_nsbi_rooms FOR DELETE
  USING (procurements.can_write_nsbi(submission_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON procurements.sms_nsbi_submissions,
     procurements.sms_nsbi_buildings,
     procurements.sms_nsbi_rooms
  TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE procurements.sms_nsbi_submissions_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_nsbi_buildings_id_seq   TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_nsbi_rooms_id_seq       TO authenticated;

-- ============================================================================
-- 5. nsbi_prefill_rooms — one-way copy out of sms_rooms
-- ============================================================================
-- SECURITY INVOKER (the default, stated for the record) so every insert below
-- passes the policies above and every read of sms_rooms happens as the caller.
-- The school filter is applied explicitly regardless, because 003's SELECT
-- policy on sms_rooms admits any authenticated user without school scoping.
--
-- ADDITIVE AND RE-RUNNABLE. It never updates or deletes: a building already
-- present under the same name is reused, and a room already carrying its
-- source_room_id is skipped. So a school head who adds three rooms in the
-- Rooms module can press the button again to pull just those three, without
-- disturbing anything already corrected by hand.
--
-- What it does NOT prefill: actual_usages (Col. 6). A room_type of 'classroom'
-- does not say whether the form wants "Classroom Elementary", "Classroom JHS"
-- or "Classroom SHS", and guessing wrong on a signed return is worse than
-- leaving the adviser to tick it.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.nsbi_prefill_rooms(p_submission_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = procurements, public
AS $$
DECLARE
  v_school_id BIGINT;
  v_buildings_added INT := 0;
  v_rooms_added INT := 0;
BEGIN
  SELECT school_id INTO v_school_id
  FROM procurements.sms_nsbi_submissions
  WHERE id = p_submission_id;

  IF v_school_id IS NULL THEN
    RAISE EXCEPTION 'Inventory % was not found.', p_submission_id;
  END IF;

  -- 1. A building row per distinct sms_rooms.building not already present.
  --    Rooms with no building recorded collect under one clearly-named row
  --    rather than being dropped: the form has no place for a homeless room,
  --    and a school head can rename it.
  WITH source AS (
    SELECT DISTINCT
      COALESCE(NULLIF(TRIM(r.building), ''), 'Unspecified Building') AS building_name
    FROM procurements.sms_rooms r
    WHERE r.school_id = v_school_id
      AND r.is_active
  ),
  fresh AS (
    SELECT s.building_name
    FROM source s
    WHERE NOT EXISTS (
      SELECT 1
      FROM procurements.sms_nsbi_buildings b
      WHERE b.submission_id = p_submission_id
        AND LOWER(TRIM(b.building_name)) = LOWER(s.building_name)
    )
  ),
  inserted AS (
    INSERT INTO procurements.sms_nsbi_buildings
      (submission_id, building_name, sort_order)
    SELECT
      p_submission_id,
      f.building_name,
      ROW_NUMBER() OVER (ORDER BY f.building_name)
        + COALESCE((
            SELECT MAX(b.sort_order)
            FROM procurements.sms_nsbi_buildings b
            WHERE b.submission_id = p_submission_id
          ), 0)
    FROM fresh f
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_buildings_added FROM inserted;

  -- 2. A room row per active room not already copied into this inventory.
  WITH source AS (
    SELECT
      r.id,
      r.name,
      r.condition,
      r.room_type,
      COALESCE(NULLIF(TRIM(r.building), ''), 'Unspecified Building') AS building_name,
      regexp_match(
        COALESCE(r.dimension, ''),
        '^\s*([0-9]+(?:\.[0-9]+)?)\s*[xX×*]\s*([0-9]+(?:\.[0-9]+)?)\s*$'
      ) AS dim
    FROM procurements.sms_rooms r
    WHERE r.school_id = v_school_id
      AND r.is_active
      AND NOT EXISTS (
        SELECT 1
        FROM procurements.sms_nsbi_rooms nr
        WHERE nr.submission_id = p_submission_id
          AND nr.source_room_id = r.id
      )
  ),
  inserted AS (
    INSERT INTO procurements.sms_nsbi_rooms (
      submission_id, building_id, sort_order, room_number,
      condition, room_usage, width_m, length_m, source_room_id
    )
    SELECT
      p_submission_id,
      b.id,
      ROW_NUMBER() OVER (PARTITION BY b.id ORDER BY s.name),
      s.name,
      -- sms_rooms.condition's four values are a strict subset of Table 2's
      -- five, so this maps 1:1 with nothing to invent.
      s.condition,
      -- Col. 5 only where the room type settles it. The guide files science,
      -- computer and speech laboratories under Instructional and the library
      -- under Non-Instructional; a gym, an auditorium or 'other' is left for
      -- the school head, and NULL means unanswered.
      CASE s.room_type
        WHEN 'classroom'    THEN 'instructional'
        WHEN 'laboratory'   THEN 'instructional'
        WHEN 'computer_lab' THEN 'instructional'
        WHEN 'science_lab'  THEN 'instructional'
        WHEN 'music_room'   THEN 'instructional'
        WHEN 'art_room'     THEN 'instructional'
        WHEN 'library'      THEN 'non_instructional'
        ELSE NULL
      END,
      (s.dim[1])::NUMERIC,
      (s.dim[2])::NUMERIC,
      s.id
    FROM source s
    JOIN procurements.sms_nsbi_buildings b
      ON b.submission_id = p_submission_id
     AND LOWER(TRIM(b.building_name)) = LOWER(s.building_name)
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_rooms_added FROM inserted;

  RETURN jsonb_build_object(
    'buildings_added', v_buildings_added,
    'rooms_added', v_rooms_added
  );
END;
$$;

GRANT EXECUTE ON FUNCTION procurements.nsbi_prefill_rooms(BIGINT) TO authenticated;

COMMENT ON FUNCTION procurements.nsbi_prefill_rooms(BIGINT) IS
  'One-way prefill of NSBI Table 2 from sms_rooms. Additive and re-runnable: reuses a building of the same name, skips a room already copied, never updates or deletes. The inventory owns its rows afterwards (migration 154).';

-- ============================================================================
-- 6. nsbi_copy_from_previous — carry a filed inventory into the next cycle
-- ============================================================================
-- The form is filed roughly every two years and almost nothing moves between
-- cycles: the same buildings, toilets, furniture, amenities and access road.
-- Without this a school head re-encodes seven tables from scratch every time,
-- which is how a module gets abandoned in favour of the spreadsheet it was
-- meant to replace.
--
-- REFUSES rather than overwrites. If the target already holds buildings, the
-- call raises instead of clearing them — there is no DELETE anywhere in this
-- module, so a copy can never destroy work already typed. The UI offers the
-- copy on a freshly created inventory and hides it thereafter.
--
-- Both submissions must belong to the SAME SCHOOL. Without that guard, a
-- division_admin (who can write any school's inventory) could seed one
-- school's return from another's building stock.
-- ============================================================================
CREATE OR REPLACE FUNCTION procurements.nsbi_copy_from_previous(
  p_submission_id BIGINT,
  p_from_submission_id BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = procurements, public
AS $$
DECLARE
  v_school_id BIGINT;
  v_from_school_id BIGINT;
  v_buildings_added INT := 0;
  v_rooms_added INT := 0;
  v_building procurements.sms_nsbi_buildings%ROWTYPE;
  v_new_building_id BIGINT;
BEGIN
  IF p_submission_id = p_from_submission_id THEN
    RAISE EXCEPTION 'An inventory cannot be copied onto itself.';
  END IF;

  SELECT school_id INTO v_school_id
  FROM procurements.sms_nsbi_submissions WHERE id = p_submission_id;
  SELECT school_id INTO v_from_school_id
  FROM procurements.sms_nsbi_submissions WHERE id = p_from_submission_id;

  IF v_school_id IS NULL OR v_from_school_id IS NULL THEN
    RAISE EXCEPTION 'One of the inventories was not found.';
  END IF;

  IF v_school_id <> v_from_school_id THEN
    RAISE EXCEPTION 'An inventory can only be copied from the same school.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM procurements.sms_nsbi_buildings
    WHERE submission_id = p_submission_id
  ) THEN
    RAISE EXCEPTION
      'This inventory already has buildings recorded. Copy into a new, empty inventory instead.';
  END IF;

  -- 1. Header scalars. as_of_date, status, notes and the submission trail are
  --    deliberately NOT copied: those identify this cycle, not the last one.
  --    The signatories ARE copied — the same four officers usually sign, and
  --    they remain editable.
  UPDATE procurements.sms_nsbi_submissions t
  SET
    latitude  = f.latitude,
    longitude = f.longitude,
    tls_count = f.tls_count,
    tls_sections_count = f.tls_sections_count,
    makeshift_count = f.makeshift_count,
    makeshift_sections_count = f.makeshift_sections_count,
    standalone_bowls_male = f.standalone_bowls_male,
    standalone_bowls_female = f.standalone_bowls_female,
    standalone_bowls_pwd = f.standalone_bowls_pwd,
    standalone_bowls_shared = f.standalone_bowls_shared,
    standalone_bowls_nonfunctional = f.standalone_bowls_nonfunctional,
    standalone_washbasins = f.standalone_washbasins,
    standalone_urinals = f.standalone_urinals,
    standalone_urinal_troughs = f.standalone_urinal_troughs,
    standalone_septic_tank = f.standalone_septic_tank,
    standalone_faucets_with_water = f.standalone_faucets_with_water,
    standalone_faucets_without_water = f.standalone_faucets_without_water,
    furniture_kinder_modular_table = f.furniture_kinder_modular_table,
    furniture_kinder_chair = f.furniture_kinder_chair,
    furniture_armchair = f.furniture_armchair,
    furniture_school_desk = f.furniture_school_desk,
    furniture_other_table = f.furniture_other_table,
    furniture_other_chair = f.furniture_other_chair,
    furniture_1seater_elementary = f.furniture_1seater_elementary,
    furniture_1seater_jhs = f.furniture_1seater_jhs,
    furniture_1seater_shs = f.furniture_1seater_shs,
    furniture_2seater_elementary = f.furniture_2seater_elementary,
    furniture_2seater_jhs = f.furniture_2seater_jhs,
    furniture_2seater_shs = f.furniture_2seater_shs,
    amenities = f.amenities,
    access_road_types = f.access_road_types,
    transport_types = f.transport_types,
    signatories = f.signatories
  FROM procurements.sms_nsbi_submissions f
  WHERE t.id = p_submission_id
    AND f.id = p_from_submission_id;

  -- 2. Buildings, then that building's rooms, one building at a time.
  --    Deliberately a loop rather than one set-based INSERT..SELECT: the rooms
  --    have to land under their new building, and recovering that mapping from
  --    a bulk RETURNING would mean matching on (sort_order, building_name),
  --    neither of which is unique — two "Gabaldon" rows at sort_order 0 would
  --    silently cross-join. Capturing each new id as it is minted is exact,
  --    and a school has tens of buildings, not thousands.
  FOR v_building IN
    SELECT * FROM procurements.sms_nsbi_buildings
    WHERE submission_id = p_from_submission_id
    ORDER BY sort_order, id
  LOOP
    INSERT INTO procurements.sms_nsbi_buildings (
      submission_id, sort_order, building_name, building_type, fund_sources,
      specific_fund_source, condition, storeys, room_count, year_completed,
      classification, pwd_accessible, major_repair_last_5y,
      has_certificate_of_acceptance, in_deped_book_of_accounts,
      building_materials, date_of_acquisition, acquisition_cost, book_value,
      insurance_info, bowls_male, bowls_female, bowls_pwd, bowls_shared,
      bowls_nonfunctional, washbasins, urinals, urinal_troughs, septic_tank,
      faucets_with_water, faucets_without_water
    )
    VALUES (
      p_submission_id, v_building.sort_order, v_building.building_name,
      v_building.building_type, v_building.fund_sources,
      v_building.specific_fund_source, v_building.condition, v_building.storeys,
      v_building.room_count, v_building.year_completed,
      v_building.classification, v_building.pwd_accessible,
      v_building.major_repair_last_5y, v_building.has_certificate_of_acceptance,
      v_building.in_deped_book_of_accounts, v_building.building_materials,
      v_building.date_of_acquisition, v_building.acquisition_cost,
      v_building.book_value, v_building.insurance_info, v_building.bowls_male,
      v_building.bowls_female, v_building.bowls_pwd, v_building.bowls_shared,
      v_building.bowls_nonfunctional, v_building.washbasins, v_building.urinals,
      v_building.urinal_troughs, v_building.septic_tank,
      v_building.faucets_with_water, v_building.faucets_without_water
    )
    RETURNING id INTO v_new_building_id;

    v_buildings_added := v_buildings_added + 1;

    -- 3. That building's rooms. source_room_id is carried over so a later
    --    prefill still knows which sms_rooms rows this cycle already holds.
    WITH inserted AS (
      INSERT INTO procurements.sms_nsbi_rooms (
        submission_id, building_id, sort_order, floor_number, room_number,
        condition, room_usage, actual_usages, width_m, length_m, source_room_id
      )
      SELECT
        p_submission_id, v_new_building_id, r.sort_order, r.floor_number,
        r.room_number, r.condition, r.room_usage, r.actual_usages, r.width_m,
        r.length_m, r.source_room_id
      FROM procurements.sms_nsbi_rooms r
      WHERE r.submission_id = p_from_submission_id
        AND r.building_id = v_building.id
      RETURNING 1
    )
    SELECT v_rooms_added + COUNT(*) INTO v_rooms_added FROM inserted;
  END LOOP;

  RETURN jsonb_build_object(
    'buildings_added', v_buildings_added,
    'rooms_added', v_rooms_added
  );
END;
$$;

GRANT EXECUTE ON FUNCTION
  procurements.nsbi_copy_from_previous(BIGINT, BIGINT) TO authenticated;

COMMENT ON FUNCTION procurements.nsbi_copy_from_previous(BIGINT, BIGINT) IS
  'Deep-copies a previous NSBI (header scalars, buildings, rooms) into an EMPTY draft for the next biennial cycle. Refuses if the target already holds buildings, and refuses across schools. Never deletes (migration 154).';
