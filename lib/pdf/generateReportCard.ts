import { ALS_SECTION_TYPE, isAlsSectionType } from "@/lib/constants";
import { printHTMLContent } from "@/lib/pdf/utils";
import { supabase } from "@/lib/supabase/client";
import {
  countSchoolDays,
  fetchSchoolCalendar,
  getSchoolDaysInMonth,
  SchoolCalendarDay,
  sessionWeight,
} from "@/lib/utils/schoolCalendar";
import { fetchSchoolSettings } from "@/lib/utils/schoolSettings";
import {
  buildCardSubjectRows,
  computeGeneralAverage,
  type CardSubjectRow,
  type MapehSourceRow,
} from "@/lib/utils/mapeh";
import {
  getGradingPeriods,
  getGradingPeriodType,
  type GradingPeriodOption,
} from "@/lib/utils/schoolYear";

export type CoreValueRating = "AO" | "SO" | "RO" | "NO" | "";

export interface CoreValuesData {
  makaDiyos1: [CoreValueRating, CoreValueRating, CoreValueRating, CoreValueRating];
  makaDiyos2: [CoreValueRating, CoreValueRating, CoreValueRating, CoreValueRating];
  makatao1: [CoreValueRating, CoreValueRating, CoreValueRating, CoreValueRating];
  makatao2: [CoreValueRating, CoreValueRating, CoreValueRating, CoreValueRating];
  makakalikasan1: [CoreValueRating, CoreValueRating, CoreValueRating, CoreValueRating];
  makabansa1: [CoreValueRating, CoreValueRating, CoreValueRating, CoreValueRating];
  makabansa2: [CoreValueRating, CoreValueRating, CoreValueRating, CoreValueRating];
}

/**
 * "matatag" is the 3-term MATATAG card (DepEd, SY 2026-2027 onward): one
 * folded sheet, two panels, and a Learning Areas table whose period columns
 * come from `getGradingPeriods()` rather than a hardcoded four quarters.
 * The other two designs are the legacy 4-quarter cards and are unchanged.
 */
export type ReportCardDesign = "3-fold" | "2-fold" | "matatag";

