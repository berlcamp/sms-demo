-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM — FRESH INSTALL, PART 1 OF 7
-- Core schema, rooms, schedules, attendance, books, health, requests
-- ============================================================================
-- GENERATED FILE — do not edit by hand; run supabase/setup/generate.sh instead.
-- A byte-for-byte concatenation of the 28 migrations listed below, in the
-- exact order a migration runner would apply them.
--
-- FOR NEW / EMPTY DATABASES ONLY. Never run this against a database that already
-- has the migration history applied — use supabase/migrations/ for that.
--
-- Run the seven parts strictly in order: 01 -> 07. Each part is one transaction,
-- so a failure rolls the whole part back and leaves nothing half-applied.
--
-- Migrations merged into this part:
--   001_school_management_schema.sql
--   003_rooms.sql
--   004_subject_schedules.sql
--   005_grant_permissions.sql
--   006_add_student_enrollment_fields.sql
--   007_remove_deleted_at.sql
--   008_section_type.sql
--   009_gpa_thresholds.sql
--   010_enrollment_unique_student_school_year.sql
--   011_division_admin_schema.sql
--   012_remove_division_id_requirement.sql
--   013_add_school_id_fk.sql
--   014_schools_contact_fields.sql
--   015_public_landing_read_access.sql
--   016_add_school_id_to_schedules.sql
--   017_add_kindergarten_grade_level.sql
--   018_schools_district_type_constraints.sql
--   019_sms_attendance.sql
--   020_students_encoded_by.sql
--   021_sms_books_schema.sql
--   022_drop_sms_subject_assignments.sql
--   023_sms_learner_health.sql
--   024_requests_request_type.sql
--   025_student_diploma.sql
--   026_storage_diplomas.sql
--   027_rename_sms_form137_to_sms_form_requests.sql
--   028_enrollment_semester.sql
--   029_student_birth_certificate_good_moral.sql
-- ============================================================================

BEGIN;

SET search_path TO procurements, public;

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

-- ============================================================================
-- >>> BEGIN 001_school_management_schema.sql
-- ============================================================================

-- ============================================================================
-- SCHOOL MANAGEMENT SYSTEM DATABASE SCHEMA
-- ============================================================================
-- This migration creates all tables for the School Management System
-- Run this in your Supabase SQL Editor or via Supabase CLI
-- All tables are created in the 'procurements' schema
-- ============================================================================

-- Create procurements schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS procurements;

-- Set the schema to procurements
SET search_path TO procurements, public;