export interface ReportCardParams {
  schoolId: string;
  studentId: string;
  sectionId: string;
  schoolYear: string;
  coreValues?: CoreValuesData;
  design?: ReportCardDesign;
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

interface MonthAttendance {
  label: string;
  schoolDays: number;
  present: number;
  absent: number;
  tardy: number;
}

interface AttendanceRecord {
  date: string;
  am_present: boolean | null;
  pm_present: boolean | null;
}

/**
 * Attendance per month, on the same rules as the entry grid and SF2: the school
 * calendar supplies the number of class days, and a date with no saved row
 * counts as present for every session held (an adviser records absences only).
 *
 * Counting saved rows instead — as this did before the calendar existed — read
 * a fully-present learner as having attended nothing.
 */
function aggregateAttendance(
  records: AttendanceRecord[],
  calendar: SchoolCalendarDay[],
  schoolYear: string,
): MonthAttendance[] {
  const [startYear, endYear] = schoolYear.split("-").map(Number);
  const months = [
    { month: 6, year: startYear, label: "Jun" },
    { month: 7, year: startYear, label: "Jul" },
    { month: 8, year: startYear, label: "Aug" },
    { month: 9, year: startYear, label: "Sep" },
    { month: 10, year: startYear, label: "Oct" },
    { month: 11, year: startYear, label: "Nov" },
    { month: 12, year: startYear, label: "Dec" },
    { month: 1, year: endYear, label: "Jan" },
    { month: 2, year: endYear, label: "Feb" },
    { month: 3, year: endYear, label: "Mar" },
    { month: 4, year: endYear, label: "Apr" },
    { month: 5, year: endYear, label: "May" },
    { month: 6, year: endYear, label: "Jun" },
  ];

  const byDate = new Map(records.map((r) => [r.date, r]));

  return months.map(({ month, year, label }) => {
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const days = getSchoolDaysInMonth(yearMonth, calendar);

    let present = 0;
    let absent = 0;
    let tardy = 0;

    days.forEach((day) => {
      const weight = sessionWeight(day); // 1, or 0.5 for a half-day suspension
      const record = byDate.get(day.date);
      // Sessions the school never held cannot be attended or missed.
      const value = record
        ? (day.am && record.am_present ? 0.5 : 0) + (day.pm && record.pm_present ? 0.5 : 0)
        : weight;

      present += value;
      if (value === 0) {
        absent += weight;
      } else if (value < weight) {
        // Half a day attended is tardiness on the DepEd form, not absence.
        tardy += 1;
      }
    });

    return { label, schoolDays: countSchoolDays(days), present, absent, tardy };
  });
}

/** Whole numbers print bare; a half-day shows its .5. */
function fmtDays(value: number): string {
  if (!value) return "";
  return value % 1 === 0 ? String(value) : value.toFixed(1);
}

interface ReportCardData {
  school: { id: string; school_id: string; name: string; address: string; district: string; region: string };
  student: Record<string, string | number | null | undefined>;
  section: {
    id: string;
    name: string;
    grade_level: number;
    section_adviser_id: string;
    section_type?: string | null;
  };
  adviserName: string;
  principalName: string;
  principalTitle: string;
  subjectRows: MapehSourceRow[];
  /**
   * The full learning-area roster of the section's grade level, used by the
   * MATATAG card. NULL for the two legacy designs, which keep printing only
   * the subjects a grade has actually been encoded for.
   */
  rosterSubjectRows: MapehSourceRow[] | null;
  monthlyAttendance: MonthAttendance[];
  studentName: string;
  gradeLabel: string;
  genderLabel: string;
  schoolYear: string;
}

/**
 * The learning areas printed on the MATATAG card.
 *
 * Every other card in this file derives its subject list from `sms_grades`,
 * which means a learning area shows up only once somebody has encoded a grade
 * for it — a card printed after Term 1 would be missing whatever the section
 * had not got to yet, and the printed set would differ learner by learner.
 * Here the list is the grade level's own roster: the active subjects the
 * school offers at `section.grade_level`, exactly as the section's Manage
 * Schedules picker resolves them (migration 136 pairs ALS subjects to ALS
 * sections and nowhere else), with whatever grades exist filled in.
 *
 * Selective subjects — MEP and ALS, which `is_madrasah` marks since migration
 * 133 derives it from `program` — are listed only for the learners actually
 * enrolled in them through `sms_student_subjects`. Otherwise every card at the
 * grade level would carry an Arabic Language row nobody in it takes.
 *
 * A subject the learner already has a grade for is always kept even when the
 * roster no longer lists it: retiring or re-levelling a subject mid-year must
 * not silently drop an encoded grade off a card.
 *
 * MAPEH needs no special handling here — the components come back as ordinary
 * roster rows and `buildCardSubjectRows` folds them into the computed parent
 * (migration 153), so tagging a fifth grade's Music subject is all a school
 * has to do for the MAPEH block to appear on that grade's cards.
 */
async function fetchGradeLevelSubjectRows(args: {
  schoolId: string;
  studentId: string;
  sectionId: string;
  schoolYear: string;
  gradeLevel: number;
  sectionType: string | null;
  graded: Map<string, MapehSourceRow>;
}): Promise<MapehSourceRow[]> {
  const { schoolId, studentId, sectionId, schoolYear, gradeLevel, sectionType, graded } = args;

  let query = supabase
    .from("sms_subjects")
    .select("id, code, name, is_madrasah, mapeh_component")
    .eq("grade_level", gradeLevel)
    .eq("is_active", true)
    .order("code", { ascending: true });
  query = isAlsSectionType(sectionType)
    ? query.eq("program", ALS_SECTION_TYPE)
    : query.neq("program", ALS_SECTION_TYPE);
  if (schoolId != null) query = query.eq("school_id", Number(schoolId));

  const { data: subjects, error } = await query;
  if (error) {
    // A failed roster read must not lose the grades that were encoded, so
    // fall back to the list the other designs print.
    console.error("Report card subject roster:", error);
    return Array.from(graded.values());
  }

  const roster = subjects || [];

  // Only fetch the selective enrolments when the roster actually holds one.
  let selectiveTaken = new Set<string>();
  if (roster.some((subject) => subject.is_madrasah)) {
    const { data: studentSubjects } = await supabase
      .from("sms_student_subjects")
      .select("subject_id")
      .eq("student_id", studentId)
      .eq("section_id", sectionId)
      .eq("school_year", schoolYear);
    selectiveTaken = new Set(
      (studentSubjects || []).map((row) => String(row.subject_id)),
    );
  }

  const rows: MapehSourceRow[] = [];
  const listed = new Set<string>();

  roster.forEach((subject) => {
    const id = String(subject.id);
    const encoded = graded.get(id);
    // A selective subject the learner is not enrolled in still prints when a
    // grade exists for it — the grade is the stronger evidence of enrolment.
    if (subject.is_madrasah && !selectiveTaken.has(id) && !encoded) return;
    listed.add(id);
    rows.push({
      name: subject.name || "\u2014",
      code: subject.code ?? null,
      is_madrasah: !!subject.is_madrasah,
      mapeh_component: subject.mapeh_component ?? null,
      q1: encoded?.q1 ?? null,
      q2: encoded?.q2 ?? null,
      q3: encoded?.q3 ?? null,
      q4: encoded?.q4 ?? null,
    });
  });

  graded.forEach((row, id) => {
    if (!listed.has(id)) rows.push(row);
  });

  return rows;
}

async function fetchReportCardData(params: ReportCardParams): Promise<ReportCardData> {
  const { schoolId, studentId, sectionId, schoolYear } = params;

  const { data: school, error: schoolError } = await supabase
    .from("sms_schools")
    .select("id, school_id, name, address, district, region")
    .eq("id", schoolId)
    .single();
  if (schoolError || !school) throw new Error("School not found");

  const { data: student, error: studentError } = await supabase
    .from("sms_students")
    .select("*")
    .eq("id", studentId)
    .single();
  if (studentError || !student) throw new Error("Student not found");

  const { data: section } = await supabase
    .from("sms_sections")
    .select("id, name, grade_level, section_adviser_id, section_type")
    .eq("id", sectionId)
    .single();
  if (!section) throw new Error("Section not found");

  let adviserName = "";
  if (section.section_adviser_id) {
    const { data: adviser } = await supabase
      .from("sms_users")
      .select("name")
      .eq("id", section.section_adviser_id)
      .single();
    adviserName = adviser?.name || "";
  }

  // Fetch principal from school settings
  const schoolSettings = await fetchSchoolSettings(schoolId);
  const principalName = schoolSettings.principal_name || "";
  const principalTitle = schoolSettings.principal_title || "Principal";

  const { data: grades } = await supabase
    .from("sms_grades")
    .select("subject_id, grading_period, grade")
    .eq("student_id", studentId)
    .eq("section_id", sectionId)
    .eq("school_year", schoolYear)
    .order("grading_period");

  const subjectIds = [...new Set((grades || []).map((g) => g.subject_id))];
  const subjectMap = new Map<
    string,
    { name: string; code: string | null; is_madrasah: boolean; mapeh_component: string | null }
  >();
  if (subjectIds.length > 0) {
    const { data: subjects } = await supabase
      .from("sms_subjects")
      .select("id, code, name, is_madrasah, mapeh_component")
      .in("id", subjectIds);
    (subjects || []).forEach((s) =>
      subjectMap.set(String(s.id), {
        name: s.name || "—",
        code: s.code ?? null,
        is_madrasah: !!s.is_madrasah,
        mapeh_component: s.mapeh_component ?? null,
      }),
    );
  }

  const subjectsMap = new Map<string, MapehSourceRow>();
  (grades || []).forEach((g) => {
    const subjId = String(g.subject_id);
    if (!subjectsMap.has(subjId)) {
      const info = subjectMap.get(subjId);
      subjectsMap.set(subjId, {
        name: info?.name || "—",
        code: info?.code ?? null,
        is_madrasah: info?.is_madrasah ?? false,
        mapeh_component: info?.mapeh_component ?? null,
        q1: null, q2: null, q3: null, q4: null,
      });
    }
    const row = subjectsMap.get(subjId)!;
    if (g.grading_period === 1) row.q1 = g.grade;
    if (g.grading_period === 2) row.q2 = g.grade;
    if (g.grading_period === 3) row.q3 = g.grade;
    if (g.grading_period === 4) row.q4 = g.grade;
  });

  // The MATATAG card lists every learning area the grade level offers, not
  // only the ones already carrying a grade, so a card printed at the end of
  // Term 1 still shows the full set with the later terms left blank. The
  // 3-fold and 2-fold designs keep their grades-derived list untouched.
  const rosterSubjectRows =
    params.design === "matatag"
      ? await fetchGradeLevelSubjectRows({
          schoolId,
          studentId,
          sectionId,
          schoolYear,
          gradeLevel: section.grade_level,
          sectionType: section.section_type ?? null,
          graded: subjectsMap,
        })
      : null;

  const { data: attendanceRecords } = await supabase
    .from("sms_attendance")
    .select("date, am_present, pm_present")
    .eq("student_id", studentId)
    .eq("section_id", sectionId)
    .eq("school_year", schoolYear);

  const calendar = await fetchSchoolCalendar(schoolId, schoolYear);
  const monthlyAttendance = aggregateAttendance(
    (attendanceRecords || []) as AttendanceRecord[],
    calendar,
    schoolYear,
  );

  const studentName =
    `${student.last_name}, ${student.first_name} ${student.middle_name || ""} ${student.suffix || ""}`.trim();
  const gradeLabel =
    section.grade_level === -1 ? "SNED" : section.grade_level === 0 ? "Kindergarten" : `Grade ${section.grade_level}`;
  const genderLabel =
    student.gender === "male" ? "Male" : student.gender === "female" ? "Female" : "N/A";

  return {
    school,
    student,
    section,
    adviserName,
    principalName,
    principalTitle,
    subjectRows: Array.from(subjectsMap.values()),
    rosterSubjectRows,
    monthlyAttendance,
    studentName,
    gradeLabel,
    genderLabel,
    schoolYear,
  };
}

function cv(coreValues: CoreValuesData | undefined, key: keyof CoreValuesData, quarter: number): string {
  if (!coreValues) return "";
  return coreValues[key][quarter] || "";
}

function buildAttendanceRows(monthlyAttendance: MonthAttendance[]): { html: string; totalPresent: number; totalAbsent: number; totalTardy: number } {
  let html = "";
  let totalSchoolDays = 0, totalPresent = 0, totalAbsent = 0, totalTardy = 0;
  monthlyAttendance.forEach((m) => {
    totalSchoolDays += m.schoolDays;
    totalPresent += m.present;
    totalAbsent += m.absent;
    totalTardy += m.tardy;
    html += `<tr>
      <td>${m.label}</td>
      <td class="tc">${fmtDays(m.schoolDays)}</td>
      <td class="tc">${fmtDays(m.present)}</td>
      <td class="tc">${fmtDays(m.absent)}</td>
      <td class="tc">${m.tardy || ""}</td>
    </tr>`;
  });
  html += `<tr class="total-row">
    <td><strong>Total</strong></td>
    <td class="tc"><strong>${fmtDays(totalSchoolDays)}</strong></td>
    <td class="tc"><strong>${fmtDays(totalPresent)}</strong></td>
    <td class="tc"><strong>${fmtDays(totalAbsent)}</strong></td>
    <td class="tc"><strong>${totalTardy || ""}</strong></td>
  </tr>`;
  return { html, totalPresent, totalAbsent, totalTardy };
}

function buildGradeRows(subjectRows: ReportCardData["subjectRows"]): { html: string; generalAverage: string; generalRemarks: string } {
  // Tagged MAPEH components are folded into one computed parent row that
  // counts once toward the general average, and the components print indented
  // beneath it (migration 153). With nothing tagged this is the flat list it
  // has always been, in code order.
  const rows = buildCardSubjectRows(subjectRows);

  let html = "";
  rows.forEach((row) => {
    const nameClass =
      row.kind === "header" ? "subj-header" : row.kind === "sub" ? "subj-indent" : "";
    html += `<tr>
      <td class="${nameClass}">${row.name}</td>
      <td class="tc">${row.q1 != null ? Math.round(row.q1) : ""}</td>
      <td class="tc">${row.q2 != null ? Math.round(row.q2) : ""}</td>
      <td class="tc">${row.q3 != null ? Math.round(row.q3) : ""}</td>
      <td class="tc">${row.q4 != null ? Math.round(row.q4) : ""}</td>
      <td class="tc">${row.final ?? ""}</td>
      <td class="tc">${row.remarks}</td>
    </tr>`;
  });

  const { average, remarks } = computeGeneralAverage(rows);
  const generalAverage = average != null ? String(average) : "";
  const generalRemarks = remarks;

  html += `<tr class="total-row">
    <td><strong>General Average</strong></td>
    <td class="tc" colspan="4"></td>
    <td class="tc"><strong>${generalAverage}</strong></td>
    <td class="tc"><strong>${generalRemarks}</strong></td>
  </tr>`;

  return { html, generalAverage, generalRemarks };
}

function generate3FoldHTML(data: ReportCardData, coreValues?: CoreValuesData): void {
  const { school, student, section, adviserName, principalName, principalTitle, subjectRows, monthlyAttendance, studentName, gradeLabel, genderLabel, schoolYear } = data;
  const { html: attendanceRows } = buildAttendanceRows(monthlyAttendance);
  const { html: gradeRows } = buildGradeRows(subjectRows);

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Report Card - ${studentName}</title>
  <style>
    @page {
      size: 13in 8.5in;
      margin: 0.25in;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Times New Roman", serif;
      font-size: 7.5pt;
      color: #000;
      background: #fff;
    }
    .page {
      width: 100%;
      height: 7.9in;
      display: flex;
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .panel {
      width: 33.33%;
      padding: 10px 12px;
      border-right: 1px dashed #ccc;
      overflow: hidden;
    }
    .panel:last-child { border-right: none; }
    .panel-title {
      font-size: 8.5pt;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      margin-bottom: 6px;
      border-bottom: 1px solid #000;
      padding-bottom: 3px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7pt;
    }
    th, td {
      border: 1px solid #000;
      padding: 2px 3px;
    }
    th {
      background-color: #e8e8e8;
      font-weight: bold;
      font-size: 6.5pt;
    }
    .tc { text-align: center; }
    .total-row { background-color: #f5f5f5; }
    .subj-header { font-weight: bold; background-color: #f0f0f0; }
    .subj-indent { padding-left: 14px; }
    .no-border { border: none; }
    .no-border td { border: none; padding: 1px 2px; }
    .card-header {
      text-align: center;
      margin-bottom: 6px;
    }
    .card-header img {
      width: 50px;
      height: 50px;
      object-fit: contain;
      vertical-align: middle;
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .header-text {
      font-size: 7pt;
      line-height: 1.3;
    }
    .header-text .school-name {
      font-size: 8pt;
      font-weight: bold;
      text-transform: uppercase;
    }
    .card-title {
      font-size: 9pt;
      font-weight: bold;
      text-transform: uppercase;
      margin: 6px 0 4px;
      letter-spacing: 0.5px;
    }
    .info-block {
      font-size: 7pt;
      margin-bottom: 6px;
    }
    .info-block table td {
      padding: 2px 4px;
      font-size: 7pt;
    }
    .info-label {
      font-weight: bold;
      white-space: nowrap;
    }
    .sig-line {
      border-bottom: 1px solid #000;
      width: 100%;
      display: inline-block;
      min-width: 140px;
    }
    .sig-section {
      margin-top: 4px;
      font-size: 7pt;
      line-height: 1.8;
    }
    .sig-section .quarter-line {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .transfer-section {
      margin-top: 6px;
      font-size: 6.5pt;
      border-top: 1px solid #000;
      padding-top: 4px;
    }
    .instructions ol {
      padding-left: 14px;
      font-size: 7pt;
      line-height: 1.5;
    }
    .instructions li {
      margin-bottom: 3px;
    }
    .observed-table th, .observed-table td {
      font-size: 6pt;
      padding: 1.5px 2px;
    }
    .core-value {
      font-weight: bold;
      background-color: #e8e8e8;
    }
    .behavior-stmt { font-size: 5.5pt; }
    .descriptors {
      margin-top: 6px;
      font-size: 6.5pt;
    }
    .descriptors table td {
      font-size: 6.5pt;
      padding: 1px 3px;
    }
    .name-panel {
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      padding-top: 20px;
    }
    .name-panel .student-name-display {
      font-size: 10pt;
      font-weight: bold;
      text-transform: uppercase;
    }
    .form-label {
      font-size: 6pt;
      color: #555;
      text-align: right;
      margin-bottom: 2px;
    }
    .purpose-text {
      font-size: 6.5pt;
      text-align: justify;
      margin: 4px 0;
      line-height: 1.4;
    }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>

<!-- ==================== PAGE 1: FRONT ==================== -->
<div class="page">

  <!-- LEFT PANEL: Attendance -->
  <div class="panel">
    <div class="form-label">School Form No. 9-A</div>
    <div class="panel-title">Report on Attendance</div>
    <table>
      <thead>
        <tr>
          <th>Month</th>
          <th class="tc" style="font-size:5.5pt;">No. of<br>School<br>Days</th>
          <th class="tc" style="font-size:5.5pt;">Days<br>Present</th>
          <th class="tc" style="font-size:5.5pt;">Days<br>Absent</th>
          <th class="tc" style="font-size:5.5pt;">Times<br>Tardy</th>
        </tr>
      </thead>
      <tbody>
        ${attendanceRows}
      </tbody>
    </table>
  </div>

  <!-- CENTER PANEL: Header + Student Info -->
  <div class="panel">
    <div class="card-header">
      <div class="header-top">
        <img src="/deped_logo_1.png" alt="DepEd" onerror="this.style.display='none'" />
        <div class="header-text">
          <div>Republic of the Philippines</div>
          <div class="school-name">Department of Education</div>
          <div>SCHOOLS DIVISION OF BAYUGAN CITY</div>
        </div>
        <img src="/deped_logo_2.png" alt="DepEd" onerror="this.style.display='none'" />
      </div>
      <div style="font-size:7.5pt;font-weight:bold;text-transform:uppercase;">${school.name}</div>
      <div style="font-size:6.5pt;">School ID: ${school.school_id || ""}</div>
      <div class="card-title">Learner's Progress Report Card</div>
      <div style="font-size:7.5pt;">School Year: ${schoolYear}</div>
    </div>

    <div class="info-block">
      <table class="no-border" style="width:100%;">
        <tr>
          <td class="info-label">Name:</td>
          <td>${studentName}</td>
          <td class="info-label" style="text-align:right;">Sex:</td>
          <td>${genderLabel}</td>
        </tr>
        <tr>
          <td class="info-label">Grade:</td>
          <td>${gradeLabel}</td>
          <td class="info-label" style="text-align:right;">Section:</td>
          <td>${section.name}</td>
        </tr>
        <tr>
          <td class="info-label">LRN:</td>
          <td>${student.lrn}</td>
          <td class="info-label" style="text-align:right;">DOB:</td>
          <td>${formatDate(student.date_of_birth as string | null)}</td>
        </tr>
      </table>
    </div>

    <div class="purpose-text">
      This report card shows the ability and progress your child has made in the
      different learning areas as well as his/her core values.
    </div>
    <div class="purpose-text" style="margin-bottom:6px;">
      The school welcomes your desire to know more details about your child's progress.
    </div>

    <div style="font-size:7pt;font-weight:bold;margin-bottom:3px;">PARENT'S/GUARDIAN'S SIGNATURE</div>
    <div class="sig-section">
      <div class="quarter-line"><span>1st Quarter</span> <span class="sig-line" style="min-width:100px;"></span></div>
      <div class="quarter-line"><span>2nd Quarter</span> <span class="sig-line" style="min-width:100px;"></span></div>
      <div class="quarter-line"><span>3rd Quarter</span> <span class="sig-line" style="min-width:100px;"></span></div>
      <div class="quarter-line"><span>4th Quarter</span> <span class="sig-line" style="min-width:100px;"></span></div>
    </div>

    <div style="margin-top:8px;font-size:7pt;">
      <div style="text-align:center;margin-bottom:2px;">
        <strong>${adviserName}</strong>
      </div>
      <div style="text-align:center;border-top:1px solid #000;padding-top:1px;font-size:6.5pt;">Teacher</div>
    </div>

    <div style="margin-top:6px;font-size:7pt;">
      <div style="text-align:center;margin-bottom:2px;">
        <strong>${principalName}</strong>
      </div>
      <div style="text-align:center;border-top:1px solid #000;padding-top:1px;font-size:6.5pt;">${principalTitle}</div>
    </div>

    <div class="transfer-section">
      <div style="font-weight:bold;margin-bottom:2px;">Certificate of Transfer</div>
      <div>Admitted to Grade: <span class="sig-line" style="min-width:40px;"></span></div>
      <div>Section: <span class="sig-line" style="min-width:80px;"></span></div>
      <div style="margin-top:3px;">Eligibility for Admission to Grade: <span class="sig-line" style="min-width:30px;"></span></div>
      <div style="margin-top:3px;">Approved:</div>
      <div style="margin-top:6px;">
        <span class="sig-line" style="min-width:140px;"></span>
      </div>
      <div style="font-size:6pt;text-align:center;">Teacher</div>
      <div style="margin-top:3px;">Approved:</div>
      <div style="margin-top:6px;">
        <span class="sig-line" style="min-width:140px;"></span>
      </div>
      <div style="font-size:6pt;text-align:center;">Principal</div>
      <div style="margin-top:4px;font-weight:bold;">Cancellation of Eligibility to Transfer</div>
      <div style="margin-top:2px;">Admitted to: <span class="sig-line" style="min-width:80px;"></span></div>
      <div>Date: <span class="sig-line" style="min-width:50px;"></span></div>
      <div style="margin-top:4px;text-align:right;">
        <span class="sig-line" style="min-width:120px;"></span>
      </div>
      <div style="font-size:6pt;text-align:right;">Principal</div>
    </div>
  </div>

  <!-- RIGHT PANEL: Instructions -->
  <div class="panel">
    <div class="panel-title">Instructions</div>
    <div class="instructions">
      <ol>
        <li>Select the sex / gender of the learner on the dropdown menu.</li>
        <li>Select the name of the learner from the list on the dropdown menu.</li>
      </ol>
      <div style="margin-top:8px;font-weight:bold;font-size:6.5pt;">Notes:</div>
      <ul style="padding-left:14px;font-size:6.5pt;line-height:1.5;">
        <li>The list of the learners on the dropdown menu will be based on the selected sex / gender.</li>
      </ul>
    </div>
  </div>

</div>

<!-- ==================== PAGE 2: BACK ==================== -->
<div class="page">

  <!-- LEFT PANEL: Grades -->
  <div class="panel">
    <div class="panel-title">Report on Learning Progress and Achievement</div>
    <table>
      <thead>
        <tr>
          <th>Learning Areas</th>
          <th class="tc">1</th>
          <th class="tc">2</th>
          <th class="tc">3</th>
          <th class="tc">4</th>
          <th class="tc" style="font-size:5.5pt;">Final<br>Grade</th>
          <th class="tc" style="font-size:5.5pt;">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${gradeRows || '<tr><td colspan="7" class="tc">No grades recorded</td></tr>'}
      </tbody>
    </table>

    <div class="descriptors">
      <table style="margin-top:8px;">
        <thead>
          <tr>
            <th>Descriptors</th>
            <th class="tc">Grading Scale</th>
            <th class="tc">Remarks</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Outstanding</td><td class="tc">90-100</td><td class="tc">Passed</td></tr>
          <tr><td>Very Satisfactory</td><td class="tc">85-89</td><td class="tc">Passed</td></tr>
          <tr><td>Satisfactory</td><td class="tc">80-84</td><td class="tc">Passed</td></tr>
          <tr><td>Fairly Satisfactory</td><td class="tc">75-79</td><td class="tc">Passed</td></tr>
          <tr><td>Did Not Meet Expectations</td><td class="tc">Below 75</td><td class="tc">Failed</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- CENTER PANEL: Observed Values -->
  <div class="panel">
    <div class="panel-title">Report on Learner's Observed Values</div>
    <table class="observed-table">
      <thead>
        <tr>
          <th style="width:18%;">Core Values</th>
          <th>Behavior Statements</th>
          <th class="tc" style="width:8%;">1</th>
          <th class="tc" style="width:8%;">2</th>
          <th class="tc" style="width:8%;">3</th>
          <th class="tc" style="width:8%;">4</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="core-value" rowspan="2">Maka-Diyos</td>
          <td class="behavior-stmt">Expresses one's spiritual beliefs while respecting the spiritual beliefs of others</td>
          <td class="tc">${cv(coreValues, "makaDiyos1", 0)}</td><td class="tc">${cv(coreValues, "makaDiyos1", 1)}</td><td class="tc">${cv(coreValues, "makaDiyos1", 2)}</td><td class="tc">${cv(coreValues, "makaDiyos1", 3)}</td>
        </tr>
        <tr>
          <td class="behavior-stmt">Shows adherence to ethical principles by upholding truth in all undertaking</td>
          <td class="tc">${cv(coreValues, "makaDiyos2", 0)}</td><td class="tc">${cv(coreValues, "makaDiyos2", 1)}</td><td class="tc">${cv(coreValues, "makaDiyos2", 2)}</td><td class="tc">${cv(coreValues, "makaDiyos2", 3)}</td>
        </tr>
        <tr>
          <td class="core-value" rowspan="2">Makatao</td>
          <td class="behavior-stmt">Is sensitive to individual, social and cultural differences and understanding, respecting diverse people</td>
          <td class="tc">${cv(coreValues, "makatao1", 0)}</td><td class="tc">${cv(coreValues, "makatao1", 1)}</td><td class="tc">${cv(coreValues, "makatao1", 2)}</td><td class="tc">${cv(coreValues, "makatao1", 3)}</td>
        </tr>
        <tr>
          <td class="behavior-stmt">Demonstrates contributions toward solidarity</td>
          <td class="tc">${cv(coreValues, "makatao2", 0)}</td><td class="tc">${cv(coreValues, "makatao2", 1)}</td><td class="tc">${cv(coreValues, "makatao2", 2)}</td><td class="tc">${cv(coreValues, "makatao2", 3)}</td>
        </tr>
        <tr>
          <td class="core-value">Maka-kalikasan</td>
          <td class="behavior-stmt">Cares for the environment and utilizes resources wisely, judiciously, and economically</td>
          <td class="tc">${cv(coreValues, "makakalikasan1", 0)}</td><td class="tc">${cv(coreValues, "makakalikasan1", 1)}</td><td class="tc">${cv(coreValues, "makakalikasan1", 2)}</td><td class="tc">${cv(coreValues, "makakalikasan1", 3)}</td>
        </tr>
        <tr>
          <td class="core-value" rowspan="2">Makabansa</td>
          <td class="behavior-stmt">Demonstrates pride in being a Filipino, exercises the rights and responsibilities of a Filipino citizen</td>
          <td class="tc">${cv(coreValues, "makabansa1", 0)}</td><td class="tc">${cv(coreValues, "makabansa1", 1)}</td><td class="tc">${cv(coreValues, "makabansa1", 2)}</td><td class="tc">${cv(coreValues, "makabansa1", 3)}</td>
        </tr>
        <tr>
          <td class="behavior-stmt">Demonstrates appropriate behavior in carrying out activities in the school, community and country</td>
          <td class="tc">${cv(coreValues, "makabansa2", 0)}</td><td class="tc">${cv(coreValues, "makabansa2", 1)}</td><td class="tc">${cv(coreValues, "makabansa2", 2)}</td><td class="tc">${cv(coreValues, "makabansa2", 3)}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:8px;">
      <div style="font-weight:bold;font-size:6.5pt;margin-bottom:2px;">OBSERVED VALUES</div>
      <table style="font-size:6pt;">
        <thead>
          <tr>
            <th>Marking</th>
            <th>Non-Numeric Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr><td class="tc">AO</td><td>Always Observed</td></tr>
          <tr><td class="tc">SO</td><td>Sometimes Observed</td></tr>
          <tr><td class="tc">RO</td><td>Rarely Observed</td></tr>
          <tr><td class="tc">NO</td><td>Not Observed</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- RIGHT PANEL: Student Name & LRN -->
  <div class="panel name-panel">
    <div style="font-size:7pt;margin-bottom:4px;">Name: <strong class="student-name-display">${studentName}</strong></div>
    <div style="font-size:7pt;">LRN: <strong>${student.lrn}</strong></div>
  </div>

</div>

</body>
</html>`;

  printHTMLContent(htmlContent);
}

function generate2FoldHTML(data: ReportCardData, coreValues?: CoreValuesData): void {
  const { school, student, section, adviserName, principalName, principalTitle, subjectRows, monthlyAttendance, studentName, gradeLabel, genderLabel, schoolYear } = data;

  // Build attendance for 2-fold (June-Apr only, matching screenshot)
  const twoFoldMonths = monthlyAttendance.slice(0, 11); // Jun through Apr
  let attendanceRows2 = "";
  let totalSchoolDays = 0, totalPresent = 0, totalAbsent = 0, totalTardy = 0;
  twoFoldMonths.forEach((m) => {
    totalSchoolDays += m.schoolDays;
    totalPresent += m.present;
    totalAbsent += m.absent;
    totalTardy += m.tardy;
  });

  // 2-fold attendance: horizontal months as columns
  const monthHeaders = twoFoldMonths.map((m) => `<th class="tc" style="font-size:5.5pt;padding:1px;">${m.label}</th>`).join("");
  const schoolDaysRow = twoFoldMonths.map((m) => `<td class="tc">${fmtDays(m.schoolDays)}</td>`).join("");
  const presentRow = twoFoldMonths.map((m) => `<td class="tc">${fmtDays(m.present)}</td>`).join("");
  const absentRow = twoFoldMonths.map((m) => `<td class="tc">${fmtDays(m.absent)}</td>`).join("");

  attendanceRows2 = `
    <tr><td style="font-size:5.5pt;white-space:nowrap;">No. of school days</td>${schoolDaysRow}<td class="tc"><strong>${fmtDays(totalSchoolDays)}</strong></td></tr>
    <tr><td style="font-size:5.5pt;white-space:nowrap;">No. of days present</td>${presentRow}<td class="tc"><strong>${fmtDays(totalPresent)}</strong></td></tr>
    <tr><td style="font-size:5.5pt;white-space:nowrap;">No. of days absent</td>${absentRow}<td class="tc"><strong>${fmtDays(totalAbsent)}</strong></td></tr>
  `;

  // Build grade rows
  const { html: gradeRows } = buildGradeRows(subjectRows);

  // Calculate age
  let age = "";
  if (student.date_of_birth) {
    const dob = new Date(student.date_of_birth as string);
    const now = new Date();
    age = String(now.getFullYear() - dob.getFullYear() - (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0));
  }

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Report Card - ${studentName}</title>
  <style>
    @page {
      size: 13in 8.5in;
      margin: 0.25in;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Times New Roman", serif;
      font-size: 8pt;
      color: #000;
      background: #fff;
    }
    .page {
      width: 100%;
      height: 7.9in;
      display: flex;
      page-break-after: always;
    }
    .page:last-child { page-break-after: auto; }
    .panel {
      width: 50%;
      padding: 14px 18px;
      border-right: 1px dashed #ccc;
      overflow: hidden;
    }
    .panel:last-child { border-right: none; }
    .panel-title {
      font-size: 9pt;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      margin-bottom: 8px;
      border-bottom: 1px solid #000;
      padding-bottom: 3px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 7.5pt;
    }
    th, td {
      border: 1px solid #000;
      padding: 2px 3px;
    }
    th {
      background-color: #e8e8e8;
      font-weight: bold;
      font-size: 7pt;
    }
    .tc { text-align: center; }
    .total-row { background-color: #f5f5f5; }
    .subj-header { font-weight: bold; background-color: #f0f0f0; }
    .subj-indent { padding-left: 14px; }
    .no-border { border: none; }
    .no-border td { border: none; padding: 1px 3px; }
    .card-header {
      text-align: center;
      margin-bottom: 8px;
    }
    .card-header img {
      width: 50px;
      height: 50px;
      object-fit: contain;
      vertical-align: middle;
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 4px;
    }
    .header-text {
      font-size: 7pt;
      line-height: 1.3;
    }
    .header-text .school-name {
      font-size: 8pt;
      font-weight: bold;
      text-transform: uppercase;
    }
    .card-title {
      font-size: 10pt;
      font-weight: bold;
      text-transform: uppercase;
      margin: 8px 0 4px;
      letter-spacing: 0.5px;
    }
    .info-block {
      font-size: 8pt;
      margin-bottom: 8px;
    }
    .info-block table td {
      padding: 2px 4px;
      font-size: 8pt;
    }
    .info-label {
      font-weight: bold;
      white-space: nowrap;
    }
    .sig-line {
      border-bottom: 1px solid #000;
      display: inline-block;
      min-width: 160px;
    }
    .sig-section {
      margin-top: 6px;
      font-size: 8pt;
      line-height: 2;
    }
    .quarter-line {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .transfer-section {
      margin-top: 8px;
      font-size: 7pt;
      border-top: 1px solid #000;
      padding-top: 4px;
    }
    .purpose-text {
      font-size: 7.5pt;
      text-align: justify;
      margin: 6px 0;
      line-height: 1.5;
      font-style: italic;
    }
    .observed-table th, .observed-table td {
      font-size: 6.5pt;
      padding: 2px 3px;
    }
    .core-value {
      font-weight: bold;
      background-color: #e8e8e8;
    }
    .behavior-stmt { font-size: 6pt; }
    .descriptors {
      margin-top: 8px;
      font-size: 7pt;
    }
    .descriptors table td {
      font-size: 7pt;
      padding: 1px 4px;
    }
    .form-label {
      font-size: 6.5pt;
      color: #555;
      text-align: right;
      margin-bottom: 2px;
    }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>

<!-- ==================== PAGE 1: FRONT ==================== -->
<div class="page">

  <!-- LEFT PANEL: Attendance + Signatures -->
  <div class="panel">
    <div class="form-label">DepEd Form 138-E</div>
    <div class="panel-title">Report on Attendance</div>
    <table style="font-size:6.5pt;">
      <thead>
        <tr>
          <th></th>
          ${monthHeaders}
          <th class="tc" style="font-size:5.5pt;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${attendanceRows2}
      </tbody>
    </table>

    <div class="sig-section" style="margin-top:12px;">
      <div class="quarter-line"><span>1st QUARTER</span> <span class="sig-line"></span></div>
      <div class="quarter-line"><span>2nd QUARTER</span> <span class="sig-line"></span></div>
      <div class="quarter-line"><span>3rd QUARTER</span> <span class="sig-line"></span></div>
      <div class="quarter-line"><span>4th QUARTER</span> <span class="sig-line"></span></div>
    </div>

    <div class="transfer-section">
      <div style="font-weight:bold;margin-bottom:3px;text-align:center;">Certificate of Transfer</div>
      <div>Admitted to Grade: <span class="sig-line" style="min-width:60px;"></span> Section: <span class="sig-line" style="min-width:60px;"></span></div>
      <div style="margin-top:3px;">Eligibility for Admission to Grade: <span class="sig-line" style="min-width:40px;"></span></div>

      <div style="margin-top:8px;display:flex;justify-content:space-between;">
        <span>Approved:</span>
        <span>Teacher</span>
      </div>

      <div style="margin-top:8px;text-align:center;">
        <strong style="text-transform:uppercase;">${principalName}</strong>
        <div style="font-size:6.5pt;">${principalTitle}</div>
      </div>

      <div style="margin-top:8px;font-weight:bold;text-align:center;">Cancellation of Eligibility to Transfer</div>
      <div style="margin-top:3px;">Admitted in: <span class="sig-line" style="min-width:120px;"></span></div>
      <div>Date: <span class="sig-line" style="min-width:80px;"></span></div>
      <div style="margin-top:8px;text-align:right;">
        <strong style="text-transform:uppercase;">${principalName}</strong>
        <div style="font-size:6.5pt;">${principalTitle}</div>
      </div>
    </div>
  </div>

  <!-- RIGHT PANEL: Header + Student Info -->
  <div class="panel">
    <div class="card-header">
      <div class="header-top">
        <img src="/deped_logo_1.png" alt="DepEd" onerror="this.style.display='none'" />
        <div class="header-text">
          <div>Republic of the Philippines</div>
          <div class="school-name">Department of Education</div>
          <div>CARAGA Administrative Region</div>
          <div>Division of Bayugan City</div>
          <div>Bayugan East District</div>
        </div>
        <img src="/deped_logo_2.png" alt="DepEd" onerror="this.style.display='none'" />
      </div>
      <div style="font-size:9pt;font-weight:bold;text-transform:uppercase;">${school.name}</div>
      <div style="font-size:7pt;">${school.address || ""}</div>
      <div style="font-size:7pt;">School I.D.: ${school.school_id || ""}</div>
      <div class="card-title">Progress Report Card</div>
      <div style="font-size:8pt;font-weight:bold;">${gradeLabel.toUpperCase()} - ${section.name}</div>
      <div style="font-size:8pt;">SY: ${schoolYear}</div>
    </div>

    <div class="info-block">
      <table class="no-border" style="width:100%;">
        <tr>
          <td class="info-label">Name:</td>
          <td colspan="5" style="border-bottom:1px solid #000;">${studentName}</td>
        </tr>
        <tr>
          <td class="info-label">Age:</td>
          <td style="border-bottom:1px solid #000;">${age}</td>
          <td class="info-label" style="text-align:right;">Sex:</td>
          <td style="border-bottom:1px solid #000;">${genderLabel}</td>
          <td class="info-label" style="text-align:right;">LRN:</td>
          <td style="border-bottom:1px solid #000;">${student.lrn}</td>
        </tr>
      </table>
    </div>

    <div style="font-size:7.5pt;margin-top:4px;">
      <em>Dear Parent:</em>
    </div>
    <div class="purpose-text">
      This report card shows the ability and progress your child has made in the
      different learning areas as well as his/her core values.
      The school welcomes you should you desire to know more about your child's progress.
    </div>

    <div style="margin-top:14px;font-size:8pt;text-align:right;">
      <div style="display:inline-block;text-align:center;">
        <strong>${adviserName}</strong>
        <div style="font-size:7pt;border-top:1px solid #000;padding-top:1px;margin-top:2px;">Adviser</div>
      </div>
    </div>

    <div style="margin-top:10px;font-size:8pt;text-align:center;">
      <strong style="text-transform:uppercase;">${principalName}</strong>
      <div style="font-size:7pt;">${principalTitle}</div>
    </div>
  </div>

</div>

<!-- ==================== PAGE 2: BACK ==================== -->
<div class="page">

  <!-- LEFT PANEL: Grades -->
  <div class="panel">
    <div class="panel-title">Report on Learning Progress and Achievement</div>
    <table>
      <thead>
        <tr>
          <th>Learning Areas</th>
          <th class="tc" style="width:8%;">1</th>
          <th class="tc" style="width:8%;">2</th>
          <th class="tc" style="width:8%;">3</th>
          <th class="tc" style="width:8%;">4</th>
          <th class="tc" style="font-size:6.5pt;width:10%;">Final<br>Grade</th>
          <th class="tc" style="font-size:6.5pt;width:12%;">Remarks</th>
        </tr>
      </thead>
      <tbody>
        ${gradeRows || '<tr><td colspan="7" class="tc">No grades recorded</td></tr>'}
      </tbody>
    </table>

    <div class="descriptors">
      <table style="margin-top:10px;">
        <thead>
          <tr>
            <th>Description</th>
            <th class="tc">Grading Scale</th>
            <th class="tc">Remarks</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Outstanding</td><td class="tc">90-100</td><td class="tc">Passed</td></tr>
          <tr><td>Very Satisfactory</td><td class="tc">85-89</td><td class="tc">Passed</td></tr>
          <tr><td>Satisfactory</td><td class="tc">80-84</td><td class="tc">Passed</td></tr>
          <tr><td>Fairly Satisfactory</td><td class="tc">75-79</td><td class="tc">Passed</td></tr>
          <tr><td>Did Not Meet Expectations</td><td class="tc">Below 75</td><td class="tc">Failed</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- RIGHT PANEL: Observed Values -->
  <div class="panel">
    <div class="panel-title">Report on Learner's Observed Values</div>
    <table class="observed-table">
      <thead>
        <tr>
          <th style="width:16%;">Core Values</th>
          <th>Behavior Statements</th>
          <th class="tc" style="width:7%;">1</th>
          <th class="tc" style="width:7%;">2</th>
          <th class="tc" style="width:7%;">3</th>
          <th class="tc" style="width:7%;">4</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="core-value" rowspan="2">1. Maka-Diyos</td>
          <td class="behavior-stmt">Expresses one's spiritual beliefs while respecting the spiritual beliefs of others.</td>
          <td class="tc">${cv(coreValues, "makaDiyos1", 0)}</td><td class="tc">${cv(coreValues, "makaDiyos1", 1)}</td><td class="tc">${cv(coreValues, "makaDiyos1", 2)}</td><td class="tc">${cv(coreValues, "makaDiyos1", 3)}</td>
        </tr>
        <tr>
          <td class="behavior-stmt">Shows adherence to ethical principles by upholding truth</td>
          <td class="tc">${cv(coreValues, "makaDiyos2", 0)}</td><td class="tc">${cv(coreValues, "makaDiyos2", 1)}</td><td class="tc">${cv(coreValues, "makaDiyos2", 2)}</td><td class="tc">${cv(coreValues, "makaDiyos2", 3)}</td>
        </tr>
        <tr>
          <td class="core-value" rowspan="2">2. Makatao</td>
          <td class="behavior-stmt">Is sensitive to individual, social and cultural differences</td>
          <td class="tc">${cv(coreValues, "makatao1", 0)}</td><td class="tc">${cv(coreValues, "makatao1", 1)}</td><td class="tc">${cv(coreValues, "makatao1", 2)}</td><td class="tc">${cv(coreValues, "makatao1", 3)}</td>
        </tr>
        <tr>
          <td class="behavior-stmt">Demonstrates contributions toward solidarity</td>
          <td class="tc">${cv(coreValues, "makatao2", 0)}</td><td class="tc">${cv(coreValues, "makatao2", 1)}</td><td class="tc">${cv(coreValues, "makatao2", 2)}</td><td class="tc">${cv(coreValues, "makatao2", 3)}</td>
        </tr>
        <tr>
          <td class="core-value" rowspan="2">3. Maka-Kalikasan</td>
          <td class="behavior-stmt">Cares for the environment and utilizes resources wisely, judiciously, and economically</td>
          <td class="tc">${cv(coreValues, "makakalikasan1", 0)}</td><td class="tc">${cv(coreValues, "makakalikasan1", 1)}</td><td class="tc">${cv(coreValues, "makakalikasan1", 2)}</td><td class="tc">${cv(coreValues, "makakalikasan1", 3)}</td>
        </tr>
        <tr>
          <td class="behavior-stmt">&nbsp;</td>
          <td class="tc"></td><td class="tc"></td><td class="tc"></td><td class="tc"></td>
        </tr>
        <tr>
          <td class="core-value" rowspan="2">4. Maka-bansa</td>
          <td class="behavior-stmt">Demonstrates pride in being a Filipino; exercises the rights and responsibilities of a Filipino citizen</td>
          <td class="tc">${cv(coreValues, "makabansa1", 0)}</td><td class="tc">${cv(coreValues, "makabansa1", 1)}</td><td class="tc">${cv(coreValues, "makabansa1", 2)}</td><td class="tc">${cv(coreValues, "makabansa1", 3)}</td>
        </tr>
        <tr>
          <td class="behavior-stmt">Demonstrates appropriate behavior in carrying out activities in the school, community, and country</td>
          <td class="tc">${cv(coreValues, "makabansa2", 0)}</td><td class="tc">${cv(coreValues, "makabansa2", 1)}</td><td class="tc">${cv(coreValues, "makabansa2", 2)}</td><td class="tc">${cv(coreValues, "makabansa2", 3)}</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top:10px;">
      <table style="font-size:6.5pt;width:100%;">
        <thead>
          <tr>
            <th>Marking</th>
            <th>Non-numerical Rating</th>
          </tr>
        </thead>
        <tbody>
          <tr><td class="tc">AO</td><td>Always Observed</td></tr>
          <tr><td class="tc">SO</td><td>Sometimes Observed</td></tr>
          <tr><td class="tc">RO</td><td>Rarely Observed</td></tr>
          <tr><td class="tc">NO</td><td>Not Observed</td></tr>
        </tbody>
      </table>
    </div>
  </div>

</div>

</body>
</html>`;

  printHTMLContent(htmlContent);
}

export async function generateReportCardPrint(params: ReportCardParams): Promise<void> {
  const data = await fetchReportCardData(params);

  if (params.design === "matatag") {
    return generateMatatagHTML(data);
  }
  if (params.design === "2-fold") {
    return generate2FoldHTML(data, params.coreValues);
  }
  return generate3FoldHTML(data, params.coreValues);
}

// ============================================================================
// MATATAG CARD (3 terms) — DepEd "Learner's Performance Report"
// ============================================================================
// One folded sheet: the left panel carries the school header, the learner's
// details, the progress table and the performance descriptors; the right panel
// carries attendance, the adviser's per-term remarks, the parent's signature
// lines and the two transfer certificates.
//
// The period columns are NOT hardcoded to three. They come from
// `getGradingPeriods(schoolYear)`, the same helper the class record and grade
// entry read, so the card follows the school year rather than the other way
// round: a term-based year (SY 2026-2027 onward) prints three columns headed
// "Term", an older year prints four headed "Quarter". Everything downstream —
// the remarks boxes, the parent signature lines — is generated from the same
// list, so the three surfaces cannot disagree about how many periods there are.

/** Grade-table body for the MATATAG card, plus its general average. */
function buildMatatagGradeRows(
  sourceRows: MapehSourceRow[],
  periodCount: number,
): { html: string; average: string; remarks: string; rowCount: number } {
  // Drop anything encoded past the last period of this school year, so a
  // stray 4th-quarter row left over from a re-levelled section cannot creep
  // into a 3-term final grade.
  const trimmed: MapehSourceRow[] = sourceRows.map((row) => ({
    ...row,
    q3: periodCount >= 3 ? row.q3 : null,
    q4: periodCount >= 4 ? row.q4 : null,
  }));

  // Tagged MAPEH components fold into one computed parent row that counts once
  // toward the general average, with the components indented beneath it
  // (migration 153) — shared with SF9 so the two forms cannot drift.
  const rows: CardSubjectRow[] = buildCardSubjectRows(trimmed);

  const grade = (value: number | null): string =>
    value != null ? String(Math.round(value)) : "";

  let html = "";
  rows.forEach((row) => {
    const nameClass =
      row.kind === "header" ? "subj-header" : row.kind === "sub" ? "subj-indent" : "";
    const cells = [row.q1, row.q2, row.q3, row.q4]
      .slice(0, periodCount)
      .map((value) => `<td class="tc">${grade(value)}</td>`)
      .join("");
    html += `<tr>
      <td class="area ${nameClass}">${row.name}</td>
      ${cells}
      <td class="tc">${row.final ?? ""}</td>
      <td class="tc">${row.remarks}</td>
    </tr>`;
  });

  // The issued form keeps one empty line under the last learning area for an
  // area written in by hand; reproduce it.
  html += `<tr>
    <td class="area">&nbsp;</td>
    ${'<td class="tc"></td>'.repeat(periodCount)}
    <td class="tc"></td>
    <td class="tc"></td>
  </tr>`;

  const { average, remarks } = computeGeneralAverage(rows);
  return {
    html,
    average: average != null ? String(average) : "",
    remarks,
    rowCount: rows.length,
  };
}

function generateMatatagHTML(data: ReportCardData): void {
  const {
    school,
    student,
    section,
    adviserName,
    principalName,
    principalTitle,
    subjectRows,
    rosterSubjectRows,
    monthlyAttendance,
    studentName,
    genderLabel,
    schoolYear,
  } = data;

  const periods: GradingPeriodOption[] = getGradingPeriods(schoolYear);
  const periodCount = periods.length;
  const periodNoun = getGradingPeriodType(schoolYear) === "term" ? "Term" : "Quarter";

  const { html: gradeRows, average, remarks, rowCount } = buildMatatagGradeRows(
    rosterSubjectRows ?? subjectRows,
    periodCount,
  );

  // A junior-high roster with MAPEH broken out runs to 15+ learning areas,
  // which would push the descriptors off a panel that clips its overflow.
  // Tighten the table rather than lose a printed grade.
  const areasClass = rowCount > 11 ? "areas dense" : "areas";

  // The field is already labelled "Grade:", so print the level alone.
  const gradeValue =
    section.grade_level === -1
      ? "SNED"
      : section.grade_level === 0
        ? "Kindergarten"
        : String(section.grade_level);

  // Jun through Apr, as on the issued form.
  const months = monthlyAttendance.slice(0, 11);
  const totals = months.reduce(
    (acc, m) => ({
      schoolDays: acc.schoolDays + m.schoolDays,
      present: acc.present + m.present,
      absent: acc.absent + m.absent,
    }),
    { schoolDays: 0, present: 0, absent: 0 },
  );
  const monthHeaders = months.map((m) => `<th class="tc">${m.label}</th>`).join("");
  const classDayCells = months.map((m) => `<td class="tc">${fmtDays(m.schoolDays)}</td>`).join("");
  const presentCells = months.map((m) => `<td class="tc">${fmtDays(m.present)}</td>`).join("");
  const absentCells = months.map((m) => `<td class="tc">${fmtDays(m.absent)}</td>`).join("");

  // The issued form labels these "Term 1..3"; the noun follows the school year
  // so an older card reads "Quarter 1..4" rather than lying about the period.
  const remarkRows = periods
    .map((p) => `<tr><td class="remark-cell">${periodNoun} ${p.value}</td></tr>`)
    .join("");
  const parentSignatureLines = periods
    .map(
      (p) =>
        `<div class="sig-row"><span class="sig-label">${periodNoun} ${p.value}</span><span class="sig-line"></span></div>`,
    )
    .join("");

  // Age at printing, on the same rule the rest of the card uses.
  let age = "";
  if (student.date_of_birth) {
    const dob = new Date(student.date_of_birth as string);
    const now = new Date();
    age = String(
      now.getFullYear() -
        dob.getFullYear() -
        (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0),
    );
  }

  const regionLine = school.region || "Region ______";
  const districtLine = school.district ? `District of ${school.district}` : "District of ______";
  const addressLine = school.address || "Municipality, Province";

  const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Learner's Performance Report - ${studentName}</title>
  <style>
    @page { size: 13in 8.5in; margin: 0.25in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 8pt;
      color: #000;
      background: #fff;
    }
    .page { width: 100%; height: 7.9in; display: flex; }
    .panel { width: 50%; padding: 6px 14px; overflow: hidden; }
    .panel-left { border-right: 1px dashed #bbb; }

    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #000; padding: 2px 4px; }
    th { background-color: #d9edf7; font-weight: bold; text-align: center; }
    .tc { text-align: center; }
    .bold { font-weight: bold; }

    /* ---- school header ---- */
    .head { display: flex; align-items: flex-start; gap: 6px; }
    .head-logo { width: 62px; flex: 0 0 62px; text-align: center; }
    .head-logo img { width: 58px; height: 58px; object-fit: contain; }
    .head-text { flex: 1; text-align: center; line-height: 1.25; font-size: 9pt; }
    .head-text .republic { font-family: "Brush Script MT", "Segoe Script", cursive; font-size: 11pt; font-weight: bold; }
    .head-text .deped { font-size: 11pt; }
    .head-text .division { font-weight: bold; font-size: 10pt; }
    .head-text .school { font-weight: bold; font-size: 12pt; margin-top: 2px; text-transform: uppercase; }
    .school-seal { width: 62px; flex: 0 0 62px; text-align: center; margin-top: 4px; }
    .school-seal img { width: 58px; height: 58px; object-fit: contain; }
    .card-title { text-align: center; font-weight: bold; font-size: 12pt; margin-top: 4px; }
    .card-sy { text-align: center; font-weight: bold; font-size: 11pt; }

    /* ---- learner details ---- */
    .details { font-size: 9.5pt; margin-top: 6px; line-height: 1.9; }
    .fill { border-bottom: 1px solid #000; display: inline-block; padding: 0 4px; }

    .letter { font-size: 9.5pt; margin-top: 6px; line-height: 1.35; text-align: justify; }
    .letter p { text-indent: 28px; }

    .section-title { text-align: center; font-weight: bold; font-size: 10.5pt; margin: 6px 0 3px; }

    /* ---- learning areas ---- */
    .areas th, .areas td { font-size: 9pt; }
    .areas .area { font-weight: bold; }
    .areas .subj-header { background-color: #f0f0f0; }
    .areas .subj-indent { padding-left: 16px; font-weight: normal; }
    .areas .ga { text-align: right; font-weight: bold; font-style: italic; }
    .areas.dense th, .areas.dense td { font-size: 7.5pt; padding: 0px 4px; }

    /* ---- descriptors ---- */
    .descriptors { margin-top: 6px; font-size: 9pt; }
    .descriptors .heading { font-weight: bold; }
    .descriptors table, .descriptors th, .descriptors td { border: none; }
    .descriptors th { background: none; font-weight: bold; }
    .descriptors td { text-align: center; padding: 0 4px; }

    /* ---- right panel ---- */
    .block-title { text-align: center; font-weight: bold; font-size: 11pt; margin: 0 0 4px; }
    .attendance th, .attendance td { font-size: 8pt; }
    .attendance .row-label { text-align: center; font-weight: bold; width: 12%; }
    .remarks-table td { height: 0.62in; vertical-align: top; font-size: 10pt; }
    .remark-cell { font-size: 10pt; }

    .sig-row { display: flex; align-items: flex-end; justify-content: center; gap: 10px; font-size: 10.5pt; line-height: 2; }
    .sig-label { width: 60px; text-align: left; }
    .sig-line { border-bottom: 1px solid #000; width: 200px; }

    .transfer { margin-top: 10px; font-size: 8pt; font-weight: bold; }
    .transfer .body { font-weight: bold; line-height: 1.35; }
    .transfer .field { margin-top: 4px; }
    .rule { border-bottom: 1px solid #000; display: inline-block; }
    .signatories { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 10px; }
    .signatory { text-align: center; }
    .signatory .name { border-bottom: 1px solid #000; min-width: 1.9in; display: block; padding: 0 6px; }
    .signatory .role { font-size: 8pt; }

    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
<div class="page">

  <!-- ==================== LEFT PANEL ==================== -->
  <div class="panel panel-left">
    <div class="head">
      <div class="head-logo">
        <img src="/deped_logo_1.png" alt="DepEd" onerror="this.style.display='none'" />
      </div>
      <div class="head-text">
        <div class="republic">Republic of the Philippines</div>
        <div class="deped">Department of Education</div>
        <div>${regionLine}</div>
        <div class="division">SCHOOLS DIVISION OF BAYUGAN CITY</div>
        <div>${districtLine}</div>
        <div>${addressLine}</div>
        <div class="school">${school.name}</div>
      </div>
      <!-- The issued form leaves a circle here for the school's own seal; the
           system stores no school logo, so this carries the second DepEd logo,
           matching the right-hand slot of every other printable's header. -->
      <div class="school-seal">
        <img src="/deped_logo_2.png" alt="DepEd" onerror="this.style.display='none'" />
      </div>
    </div>

    <div class="card-title">LEARNER&rsquo;S PERFORMANCE REPORT</div>
    <div class="card-sy">S.Y ${schoolYear}</div>

    <div class="details">
      <div>
        Name: <span class="fill" style="min-width:3.1in;">${studentName}</span>
        Age: <span class="fill" style="min-width:0.4in;">${age}</span>
        Sex: <span class="fill" style="min-width:0.7in;">${genderLabel}</span>
      </div>
      <div>
        LRN: <span class="fill" style="min-width:2.4in;">${student.lrn ?? ""}</span>
        Grade: <span class="fill" style="min-width:0.9in;">${gradeValue}</span>
        Section: <span class="fill" style="min-width:1.1in;">${section.name}</span>
      </div>
    </div>

    <div class="letter">
      <div>Dear Parents,</div>
      <p>This Performance Report shows the ability and progress your child has made in the different learning areas as well as his/her core values.</p>
      <p>The school welcomes you should you desire to know more about your child&rsquo;s progress.</p>
    </div>

    <div class="section-title">LEARNER&rsquo;S PROGRESS AND ACHIEVEMENT</div>
    <table class="${areasClass}">
      <thead>
        <tr>
          <th rowspan="2" style="width:34%;">Learning Areas</th>
          <th colspan="${periodCount}">${periodNoun}</th>
          <th rowspan="2" style="width:13%;">Final<br>Grade</th>
          <th rowspan="2" style="width:16%;">Remarks</th>
        </tr>
        <tr>
          ${periods.map((p) => `<th>${p.value}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${gradeRows}
        <tr>
          <td class="ga" colspan="${periodCount + 1}">General Average</td>
          <td class="tc bold">${average}</td>
          <td class="tc bold">${remarks}</td>
        </tr>
      </tbody>
    </table>

    <div class="descriptors">
      <div class="heading">PERFORMANCE DESCRIPTORS</div>
      <table>
        <thead>
          <tr>
            <th style="width:34%;">GRADING SCALE</th>
            <th style="width:36%;">DESCRIPTION</th>
            <th style="width:30%;">REMARKS</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>90-100</td><td>Advancing</td><td>Passed</td></tr>
          <tr><td>80-89</td><td>Benchmarking</td><td>Passed</td></tr>
          <tr><td>75-84</td><td>Connecting</td><td>Passed</td></tr>
          <tr><td>65-74</td><td>Developing</td><td>Passed</td></tr>
          <tr><td>0-64</td><td>Emerging</td><td>Passed</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ==================== RIGHT PANEL ==================== -->
  <div class="panel">
    <div class="block-title">ATTENDANCE RECORD</div>
    <table class="attendance">
      <thead>
        <tr>
          <th class="row-label">Month</th>
          ${monthHeaders}
          <th class="tc">Total</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="row-label">No. of Class Days</td>
          ${classDayCells}
          <td class="tc bold">${fmtDays(totals.schoolDays)}</td>
        </tr>
        <tr>
          <td class="row-label">No. of Days Present</td>
          ${presentCells}
          <td class="tc bold">${fmtDays(totals.present)}</td>
        </tr>
        <tr>
          <td class="row-label">No. of Days Absent</td>
          ${absentCells}
          <td class="tc bold">${fmtDays(totals.absent)}</td>
        </tr>
      </tbody>
    </table>

    <div class="block-title" style="margin-top:12px;">TEACHER&rsquo;S COMMENTS / REMARKS</div>
    <table class="remarks-table">
      <tbody>
        ${remarkRows}
      </tbody>
    </table>

    <div class="block-title" style="margin-top:12px;">PARENT&rsquo;S / GUARDIAN&rsquo;S SIGNATURE</div>
    ${parentSignatureLines}

    <div class="transfer">
      <div class="block-title" style="font-size:9pt;margin-top:8px;">CERTIFICATE OF TRANSFER</div>
      <div class="body">This is to certify that the above-named learner has satisfactorily completed the requirements for the grade level indicated.</div>
      <div class="field">Admitted to Grade: <span class="rule" style="width:2.4in;"></span></div>
      <div class="field">Eligible for Admission to Grade: <span class="rule" style="width:1.7in;"></span></div>
      <div class="field">Approved:</div>
      <div class="signatories">
        <div class="signatory">
          <span class="name">${principalName}</span>
          <span class="role">${principalTitle || "School Head"}</span>
        </div>
        <div class="signatory">
          <span class="name">${adviserName}</span>
          <span class="role">Adviser</span>
        </div>
      </div>

      <div class="block-title" style="font-size:9pt;margin-top:12px;">CANCELLATION OF ELIGIBILITY TO TRANSFER</div>
      <div style="display:flex;justify-content:space-between;">
        <span>Admitted in: <span class="rule" style="width:1.5in;"></span></span>
        <span>Date: <span class="rule" style="width:1.4in;"></span></span>
      </div>
      <div class="signatories" style="justify-content:flex-start;">
        <div class="signatory">
          <span class="name">${principalName}</span>
          <span class="role">${principalTitle || "School Head"}</span>
        </div>
      </div>
    </div>
  </div>

</div>
</body>
</html>`;

  printHTMLContent(htmlContent);
}