-- ============================================================================
-- SMS_USERS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_users (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE, -- Supabase Auth user ID
  division_id TEXT,
  school_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  position TEXT,
  employee_id TEXT,
  type TEXT CHECK (type IN ('school_head', 'teacher', 'registrar', 'admin', 'super admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for sms_users
CREATE INDEX IF NOT EXISTS idx_sms_users_user_id ON procurements.sms_users(user_id);
CREATE INDEX IF NOT EXISTS idx_sms_users_email ON procurements.sms_users(email);
CREATE INDEX IF NOT EXISTS idx_sms_users_active ON procurements.sms_users(is_active) WHERE is_active = true;

-- ============================================================================
-- SUBJECTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_subjects (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  grade_level INTEGER NOT NULL CHECK (grade_level >= 1 AND grade_level <= 12),
  subject_teacher_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for subjects
CREATE INDEX IF NOT EXISTS idx_subjects_grade_level ON procurements.sms_subjects(grade_level);
CREATE INDEX IF NOT EXISTS idx_subjects_teacher ON procurements.sms_subjects(subject_teacher_id);
CREATE INDEX IF NOT EXISTS idx_subjects_active ON procurements.sms_subjects(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_subjects_code ON procurements.sms_subjects(code);

-- ============================================================================
-- SECTIONS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_sections (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  grade_level INTEGER NOT NULL CHECK (grade_level >= 1 AND grade_level <= 12),
  school_year TEXT NOT NULL,
  section_adviser_id BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  max_students INTEGER CHECK (max_students > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(name, school_year, grade_level)
);

-- Indexes for sections
CREATE INDEX IF NOT EXISTS idx_sections_grade_level ON procurements.sms_sections(grade_level);
CREATE INDEX IF NOT EXISTS idx_sections_school_year ON procurements.sms_sections(school_year);
CREATE INDEX IF NOT EXISTS idx_sections_adviser ON procurements.sms_sections(section_adviser_id);
CREATE INDEX IF NOT EXISTS idx_sections_active ON procurements.sms_sections(is_active) WHERE is_active = true;

-- ============================================================================
-- STUDENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_students (
  id BIGSERIAL PRIMARY KEY,
  lrn TEXT NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  middle_name TEXT,
  last_name TEXT NOT NULL,
  suffix TEXT,
  date_of_birth DATE NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('male', 'female')),
  contact_number TEXT,
  email TEXT,
  parent_guardian_name TEXT NOT NULL,
  parent_guardian_contact TEXT NOT NULL,
  parent_guardian_relationship TEXT NOT NULL,
  previous_school TEXT,
  enrollment_status TEXT NOT NULL DEFAULT 'enrolled' 
    CHECK (enrollment_status IN ('enrolled', 'transferred', 'graduated', 'dropped')),
  current_section_id BIGINT REFERENCES procurements.sms_sections(id) ON DELETE SET NULL,
  enrolled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for students
CREATE INDEX IF NOT EXISTS idx_students_lrn ON procurements.sms_students(lrn);
CREATE INDEX IF NOT EXISTS idx_students_section ON procurements.sms_students(current_section_id);
CREATE INDEX IF NOT EXISTS idx_students_status ON procurements.sms_students(enrollment_status);
CREATE INDEX IF NOT EXISTS idx_students_name ON procurements.sms_students(last_name, first_name);
CREATE INDEX IF NOT EXISTS idx_students_active ON procurements.sms_students(enrollment_status) WHERE enrollment_status = 'enrolled';

-- ============================================================================
-- SECTION STUDENTS (Junction Table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_section_students (
  id BIGSERIAL PRIMARY KEY,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  transferred_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(section_id, student_id, school_year)
);

-- Indexes for section_students
CREATE INDEX IF NOT EXISTS idx_section_students_section ON procurements.sms_section_students(section_id);
CREATE INDEX IF NOT EXISTS idx_section_students_student ON procurements.sms_section_students(student_id);
CREATE INDEX IF NOT EXISTS idx_section_students_school_year ON procurements.sms_section_students(school_year);
CREATE INDEX IF NOT EXISTS idx_section_students_active ON procurements.sms_section_students(transferred_at) WHERE transferred_at IS NULL;

-- ============================================================================
-- GRADES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_grades (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES procurements.sms_subjects(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  grading_period INTEGER NOT NULL CHECK (grading_period >= 1 AND grading_period <= 4),
  school_year TEXT NOT NULL,
  grade NUMERIC(5,2) NOT NULL CHECK (grade >= 0 AND grade <= 100),
  remarks TEXT CHECK (remarks IN ('Passed', 'Failed', 'Incomplete')),
  teacher_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, subject_id, section_id, grading_period, school_year)
);

-- Indexes for grades
CREATE INDEX IF NOT EXISTS idx_grades_student ON procurements.sms_grades(student_id);
CREATE INDEX IF NOT EXISTS idx_grades_subject ON procurements.sms_grades(subject_id);
CREATE INDEX IF NOT EXISTS idx_grades_section ON procurements.sms_grades(section_id);
CREATE INDEX IF NOT EXISTS idx_grades_period ON procurements.sms_grades(grading_period, school_year);
CREATE INDEX IF NOT EXISTS idx_grades_teacher ON procurements.sms_grades(teacher_id);

-- ============================================================================
-- ENROLLMENTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_enrollments (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  grade_level INTEGER NOT NULL CHECK (grade_level >= 1 AND grade_level <= 12),
  enrollment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected')),
  enrolled_by BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE RESTRICT,
  approved_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for enrollments
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON procurements.sms_enrollments(student_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_section ON procurements.sms_enrollments(section_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_status ON procurements.sms_enrollments(status);
CREATE INDEX IF NOT EXISTS idx_enrollments_school_year ON procurements.sms_enrollments(school_year);
CREATE INDEX IF NOT EXISTS idx_enrollments_grade_level ON procurements.sms_enrollments(grade_level);

-- ============================================================================
-- FORM 137 REQUESTS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_form137_requests (
  id BIGSERIAL PRIMARY KEY,
  student_lrn TEXT NOT NULL,
  student_id BIGINT REFERENCES procurements.sms_students(id) ON DELETE SET NULL,
  requestor_name TEXT NOT NULL,
  requestor_contact TEXT NOT NULL,
  requestor_relationship TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for form137_requests
CREATE INDEX IF NOT EXISTS idx_form137_lrn ON procurements.sms_form137_requests(student_lrn);
CREATE INDEX IF NOT EXISTS idx_form137_student ON procurements.sms_form137_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_form137_status ON procurements.sms_form137_requests(status);
CREATE INDEX IF NOT EXISTS idx_form137_approved_by ON procurements.sms_form137_requests(approved_by);
CREATE INDEX IF NOT EXISTS idx_form137_requested_at ON procurements.sms_form137_requests(requested_at);

-- ============================================================================
-- SUBJECT ASSIGNMENTS TABLE (Many-to-many: Teachers ↔ Subjects)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_subject_assignments (
  id BIGSERIAL PRIMARY KEY,
  teacher_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  subject_id BIGINT NOT NULL REFERENCES procurements.sms_subjects(id) ON DELETE CASCADE,
  section_id BIGINT REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(teacher_id, subject_id, section_id, school_year)
);

-- Indexes for subject_assignments
CREATE INDEX IF NOT EXISTS idx_subject_assignments_teacher ON procurements.sms_subject_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_subject_assignments_subject ON procurements.sms_subject_assignments(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_assignments_section ON procurements.sms_subject_assignments(section_id);
CREATE INDEX IF NOT EXISTS idx_subject_assignments_school_year ON procurements.sms_subject_assignments(school_year);

-- ============================================================================
-- TRIGGERS FOR UPDATED_AT TIMESTAMPS
-- ============================================================================

-- Function to update updated_at timestamp (create in public schema so it can be used across schemas)
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply triggers to all tables
CREATE TRIGGER update_sms_users_updated_at 
  BEFORE UPDATE ON procurements.sms_users 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_subjects_updated_at 
  BEFORE UPDATE ON procurements.sms_subjects 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_sections_updated_at 
  BEFORE UPDATE ON procurements.sms_sections 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_students_updated_at 
  BEFORE UPDATE ON procurements.sms_students 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_section_students_updated_at 
  BEFORE UPDATE ON procurements.sms_section_students 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_grades_updated_at 
  BEFORE UPDATE ON procurements.sms_grades 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_enrollments_updated_at 
  BEFORE UPDATE ON procurements.sms_enrollments 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_form137_requests_updated_at 
  BEFORE UPDATE ON procurements.sms_form137_requests 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sms_subject_assignments_updated_at 
  BEFORE UPDATE ON procurements.sms_subject_assignments 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
-- Enable RLS on all tables
ALTER TABLE procurements.sms_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_section_students ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_grades ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_form137_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE procurements.sms_subject_assignments ENABLE ROW LEVEL SECURITY;

-- Basic policies (adjust based on your security requirements)
-- These are permissive policies - you should customize them based on your needs

-- SMS Users: All authenticated users can read, only admins can write
CREATE POLICY "SMS users are viewable by authenticated users"
  ON procurements.sms_users FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "SMS users are insertable by admins"
  ON procurements.sms_users FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "SMS users are updatable by admins"
  ON procurements.sms_users FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "SMS users are deletable by admins"
  ON procurements.sms_users FOR DELETE
  USING (auth.role() = 'authenticated');

-- Subjects: All authenticated users can read, only admins/school heads can write
CREATE POLICY "Subjects are viewable by authenticated users"
  ON procurements.sms_subjects FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Subjects are insertable by admins"
  ON procurements.sms_subjects FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Subjects are updatable by admins"
  ON procurements.sms_subjects FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Subjects are deletable by admins"
  ON procurements.sms_subjects FOR DELETE
  USING (auth.role() = 'authenticated');

-- Sections: Similar policies
CREATE POLICY "Sections are viewable by authenticated users"
  ON procurements.sms_sections FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Sections are insertable by admins"
  ON procurements.sms_sections FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Sections are updatable by admins"
  ON procurements.sms_sections FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Sections are deletable by admins"
  ON procurements.sms_sections FOR DELETE
  USING (auth.role() = 'authenticated');

-- Students: Similar policies
CREATE POLICY "Students are viewable by authenticated users"
  ON procurements.sms_students FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Students are insertable by admins"
  ON procurements.sms_students FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Students are updatable by admins"
  ON procurements.sms_students FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Students are deletable by admins"
  ON procurements.sms_students FOR DELETE
  USING (auth.role() = 'authenticated');

-- Section Students: Similar policies
CREATE POLICY "Section students are viewable by authenticated users"
  ON procurements.sms_section_students FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Section students are insertable by admins"
  ON procurements.sms_section_students FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Section students are updatable by admins"
  ON procurements.sms_section_students FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Section students are deletable by admins"
  ON procurements.sms_section_students FOR DELETE
  USING (auth.role() = 'authenticated');

-- Grades: Teachers can insert/update their own grades, all can read
CREATE POLICY "Grades are viewable by authenticated users"
  ON procurements.sms_grades FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Grades are insertable by teachers"
  ON procurements.sms_grades FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Grades are updatable by teachers"
  ON procurements.sms_grades FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Grades are deletable by admins"
  ON procurements.sms_grades FOR DELETE
  USING (auth.role() = 'authenticated');

-- Enrollments: Similar policies
CREATE POLICY "Enrollments are viewable by authenticated users"
  ON procurements.sms_enrollments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Enrollments are insertable by admins"
  ON procurements.sms_enrollments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Enrollments are updatable by admins"
  ON procurements.sms_enrollments FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Enrollments are deletable by admins"
  ON procurements.sms_enrollments FOR DELETE
  USING (auth.role() = 'authenticated');

-- Form 137 Requests: Public can insert, authenticated can read, school head can update
CREATE POLICY "Form 137 requests are viewable by authenticated users"
  ON procurements.sms_form137_requests FOR SELECT
  USING (auth.role() = 'authenticated' OR true);

CREATE POLICY "Form 137 requests are insertable by anyone"
  ON procurements.sms_form137_requests FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Form 137 requests are updatable by admins"
  ON procurements.sms_form137_requests FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Form 137 requests are deletable by admins"
  ON procurements.sms_form137_requests FOR DELETE
  USING (auth.role() = 'authenticated');

-- Subject Assignments: Similar policies
CREATE POLICY "Subject assignments are viewable by authenticated users"
  ON procurements.sms_subject_assignments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Subject assignments are insertable by admins"
  ON procurements.sms_subject_assignments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Subject assignments are updatable by admins"
  ON procurements.sms_subject_assignments FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Subject assignments are deletable by admins"
  ON procurements.sms_subject_assignments FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get user ID by email (if not exists) - create in public schema
CREATE OR REPLACE FUNCTION public.get_user_id_by_email(p_email TEXT)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id
  FROM auth.users
  WHERE email = p_email
  LIMIT 1;
  
  RETURN v_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE procurements.sms_subjects IS 'Subjects offered in the school, organized by grade level';
COMMENT ON TABLE procurements.sms_sections IS 'Class sections for each grade level and school year';
COMMENT ON TABLE procurements.sms_students IS 'Student records with LRN and personal information';
COMMENT ON TABLE procurements.sms_section_students IS 'Junction table linking students to sections';
COMMENT ON TABLE procurements.sms_grades IS 'Student grades per subject, section, and grading period';
COMMENT ON TABLE procurements.sms_enrollments IS 'Enrollment requests and approvals';
COMMENT ON TABLE procurements.sms_form137_requests IS 'Form 137 (Permanent Record) requests from students';
COMMENT ON TABLE procurements.sms_subject_assignments IS 'Many-to-many relationship between teachers and subjects';

-- <<< END 001_school_management_schema.sql

-- ============================================================================
-- >>> BEGIN 003_rooms.sql
-- ============================================================================

-- ============================================================================
-- ROOMS TABLE
-- ============================================================================
-- This migration creates the rooms table for managing school rooms/classrooms
-- ============================================================================

-- Set the schema to procurements
SET search_path TO procurements, public;

-- ============================================================================
-- ROOMS TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_rooms (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  building TEXT,
  capacity INTEGER CHECK (capacity > 0),
  room_type TEXT CHECK (room_type IN ('classroom', 'laboratory', 'library', 'gym', 'auditorium', 'computer_lab', 'science_lab', 'music_room', 'art_room', 'other')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for rooms
CREATE INDEX IF NOT EXISTS idx_rooms_name ON procurements.sms_rooms(name);
CREATE INDEX IF NOT EXISTS idx_rooms_building ON procurements.sms_rooms(building);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON procurements.sms_rooms(room_type);
CREATE INDEX IF NOT EXISTS idx_rooms_active ON procurements.sms_rooms(is_active) WHERE is_active = true;

-- Trigger for updated_at timestamp
CREATE TRIGGER update_sms_rooms_updated_at 
  BEFORE UPDATE ON procurements.sms_rooms 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE procurements.sms_rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rooms are viewable by authenticated users"
  ON procurements.sms_rooms FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Rooms are insertable by admins"
  ON procurements.sms_rooms FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Rooms are updatable by admins"
  ON procurements.sms_rooms FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Rooms are deletable by admins"
  ON procurements.sms_rooms FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE procurements.sms_rooms IS 'School rooms and classrooms available for scheduling';

-- <<< END 003_rooms.sql

-- ============================================================================
-- >>> BEGIN 004_subject_schedules.sql
-- ============================================================================

-- ============================================================================
-- SUBJECT SCHEDULES TABLE
-- ============================================================================
-- This migration creates the subject schedules table with conflict detection
-- ============================================================================

-- Set the schema to procurements
SET search_path TO procurements, public;

-- ============================================================================
-- SUBJECT SCHEDULES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_subject_schedules (
  id BIGSERIAL PRIMARY KEY,
  subject_id BIGINT NOT NULL REFERENCES procurements.sms_subjects(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  teacher_id BIGINT NOT NULL REFERENCES procurements.sms_users(id) ON DELETE CASCADE,
  room_id BIGINT NOT NULL REFERENCES procurements.sms_rooms(id) ON DELETE CASCADE,
  days_of_week INTEGER[] NOT NULL CHECK (array_length(days_of_week, 1) > 0),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL CHECK (end_time > start_time),
  school_year TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for conflict detection and queries
CREATE INDEX IF NOT EXISTS idx_subject_schedules_subject ON procurements.sms_subject_schedules(subject_id);
CREATE INDEX IF NOT EXISTS idx_subject_schedules_section ON procurements.sms_subject_schedules(section_id);
CREATE INDEX IF NOT EXISTS idx_subject_schedules_teacher ON procurements.sms_subject_schedules(teacher_id);
CREATE INDEX IF NOT EXISTS idx_subject_schedules_room ON procurements.sms_subject_schedules(room_id);
CREATE INDEX IF NOT EXISTS idx_subject_schedules_school_year ON procurements.sms_subject_schedules(school_year);
CREATE INDEX IF NOT EXISTS idx_subject_schedules_days ON procurements.sms_subject_schedules USING GIN(days_of_week);
CREATE INDEX IF NOT EXISTS idx_subject_schedules_time ON procurements.sms_subject_schedules(start_time, end_time);

-- Trigger for updated_at timestamp
CREATE TRIGGER update_sms_subject_schedules_updated_at 
  BEFORE UPDATE ON procurements.sms_subject_schedules 
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- CONFLICT DETECTION FUNCTIONS
-- ============================================================================

-- Function to check if two time ranges overlap
CREATE OR REPLACE FUNCTION public.times_overlap(
  start1 TIME,
  end1 TIME,
  start2 TIME,
  end2 TIME
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN (start1 < end2 AND end1 > start2);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check if two day arrays have any common days
CREATE OR REPLACE FUNCTION public.days_overlap(
  days1 INTEGER[],
  days2 INTEGER[]
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 
    FROM unnest(days1) AS day1
    WHERE day1 = ANY(days2)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to check schedule conflicts
CREATE OR REPLACE FUNCTION public.check_schedule_conflicts(
  p_room_id BIGINT,
  p_teacher_id BIGINT,
  p_section_id BIGINT,
  p_days_of_week INTEGER[],
  p_start_time TIME,
  p_end_time TIME,
  p_school_year TEXT,
  p_id BIGINT DEFAULT NULL -- For updates, exclude current record
) RETURNS TABLE(
  conflict_type TEXT,
  conflict_message TEXT
) AS $$
DECLARE
  conflict_count INTEGER;
BEGIN
  -- Check room conflicts
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE room_id = p_room_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);
  
  IF conflict_count > 0 THEN
    RETURN QUERY SELECT 
      'room'::TEXT,
      'Room is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- Check teacher conflicts
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE teacher_id = p_teacher_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);
  
  IF conflict_count > 0 THEN
    RETURN QUERY SELECT 
      'teacher'::TEXT,
      'Teacher is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- Check section conflicts
  SELECT COUNT(*) INTO conflict_count
  FROM procurements.sms_subject_schedules
  WHERE section_id = p_section_id
    AND school_year = p_school_year
    AND (p_id IS NULL OR id != p_id)
    AND public.days_overlap(days_of_week, p_days_of_week)
    AND public.times_overlap(start_time, end_time, p_start_time, p_end_time);
  
  IF conflict_count > 0 THEN
    RETURN QUERY SELECT 
      'section'::TEXT,
      'Section is already scheduled at this time on one or more selected days'::TEXT;
  END IF;

  -- No conflicts found
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- Trigger function to check conflicts before insert/update
CREATE OR REPLACE FUNCTION public.check_schedule_conflicts_trigger()
RETURNS TRIGGER AS $$
DECLARE
  conflict_record RECORD;
  conflict_messages TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Check for conflicts
  FOR conflict_record IN 
    SELECT * FROM public.check_schedule_conflicts(
      NEW.room_id,
      NEW.teacher_id,
      NEW.section_id,
      NEW.days_of_week,
      NEW.start_time,
      NEW.end_time,
      NEW.school_year,
      NEW.id
    )
  LOOP
    conflict_messages := array_append(conflict_messages, conflict_record.conflict_message);
  END LOOP;

  -- If conflicts found, raise exception
  IF array_length(conflict_messages, 1) > 0 THEN
    RAISE EXCEPTION 'Schedule conflict detected: %', array_to_string(conflict_messages, '; ');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
CREATE TRIGGER check_schedule_conflicts_before_insert_update
  BEFORE INSERT OR UPDATE ON procurements.sms_subject_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.check_schedule_conflicts_trigger();

-- ============================================================================
-- HELPER FUNCTIONS FOR QUERYING SCHEDULES
-- ============================================================================

-- Function to get room schedule for a specific day and school year
CREATE OR REPLACE FUNCTION public.get_room_schedule(
  p_room_id BIGINT,
  p_day INTEGER,
  p_school_year TEXT
) RETURNS TABLE(
  id BIGINT,
  subject_id BIGINT,
  section_id BIGINT,
  teacher_id BIGINT,
  start_time TIME,
  end_time TIME
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.subject_id,
    s.section_id,
    s.teacher_id,
    s.start_time,
    s.end_time
  FROM procurements.sms_subject_schedules s
  WHERE s.room_id = p_room_id
    AND s.school_year = p_school_year
    AND p_day = ANY(s.days_of_week)
  ORDER BY s.start_time;
END;
$$ LANGUAGE plpgsql;

-- Function to get teacher schedule for a specific day and school year
CREATE OR REPLACE FUNCTION public.get_teacher_schedule(
  p_teacher_id BIGINT,
  p_day INTEGER,
  p_school_year TEXT
) RETURNS TABLE(
  id BIGINT,
  subject_id BIGINT,
  section_id BIGINT,
  room_id BIGINT,
  start_time TIME,
  end_time TIME
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.subject_id,
    s.section_id,
    s.room_id,
    s.start_time,
    s.end_time
  FROM procurements.sms_subject_schedules s
  WHERE s.teacher_id = p_teacher_id
    AND s.school_year = p_school_year
    AND p_day = ANY(s.days_of_week)
  ORDER BY s.start_time;
END;
$$ LANGUAGE plpgsql;

-- Function to get section schedule for a specific day and school year
CREATE OR REPLACE FUNCTION public.get_section_schedule(
  p_section_id BIGINT,
  p_day INTEGER,
  p_school_year TEXT
) RETURNS TABLE(
  id BIGINT,
  subject_id BIGINT,
  teacher_id BIGINT,
  room_id BIGINT,
  start_time TIME,
  end_time TIME
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id,
    s.subject_id,
    s.teacher_id,
    s.room_id,
    s.start_time,
    s.end_time
  FROM procurements.sms_subject_schedules s
  WHERE s.section_id = p_section_id
    AND s.school_year = p_school_year
    AND p_day = ANY(s.days_of_week)
  ORDER BY s.start_time;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
ALTER TABLE procurements.sms_subject_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Subject schedules are viewable by authenticated users"
  ON procurements.sms_subject_schedules FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Subject schedules are insertable by admins"
  ON procurements.sms_subject_schedules FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Subject schedules are updatable by admins"
  ON procurements.sms_subject_schedules FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Subject schedules are deletable by admins"
  ON procurements.sms_subject_schedules FOR DELETE
  USING (auth.role() = 'authenticated');

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON TABLE procurements.sms_subject_schedules IS 'Subject schedules linking subjects, sections, teachers, rooms, and time slots';
COMMENT ON COLUMN procurements.sms_subject_schedules.days_of_week IS 'Array of day numbers: 0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday';

-- <<< END 004_subject_schedules.sql

-- ============================================================================
-- >>> BEGIN 005_grant_permissions.sql
-- ============================================================================

-- ============================================================================
-- GRANT PERMISSIONS FOR PUBLIC ACCESS
-- ============================================================================
-- This migration grants necessary permissions to anon and authenticated roles
-- for accessing tables in the procurements schema, especially for public forms
-- ============================================================================

-- Grant usage on the procurements schema
GRANT USAGE ON SCHEMA procurements TO anon, authenticated;

-- Grant permissions on sms_form137_requests table for public access
-- This allows anonymous users to insert Form 137 requests
GRANT SELECT, INSERT ON procurements.sms_form137_requests TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_form137_requests_id_seq TO anon, authenticated;

-- Grant permissions on sms_students table for LRN verification
-- Anonymous users need SELECT to verify LRN exists
GRANT SELECT ON procurements.sms_students TO anon, authenticated;

-- <<< END 005_grant_permissions.sql

-- ============================================================================
-- >>> BEGIN 006_add_student_enrollment_fields.sql
-- ============================================================================

-- ============================================================================
-- ADD GRADE_LEVEL AND ENROLLMENT_ID TO SMS_STUDENTS
-- ============================================================================
-- This migration adds grade_level and enrollment_id fields to sms_students table
-- to track the student's current grade level and active enrollment
-- ============================================================================

-- Set the schema to procurements
SET search_path TO procurements, public;

-- Add grade_level column to sms_students
ALTER TABLE procurements.sms_students
ADD COLUMN IF NOT EXISTS grade_level INTEGER CHECK (grade_level >= 1 AND grade_level <= 12);

-- Add enrollment_id column to sms_students
ALTER TABLE procurements.sms_students
ADD COLUMN IF NOT EXISTS enrollment_id BIGINT REFERENCES procurements.sms_enrollments(id) ON DELETE SET NULL;

-- Create indexes for the new fields
CREATE INDEX IF NOT EXISTS idx_students_grade_level ON procurements.sms_students(grade_level);
CREATE INDEX IF NOT EXISTS idx_students_enrollment ON procurements.sms_students(enrollment_id);

-- ============================================================================
-- COMMENTS FOR DOCUMENTATION
-- ============================================================================

COMMENT ON COLUMN procurements.sms_students.grade_level IS 'Current grade level of the student (1-12)';
COMMENT ON COLUMN procurements.sms_students.enrollment_id IS 'Reference to the current active enrollment record';

-- <<< END 006_add_student_enrollment_fields.sql

-- ============================================================================
-- >>> BEGIN 007_remove_deleted_at.sql
-- ============================================================================

-- ============================================================================
-- REMOVE DELETED_AT COLUMNS
-- ============================================================================
-- This migration removes soft delete (deleted_at) functionality from all tables.
-- Tables will use hard deletes instead.
-- ============================================================================

SET search_path TO procurements, public;

-- Drop indexes that reference deleted_at (must drop before removing column)
DROP INDEX IF EXISTS procurements.idx_subjects_active;
DROP INDEX IF EXISTS procurements.idx_sections_active;
DROP INDEX IF EXISTS procurements.idx_students_active;
DROP INDEX IF EXISTS procurements.idx_rooms_active;

-- Remove deleted_at column from sms_subjects
ALTER TABLE procurements.sms_subjects DROP COLUMN IF EXISTS deleted_at;

-- Remove deleted_at column from sms_sections
ALTER TABLE procurements.sms_sections DROP COLUMN IF EXISTS deleted_at;

-- Remove deleted_at column from sms_students
ALTER TABLE procurements.sms_students DROP COLUMN IF EXISTS deleted_at;

-- Remove deleted_at column from sms_rooms
ALTER TABLE procurements.sms_rooms DROP COLUMN IF EXISTS deleted_at;

-- Recreate indexes without deleted_at filter
CREATE INDEX IF NOT EXISTS idx_subjects_active ON procurements.sms_subjects(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sections_active ON procurements.sms_sections(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_students_active ON procurements.sms_students(enrollment_status) WHERE enrollment_status = 'enrolled';
CREATE INDEX IF NOT EXISTS idx_rooms_active ON procurements.sms_rooms(is_active) WHERE is_active = true;

-- <<< END 007_remove_deleted_at.sql

-- ============================================================================
-- >>> BEGIN 008_section_type.sql
-- ============================================================================

-- Add section_type column to sms_sections
-- section_type: 'heterogeneous' | 'homogeneous_fast_learner' | 'homogeneous_crack_section' | 'homogeneous_random'

-- Drop section_sub_type if it existed from a previous migration
ALTER TABLE procurements.sms_sections DROP COLUMN IF EXISTS section_sub_type;
ALTER TABLE procurements.sms_sections DROP CONSTRAINT IF EXISTS chk_section_sub_type_when_heterogeneous;

-- Add section_type if not exists
ALTER TABLE procurements.sms_sections ADD COLUMN IF NOT EXISTS section_type TEXT;

-- Normalize invalid section_type values (empty string or unknown values) to NULL
-- before adding the check constraint, so existing rows don't violate it
UPDATE procurements.sms_sections
SET section_type = NULL
WHERE section_type IS NOT NULL
  AND section_type NOT IN (
    'heterogeneous',
    'homogeneous_fast_learner',
    'homogeneous_crack_section',
    'homogeneous_random'
  );

-- Drop old check constraint (if migration 008 was run before) and add new one
ALTER TABLE procurements.sms_sections DROP CONSTRAINT IF EXISTS sms_sections_section_type_check;
ALTER TABLE procurements.sms_sections ADD CONSTRAINT sms_sections_section_type_check
CHECK (
  section_type IS NULL OR section_type IN (
    'heterogeneous',
    'homogeneous_fast_learner',
    'homogeneous_crack_section',
    'homogeneous_random'
  )
);

-- Add index for filtering by section type
CREATE INDEX IF NOT EXISTS idx_sections_section_type ON procurements.sms_sections(section_type);

COMMENT ON COLUMN procurements.sms_sections.section_type IS 'Section type: heterogeneous, homogeneous_fast_learner, homogeneous_crack_section, or homogeneous_random';

-- <<< END 008_section_type.sql

-- ============================================================================
-- >>> BEGIN 009_gpa_thresholds.sql
-- ============================================================================

-- ============================================================================
-- GPA THRESHOLDS TABLE
-- ============================================================================
-- School-wide GPA thresholds for section type suggestions during enrollment.
-- Single row (id=1) stores the config. All authenticated users can read;
-- authenticated users can update.
-- ============================================================================

CREATE TABLE IF NOT EXISTS procurements.sms_gpa_thresholds (
  id BIGSERIAL PRIMARY KEY,
  homogeneous_fast_learner_min NUMERIC(5,2) NOT NULL DEFAULT 90 CHECK (homogeneous_fast_learner_min >= 0 AND homogeneous_fast_learner_min <= 100),
  homogeneous_crack_section_max NUMERIC(5,2) NOT NULL DEFAULT 75 CHECK (homogeneous_crack_section_max >= 0 AND homogeneous_crack_section_max <= 100),
  heterogeneous_enabled BOOLEAN NOT NULL DEFAULT true,
  homogeneous_random_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default row if table is empty
INSERT INTO procurements.sms_gpa_thresholds (homogeneous_fast_learner_min, homogeneous_crack_section_max, heterogeneous_enabled, homogeneous_random_enabled)
SELECT 90, 75, true, true
WHERE NOT EXISTS (SELECT 1 FROM procurements.sms_gpa_thresholds LIMIT 1);

-- Updated_at trigger
CREATE TRIGGER update_sms_gpa_thresholds_updated_at
  BEFORE UPDATE ON procurements.sms_gpa_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS
ALTER TABLE procurements.sms_gpa_thresholds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "GPA thresholds are viewable by authenticated users"
  ON procurements.sms_gpa_thresholds FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "GPA thresholds are updatable by authenticated users"
  ON procurements.sms_gpa_thresholds FOR UPDATE
  USING (auth.role() = 'authenticated');

-- No INSERT/DELETE for regular users - admins could add if needed, but we only use row id=1
CREATE POLICY "GPA thresholds are insertable by authenticated users"
  ON procurements.sms_gpa_thresholds FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_gpa_thresholds IS 'School-wide GPA thresholds for section type suggestions during enrollment';

-- Grant permissions for authenticated users
GRANT SELECT, INSERT, UPDATE ON procurements.sms_gpa_thresholds TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_gpa_thresholds_id_seq TO authenticated;

-- <<< END 009_gpa_thresholds.sql

-- ============================================================================
-- >>> BEGIN 010_enrollment_unique_student_school_year.sql
-- ============================================================================

-- Prevent multiple enrollments of the same student in the same school year
-- Keeps only the most recent enrollment per (student_id, school_year) before applying constraint

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Delete duplicate enrollments, keeping the one with the highest id (most recent)
  FOR r IN (
    SELECT student_id, school_year, MAX(id) as keep_id
    FROM procurements.sms_enrollments
    GROUP BY student_id, school_year
    HAVING COUNT(*) > 1
  ) LOOP
    DELETE FROM procurements.sms_enrollments
    WHERE student_id = r.student_id
      AND school_year = r.school_year
      AND id != r.keep_id;
  END LOOP;
END $$;

ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT uq_enrollments_student_school_year UNIQUE (student_id, school_year);

-- <<< END 010_enrollment_unique_student_school_year.sql

-- ============================================================================
-- >>> BEGIN 011_division_admin_schema.sql
-- ============================================================================

-- ============================================================================
-- DIVISION ADMIN SCHEMA
-- ============================================================================
-- Adds division_admin user type and sms_schools table for DepEd division office.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- ADD division_admin TO sms_users TYPE
-- ============================================================================
ALTER TABLE procurements.sms_users DROP CONSTRAINT IF EXISTS sms_users_type_check;
ALTER TABLE procurements.sms_users ADD CONSTRAINT sms_users_type_check
  CHECK (type IN ('school_head', 'teacher', 'registrar', 'admin', 'super admin', 'division_admin'));

-- ============================================================================
-- SMS_SCHOOLS TABLE (DepEd basic school fields)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_schools (
  id BIGSERIAL PRIMARY KEY,
  division_id TEXT NOT NULL,
  school_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  school_type TEXT,
  address TEXT,
  district TEXT,
  region TEXT,
  municipality_city TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_schools_division_id ON procurements.sms_schools(division_id);
CREATE INDEX IF NOT EXISTS idx_sms_schools_school_id ON procurements.sms_schools(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_schools_is_active ON procurements.sms_schools(is_active) WHERE is_active = true;

CREATE TRIGGER update_sms_schools_updated_at
  BEFORE UPDATE ON procurements.sms_schools
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- RLS FOR sms_schools
-- ============================================================================
ALTER TABLE procurements.sms_schools ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Schools are viewable by authenticated users"
  ON procurements.sms_schools FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Schools are insertable by authenticated users"
  ON procurements.sms_schools FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Schools are updatable by authenticated users"
  ON procurements.sms_schools FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Schools are deletable by authenticated users"
  ON procurements.sms_schools FOR DELETE
  USING (auth.role() = 'authenticated');

-- Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_schools TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_schools_id_seq TO authenticated;

COMMENT ON TABLE procurements.sms_schools IS 'DepEd schools within a division';

-- <<< END 011_division_admin_schema.sql

-- ============================================================================
-- >>> BEGIN 012_remove_division_id_requirement.sql
-- ============================================================================

-- ============================================================================
-- REMOVE division_id REQUIREMENT
-- ============================================================================
-- Makes division_id optional - no longer used in the application
-- ============================================================================

SET search_path TO procurements, public;

-- sms_schools: division_id becomes nullable
ALTER TABLE procurements.sms_schools
  ALTER COLUMN division_id DROP NOT NULL;

-- Drop index if division_id is no longer used for filtering (optional - keep for legacy data)
-- CREATE INDEX is kept for any existing queries; can be dropped later if desired

-- <<< END 012_remove_division_id_requirement.sql

-- ============================================================================
-- >>> BEGIN 013_add_school_id_fk.sql
-- ============================================================================

-- ============================================================================
-- ADD school_id FK TO TABLES REFERENCING sms_schools
-- ============================================================================
-- Adds school_id foreign key to sms_schools(id) for multi-school support.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- sms_users: Add/convert school_id to FK (stores sms_schools.id)
-- ============================================================================
-- Handles both: (a) school_id TEXT exists - migrate to BIGINT FK
--              (b) school_id does not exist - add as new BIGINT FK column
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'procurements' AND table_name = 'sms_users' AND column_name = 'school_id'
  ) THEN
    -- school_id exists (TEXT): migrate via temp column
    ALTER TABLE procurements.sms_users ADD COLUMN IF NOT EXISTS school_id_new BIGINT;
    UPDATE procurements.sms_users u
    SET school_id_new = COALESCE(
      (SELECT s.id FROM procurements.sms_schools s WHERE s.id::text = u.school_id LIMIT 1),
      (SELECT s.id FROM procurements.sms_schools s WHERE s.school_id = u.school_id LIMIT 1)
    )
    WHERE u.school_id IS NOT NULL AND u.school_id != '';
    ALTER TABLE procurements.sms_users DROP COLUMN school_id;
    ALTER TABLE procurements.sms_users RENAME COLUMN school_id_new TO school_id;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'procurements' AND table_name = 'sms_users' AND column_name = 'school_id_new'
  ) THEN
    -- Partial migration: school_id dropped, school_id_new exists - just rename
    ALTER TABLE procurements.sms_users RENAME COLUMN school_id_new TO school_id;
  ELSE
    -- school_id does not exist: add as new column
    ALTER TABLE procurements.sms_users ADD COLUMN IF NOT EXISTS school_id BIGINT;
  END IF;
END $$;

ALTER TABLE procurements.sms_users DROP CONSTRAINT IF EXISTS fk_sms_users_school;
ALTER TABLE procurements.sms_users
  ADD CONSTRAINT fk_sms_users_school
  FOREIGN KEY (school_id) REFERENCES procurements.sms_schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_users_school_id ON procurements.sms_users(school_id);

-- ============================================================================
-- sms_subjects: Add school_id
-- ============================================================================
ALTER TABLE procurements.sms_subjects
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sms_subjects_school_id ON procurements.sms_subjects(school_id);

-- ============================================================================
-- sms_sections: Add school_id
-- ============================================================================
ALTER TABLE procurements.sms_sections
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sms_sections_school_id ON procurements.sms_sections(school_id);

-- ============================================================================
-- sms_students: Add school_id
-- ============================================================================
ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_students_school_id ON procurements.sms_students(school_id);

-- ============================================================================
-- sms_rooms: Add school_id
-- ============================================================================
ALTER TABLE procurements.sms_rooms
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

-- Drop unique on name to allow same room name across schools; add composite unique
ALTER TABLE procurements.sms_rooms DROP CONSTRAINT IF EXISTS sms_rooms_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_rooms_name_school
  ON procurements.sms_rooms(name, school_id)
  WHERE school_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_rooms_school_id ON procurements.sms_rooms(school_id);

-- ============================================================================
-- sms_gpa_thresholds: Add school_id (per-school thresholds)
-- ============================================================================
ALTER TABLE procurements.sms_gpa_thresholds
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sms_gpa_thresholds_school_id ON procurements.sms_gpa_thresholds(school_id);

-- Drop existing unique constraint if we had one; allow multiple rows per school
-- (migration 009 seeded one row; we may need to update that row's school_id later per school)

-- ============================================================================
-- sms_enrollments: Add school_id (denormalized for query performance)
-- ============================================================================
ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sms_enrollments_school_id ON procurements.sms_enrollments(school_id);

-- ============================================================================
-- sms_form137_requests: Add school_id
-- ============================================================================
ALTER TABLE procurements.sms_form137_requests
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_form137_requests_school_id ON procurements.sms_form137_requests(school_id);

-- ============================================================================
-- COMMENTS
-- ============================================================================
COMMENT ON COLUMN procurements.sms_users.school_id IS 'FK to sms_schools.id - school this user belongs to';
COMMENT ON COLUMN procurements.sms_subjects.school_id IS 'FK to sms_schools.id - school offering this subject';
COMMENT ON COLUMN procurements.sms_sections.school_id IS 'FK to sms_schools.id - school this section belongs to';
COMMENT ON COLUMN procurements.sms_students.school_id IS 'FK to sms_schools.id - current school of enrollment';
COMMENT ON COLUMN procurements.sms_rooms.school_id IS 'FK to sms_schools.id - school this room belongs to';
COMMENT ON COLUMN procurements.sms_gpa_thresholds.school_id IS 'FK to sms_schools.id - school-specific GPA thresholds';
COMMENT ON COLUMN procurements.sms_enrollments.school_id IS 'FK to sms_schools.id - school for this enrollment';
COMMENT ON COLUMN procurements.sms_form137_requests.school_id IS 'FK to sms_schools.id - school processing the request';

-- <<< END 013_add_school_id_fk.sql

-- ============================================================================
-- >>> BEGIN 014_schools_contact_fields.sql
-- ============================================================================

-- ============================================================================
-- ADD CONTACT FIELDS TO SMS_SCHOOLS
-- ============================================================================
-- Adds email, telephone_number, mobile_number, facebook_url columns
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_schools
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS telephone_number TEXT,
  ADD COLUMN IF NOT EXISTS mobile_number TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url TEXT;

-- <<< END 014_schools_contact_fields.sql

-- ============================================================================
-- >>> BEGIN 015_public_landing_read_access.sql
-- ============================================================================

-- ============================================================================
-- PUBLIC LANDING PAGE READ ACCESS
-- ============================================================================
-- Allows anonymous users to read schools for the public landing page.
-- Enrollment stats use a SECURITY DEFINER function to avoid exposing raw data.
-- ============================================================================

-- sms_schools: Allow anon to SELECT (for school list and learners page)
CREATE POLICY "Schools are viewable by anon for public landing"
  ON procurements.sms_schools FOR SELECT
  TO anon
  USING (is_active = true);

GRANT SELECT ON procurements.sms_schools TO anon;

-- sms_enrollments: Allow anon to SELECT (for learners aggregates, status=approved)
CREATE POLICY "Enrollments are viewable by anon for public landing"
  ON procurements.sms_enrollments FOR SELECT
  TO anon
  USING (status = 'approved');

GRANT SELECT ON procurements.sms_enrollments TO anon;

-- sms_students: Allow anon to SELECT only for joining with enrollments (gender)
CREATE POLICY "Students are viewable by anon for public landing"
  ON procurements.sms_students FOR SELECT
  TO anon
  USING (true);


-- <<< END 015_public_landing_read_access.sql

-- ============================================================================
-- >>> BEGIN 016_add_school_id_to_schedules.sql
-- ============================================================================

-- ============================================================================
-- ADD school_id TO sms_subject_schedules
-- ============================================================================
-- Adds school_id to schedules table for direct filtering by user's school.
-- ============================================================================

SET search_path TO procurements, public;

-- Add school_id column
ALTER TABLE procurements.sms_subject_schedules
  ADD COLUMN IF NOT EXISTS school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_sms_subject_schedules_school_id ON procurements.sms_subject_schedules(school_id);

-- Backfill existing schedules from subject's school_id
UPDATE procurements.sms_subject_schedules s
SET school_id = sub.school_id
FROM procurements.sms_subjects sub
WHERE s.subject_id = sub.id AND s.school_id IS NULL AND sub.school_id IS NOT NULL;

COMMENT ON COLUMN procurements.sms_subject_schedules.school_id IS 'FK to sms_schools.id - school this schedule belongs to';

-- <<< END 016_add_school_id_to_schedules.sql

-- ============================================================================
-- >>> BEGIN 017_add_kindergarten_grade_level.sql
-- ============================================================================

-- ============================================================================
-- ADD KINDERGARTEN (GRADE LEVEL 0) SUPPORT
-- ============================================================================
-- Extends grade_level from 1-12 to 0-12 (0 = Kindergarten)
-- ============================================================================

SET search_path TO procurements, public;

-- sms_subjects: Drop and recreate grade_level check
-- Use ::integer cast to support both integer and text columns (avoids "text >= integer" error)
ALTER TABLE procurements.sms_subjects
  DROP CONSTRAINT IF EXISTS sms_subjects_grade_level_check;
ALTER TABLE procurements.sms_subjects
  ADD CONSTRAINT sms_subjects_grade_level_check CHECK ((grade_level::integer) >= 0 AND (grade_level::integer) <= 12);

-- sms_sections: Drop and recreate grade_level check
ALTER TABLE procurements.sms_sections
  DROP CONSTRAINT IF EXISTS sms_sections_grade_level_check;
ALTER TABLE procurements.sms_sections
  ADD CONSTRAINT sms_sections_grade_level_check CHECK ((grade_level::integer) >= 0 AND (grade_level::integer) <= 12);

-- sms_enrollments: Drop and recreate grade_level check
ALTER TABLE procurements.sms_enrollments
  DROP CONSTRAINT IF EXISTS sms_enrollments_grade_level_check;
ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT sms_enrollments_grade_level_check CHECK ((grade_level::integer) >= 0 AND (grade_level::integer) <= 12);

-- sms_students: Drop and recreate grade_level check (from migration 006)
ALTER TABLE procurements.sms_students
  DROP CONSTRAINT IF EXISTS sms_students_grade_level_check;
ALTER TABLE procurements.sms_students
  ADD CONSTRAINT sms_students_grade_level_check CHECK ((grade_level::integer) >= 0 AND (grade_level::integer) <= 12);

COMMENT ON COLUMN procurements.sms_students.grade_level IS 'Current grade level (0 = Kindergarten, 1-12 = Grade 1-12)';

-- <<< END 017_add_kindergarten_grade_level.sql

-- ============================================================================
-- >>> BEGIN 018_schools_district_type_constraints.sql
-- ============================================================================

-- ============================================================================
-- ADD CHECK CONSTRAINTS FOR SMS_SCHOOLS DISTRICT AND SCHOOL_TYPE
-- ============================================================================
-- Ensures district and school_type accept only valid values from constants.
-- Both columns remain nullable (optional).
-- ============================================================================

SET search_path TO procurements, public;

-- school_type: elementary, junior_high, senior_high, complete_secondary, integrated
ALTER TABLE procurements.sms_schools
  DROP CONSTRAINT IF EXISTS sms_schools_school_type_check;

ALTER TABLE procurements.sms_schools
  ADD CONSTRAINT sms_schools_school_type_check
  CHECK (
    school_type IS NULL
    OR school_type IN (
      'elementary',
      'junior_high',
      'senior_high',
      'complete_secondary',
      'integrated'
    )
  );

-- district: values from SCHOOL_DISTRICTS constant
ALTER TABLE procurements.sms_schools
  DROP CONSTRAINT IF EXISTS sms_schools_district_check;

ALTER TABLE procurements.sms_schools
  ADD CONSTRAINT sms_schools_district_check
  CHECK (
    district IS NULL
    OR district IN (
      'North District',
      'South District',
      'East District',
      'West District',
      'Central District'
    )
  );

-- <<< END 018_schools_district_type_constraints.sql

-- ============================================================================
-- >>> BEGIN 019_sms_attendance.sql
-- ============================================================================

-- ============================================================================
-- SMS_ATTENDANCE TABLE
-- ============================================================================
-- Daily attendance records for SF2 (Learner's Daily Class Attendance).
-- One row per student per section per date.
-- ============================================================================

SET search_path TO procurements, public;

CREATE TABLE IF NOT EXISTS procurements.sms_attendance (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('present', 'absent', 'tardy')),
  recorded_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, section_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sms_attendance_section_date ON procurements.sms_attendance(section_id, date);
CREATE INDEX IF NOT EXISTS idx_sms_attendance_student_section_year ON procurements.sms_attendance(student_id, section_id, school_year);
CREATE INDEX IF NOT EXISTS idx_sms_attendance_school_date ON procurements.sms_attendance(school_id, date);

CREATE TRIGGER update_sms_attendance_updated_at
  BEFORE UPDATE ON procurements.sms_attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Attendance is viewable by authenticated users"
  ON procurements.sms_attendance FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Attendance is insertable by authenticated users"
  ON procurements.sms_attendance FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Attendance is updatable by authenticated users"
  ON procurements.sms_attendance FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Attendance is deletable by authenticated users"
  ON procurements.sms_attendance FOR DELETE
  USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_attendance TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_attendance_id_seq TO authenticated;

COMMENT ON TABLE procurements.sms_attendance IS 'Daily attendance records for SF2 (Learner''s Daily Class Attendance)';

-- <<< END 019_sms_attendance.sql

-- ============================================================================
-- >>> BEGIN 020_students_encoded_by.sql
-- ============================================================================

-- Add encoded_by column to sms_students
-- Tracks which user (teacher or staff) added the student record
ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS encoded_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sms_students_encoded_by ON procurements.sms_students(encoded_by);

COMMENT ON COLUMN procurements.sms_students.encoded_by IS 'User (sms_users.id) who added this student record - teachers can only edit/delete students they encoded';

-- <<< END 020_students_encoded_by.sql

-- ============================================================================
-- >>> BEGIN 021_sms_books_schema.sql
-- ============================================================================

-- ============================================================================
-- SMS_BOOKS AND SMS_BOOK_ISSUANCES TABLES
-- ============================================================================
-- Books catalog and issuance tracking for DepEd School Form 3 (SF3).
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- SMS_BOOKS TABLE (Book catalog)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_books (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  subject_area TEXT NOT NULL,
  grade_level INTEGER NOT NULL CHECK (grade_level >= 1 AND grade_level <= 12),
  isbn TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_books_school_id ON procurements.sms_books(school_id);
CREATE INDEX IF NOT EXISTS idx_sms_books_grade_level ON procurements.sms_books(grade_level);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_books_school_title_grade
  ON procurements.sms_books(school_id, title, grade_level)
  WHERE school_id IS NOT NULL;

CREATE TRIGGER update_sms_books_updated_at
  BEFORE UPDATE ON procurements.sms_books
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Books are viewable by authenticated users"
  ON procurements.sms_books FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Books are insertable by authenticated users"
  ON procurements.sms_books FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Books are updatable by authenticated users"
  ON procurements.sms_books FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Books are deletable by authenticated users"
  ON procurements.sms_books FOR DELETE
  USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_books TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_books_id_seq TO authenticated;

COMMENT ON TABLE procurements.sms_books IS 'Book catalog for DepEd SF3 - Books Issued and Returned';

-- ============================================================================
-- SMS_BOOK_ISSUANCES TABLE (Issue/return records)
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_book_issuances (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  book_id BIGINT NOT NULL REFERENCES procurements.sms_books(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_id BIGINT REFERENCES procurements.sms_schools(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  date_issued DATE NOT NULL,
  date_returned DATE,
  condition_on_return TEXT,
  return_code TEXT CHECK (return_code IN ('FM', 'TDO', 'NEG')),
  remarks TEXT,
  issued_by BIGINT REFERENCES procurements.sms_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, book_id, section_id, school_year)
);

CREATE INDEX IF NOT EXISTS idx_sms_book_issuances_student ON procurements.sms_book_issuances(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_book_issuances_book ON procurements.sms_book_issuances(book_id);
CREATE INDEX IF NOT EXISTS idx_sms_book_issuances_section ON procurements.sms_book_issuances(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_book_issuances_school_year ON procurements.sms_book_issuances(school_year);
CREATE INDEX IF NOT EXISTS idx_sms_book_issuances_school_id ON procurements.sms_book_issuances(school_id);

CREATE TRIGGER update_sms_book_issuances_updated_at
  BEFORE UPDATE ON procurements.sms_book_issuances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_book_issuances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Book issuances are viewable by authenticated users"
  ON procurements.sms_book_issuances FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Book issuances are insertable by authenticated users"
  ON procurements.sms_book_issuances FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Book issuances are updatable by authenticated users"
  ON procurements.sms_book_issuances FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Book issuances are deletable by authenticated users"
  ON procurements.sms_book_issuances FOR DELETE
  USING (auth.role() = 'authenticated');

GRANT SELECT, INSERT, UPDATE, DELETE ON procurements.sms_book_issuances TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE procurements.sms_book_issuances_id_seq TO authenticated;

COMMENT ON TABLE procurements.sms_book_issuances IS 'Book issuance and return records for DepEd SF3';
COMMENT ON COLUMN procurements.sms_book_issuances.return_code IS 'FM=Force Majeure, TDO=Transferred/Dropout, NEG=Negligence (for unreturned books)';

-- <<< END 021_sms_books_schema.sql

-- ============================================================================
-- >>> BEGIN 022_drop_sms_subject_assignments.sql
-- ============================================================================

-- ============================================================================
-- DROP sms_subject_assignments
-- ============================================================================
-- Subject assignments are now based on sms_subject_schedules.
-- This migration removes the deprecated sms_subject_assignments table.
-- ============================================================================

SET search_path TO procurements, public;

DROP TABLE IF EXISTS procurements.sms_subject_assignments CASCADE;

-- <<< END 022_drop_sms_subject_assignments.sql

-- ============================================================================
-- >>> BEGIN 023_sms_learner_health.sql
-- ============================================================================

-- ============================================================================
-- SMS_LEARNER_HEALTH TABLE
-- ============================================================================
-- Learner basic health and nutrition records for DepEd School Form 8 (SF8).
-- One record per learner per section per school year.
-- ============================================================================

SET search_path TO procurements, public;

-- ============================================================================
-- SMS_LEARNER_HEALTH TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS procurements.sms_learner_health (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES procurements.sms_students(id) ON DELETE CASCADE,
  section_id BIGINT NOT NULL REFERENCES procurements.sms_sections(id) ON DELETE CASCADE,
  school_year TEXT NOT NULL,
  height_cm NUMERIC(5,2),
  weight_kg NUMERIC(5,2),
  nutritional_status TEXT CHECK (nutritional_status IN ('underweight', 'normal', 'overweight', 'obese')),
  height_for_age TEXT CHECK (height_for_age IN ('severely_stunted', 'stunted', 'normal', 'tall')),
  remarks TEXT,
  measured_at DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(student_id, section_id, school_year)
);

CREATE INDEX IF NOT EXISTS idx_sms_learner_health_student ON procurements.sms_learner_health(student_id);
CREATE INDEX IF NOT EXISTS idx_sms_learner_health_section ON procurements.sms_learner_health(section_id);
CREATE INDEX IF NOT EXISTS idx_sms_learner_health_school_year ON procurements.sms_learner_health(school_year);

CREATE TRIGGER update_sms_learner_health_updated_at
  BEFORE UPDATE ON procurements.sms_learner_health
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE procurements.sms_learner_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Learner health is viewable by authenticated users"
  ON procurements.sms_learner_health FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Learner health is insertable by authenticated users"
  ON procurements.sms_learner_health FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Learner health is updatable by authenticated users"
  ON procurements.sms_learner_health FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE POLICY "Learner health is deletable by authenticated users"
  ON procurements.sms_learner_health FOR DELETE
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE procurements.sms_learner_health IS 'Learner basic health and nutrition records for DepEd SF8';

-- <<< END 023_sms_learner_health.sql

-- ============================================================================
-- >>> BEGIN 024_requests_request_type.sql
-- ============================================================================

-- ============================================================================
-- ADD request_type TO sms_form137_requests
-- ============================================================================
-- Enables unified handling of Form 137 and Diploma requests.
-- ============================================================================

SET search_path TO procurements, public;

-- Add request_type column (DEFAULT ensures existing rows get 'form137')
ALTER TABLE procurements.sms_form137_requests
  ADD COLUMN IF NOT EXISTS request_type TEXT DEFAULT 'form137';

-- Backfill any nulls (e.g. from partial migration)
UPDATE procurements.sms_form137_requests
SET request_type = 'form137'
WHERE request_type IS NULL OR request_type = '';

-- Enforce NOT NULL and check
ALTER TABLE procurements.sms_form137_requests
  ALTER COLUMN request_type SET NOT NULL,
  ALTER COLUMN request_type SET DEFAULT 'form137';
ALTER TABLE procurements.sms_form137_requests
  DROP CONSTRAINT IF EXISTS chk_sms_form137_requests_request_type;
ALTER TABLE procurements.sms_form137_requests
  ADD CONSTRAINT chk_sms_form137_requests_request_type
  CHECK (request_type IN ('form137', 'diploma'));

-- Index for filtering by request type
CREATE INDEX IF NOT EXISTS idx_form137_request_type
  ON procurements.sms_form137_requests(request_type);

COMMENT ON COLUMN procurements.sms_form137_requests.request_type IS 'Type of document requested: form137 or diploma';

-- <<< END 024_requests_request_type.sql

-- ============================================================================
-- >>> BEGIN 025_student_diploma.sql
-- ============================================================================

-- ============================================================================
-- ADD diploma_file_path TO sms_students
-- ============================================================================
-- Stores path to diploma file in Supabase Storage (e.g. {school_id}/{student_id}/diploma.pdf)
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS diploma_file_path TEXT;

COMMENT ON COLUMN procurements.sms_students.diploma_file_path IS 'Path to diploma file in Supabase Storage (PDF or image)';

-- <<< END 025_student_diploma.sql

-- ============================================================================
-- >>> BEGIN 026_storage_diplomas.sql
-- ============================================================================

-- ============================================================================
-- CREATE STORAGE BUCKET FOR DIPLOMAS
-- ============================================================================
-- Private bucket for student diploma files. Access via signed URLs.
-- ============================================================================

-- Create diplomas bucket (private - requires signed URL or auth to access)
INSERT INTO storage.buckets (id, name, public)
VALUES ('diplomas', 'diplomas', false)
ON CONFLICT (id) DO NOTHING;

-- RLS: Authenticated users (staff) can upload/read/update/delete
DROP POLICY IF EXISTS "Authenticated users can upload diplomas" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read diplomas" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can update diplomas" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can delete diplomas" ON storage.objects;

CREATE POLICY "Authenticated users can upload diplomas"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'diplomas');

CREATE POLICY "Authenticated users can read diplomas"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'diplomas');

CREATE POLICY "Authenticated users can update diplomas"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'diplomas');

CREATE POLICY "Authenticated users can delete diplomas"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'diplomas');

-- Public/anon need SELECT for signed URL access when student prints approved diploma
-- Signed URLs work with the service role, so we need to allow anon to read when
-- they have a valid signed URL - actually signed URLs bypass RLS when using
-- createSignedUrl. So we don't need anon policy for download.
-- The signed URL is generated server-side or with service role for approved requests.
-- When using client createSignedUrl with anon key, RLS applies. So we need either:
-- (a) Server action/API route that generates signed URL (uses service role)
-- (b) Allow anon SELECT for diplomas - too permissive
-- Best: Use a server action or API that creates signed URL with service role.
-- For client-side, if user is not authenticated (public page), we need another approach.
-- Plan says: "Fetch signed URL from supabase.storage... createSignedUrl"
-- With anon key, createSignedUrl still needs RLS to pass. For private bucket,
-- anon cannot create signed URLs. We need a server-side API/action.
-- For now, keep bucket private; we'll create a server action to generate signed URLs
-- that the public page can call - the action will verify the request is approved
-- before returning the URL. So no anon policy needed for storage.
-- Policies above are sufficient for admin uploads.

-- <<< END 026_storage_diplomas.sql

-- ============================================================================
-- >>> BEGIN 027_rename_sms_form137_to_sms_form_requests.sql
-- ============================================================================

-- Rename sms_form137_requests to sms_form_requests
ALTER TABLE procurements.sms_form137_requests RENAME TO sms_form_requests;

-- <<< END 027_rename_sms_form137_to_sms_form_requests.sql

-- ============================================================================
-- >>> BEGIN 028_enrollment_semester.sql
-- ============================================================================

-- Add semester support for Grade 11 and Grade 12 enrollments
-- Grades 0-10: semester is NULL (one enrollment per year)
-- Grades 11-12: semester is 1 or 2 (two enrollments per year)

-- 1. Add semester column (nullable)
ALTER TABLE procurements.sms_enrollments
  ADD COLUMN IF NOT EXISTS semester INTEGER;

-- 2. Backfill: existing Grade 11/12 rows get semester 1; Grades 0-10 get NULL
UPDATE procurements.sms_enrollments
SET semester = CASE
  WHEN grade_level BETWEEN 11 AND 12 THEN 1
  ELSE NULL
END
WHERE semester IS NULL;

-- 3. Add CHECK constraint: grade 11-12 must have semester 1 or 2; others must have NULL
ALTER TABLE procurements.sms_enrollments
  DROP CONSTRAINT IF EXISTS chk_enrollments_semester;
ALTER TABLE procurements.sms_enrollments
  ADD CONSTRAINT chk_enrollments_semester CHECK (
    (grade_level BETWEEN 11 AND 12 AND semester IN (1, 2))
    OR (grade_level NOT BETWEEN 11 AND 12 AND semester IS NULL)
  );

-- 4. Drop old unique constraint
ALTER TABLE procurements.sms_enrollments
  DROP CONSTRAINT IF EXISTS uq_enrollments_student_school_year;

-- 5. Add new unique constraint: (student_id, school_year, COALESCE(semester, 0))
-- Uses unique index since COALESCE is an expression
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollments_student_school_year_semester
  ON procurements.sms_enrollments (student_id, school_year, COALESCE(semester, 0));

-- 6. Index for filtering by semester
CREATE INDEX IF NOT EXISTS idx_enrollments_semester
  ON procurements.sms_enrollments(semester);

COMMENT ON COLUMN procurements.sms_enrollments.semester IS 'Semester (1 or 2) for Grade 11-12; NULL for Grades 0-10';

-- <<< END 028_enrollment_semester.sql

-- ============================================================================
-- >>> BEGIN 029_student_birth_certificate_good_moral.sql
-- ============================================================================

-- ============================================================================
-- ADD birth_certificate_file_path AND good_moral_file_path TO sms_students
-- ============================================================================
-- Paths to files in Supabase Storage (diplomas bucket): e.g. {school_id}/{student_id}/birth_certificate.pdf
-- ============================================================================

SET search_path TO procurements, public;

ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS birth_certificate_file_path TEXT;

ALTER TABLE procurements.sms_students
  ADD COLUMN IF NOT EXISTS good_moral_file_path TEXT;

COMMENT ON COLUMN procurements.sms_students.birth_certificate_file_path IS 'Path to birth certificate file in Supabase Storage (PDF or image)';
COMMENT ON COLUMN procurements.sms_students.good_moral_file_path IS 'Path to good moral certificate file in Supabase Storage (PDF or image)';

-- <<< END 029_student_birth_certificate_good_moral.sql

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

COMMIT;
