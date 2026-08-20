import { buildDepEdHeaderWithLogos, DEPED_HEADER_LOGOS_STYLES, printHTMLContent } from "@/lib/pdf/utils";
import { supabase } from "@/lib/supabase/client";
import {
  buildCardSubjectRows,
  computeGeneralAverage,
  type MapehSourceRow,
} from "@/lib/utils/mapeh";

export interface Sf9Params {
  schoolId: string;
  studentId: string;
  schoolYear: string;
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

export async function generateSf9Print(params: Sf9Params): Promise<void> {
  try {
    const { schoolId, studentId, schoolYear } = params;

    const { data: school, error: schoolError } = await supabase
      .from("sms_schools")
      .select("id, school_id, name, address, district, region")
      .eq("id", schoolId)
      .single();

    if (schoolError || !school) {
      throw new Error("School not found");
    }

    const { data: student, error: studentError } = await supabase
      .from("sms_students")
      .select("*")
      .eq("id", studentId)
      .single();

    if (studentError || !student) {
      throw new Error("Student not found");
    }

    const { data: enrollments } = await supabase
      .from("sms_enrollments")
      .select("section_id")
      .eq("student_id", studentId)
      .eq("school_year", schoolYear)
      .eq("status", "approved")
      .limit(1);

    const sectionId =
      enrollments && enrollments.length > 0
        ? enrollments[0].section_id
        : student.current_section_id;

    if (!sectionId) {
      throw new Error("Student is not enrolled in any section for this school year");
    }

    const { data: section } = await supabase
      .from("sms_sections")
      .select("id, name, grade_level, section_adviser_id")
      .eq("id", sectionId)
      .single();

    if (!section) {
      throw new Error("Section not found");
    }

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

    let adviserName = "";
    if (section.section_adviser_id) {
      const { data: adviser } = await supabase
        .from("sms_users")
        .select("name")
        .eq("id", section.section_adviser_id)
        .single();
      adviserName = adviser?.name || "";
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
          q1: null,
          q2: null,
          q3: null,
          q4: null,
        });
      }
      const row = subjectsMap.get(subjId)!;
      if (g.grading_period === 1) row.q1 = g.grade;
      if (g.grading_period === 2) row.q2 = g.grade;
      if (g.grading_period === 3) row.q3 = g.grade;
      if (g.grading_period === 4) row.q4 = g.grade;
    });

    // Tagged MAPEH components fold into one computed parent row counting once
    // toward the general average, with the components indented beneath it
    // (migration 153). Shared with the report card so the two forms cannot
    // disagree about the same learner's average.
    const cardRows = buildCardSubjectRows(Array.from(subjectsMap.values()));

    let rows = "";
    cardRows.forEach((row) => {
      const nameClass =
        row.kind === "header" ? "subj-header" : row.kind === "sub" ? "subj-indent" : "";
      rows += `<tr>
        <td class="${nameClass}">${row.name}</td>
        <td class="text-center">${row.q1 != null ? Math.round(row.q1) : ""}</td>
        <td class="text-center">${row.q2 != null ? Math.round(row.q2) : ""}</td>
        <td class="text-center">${row.q3 != null ? Math.round(row.q3) : ""}</td>
        <td class="text-center">${row.q4 != null ? Math.round(row.q4) : ""}</td>
        <td class="text-center">${row.final ?? ""}</td>
        <td class="text-center">${row.remarks}</td>
      </tr>`;
    });

    const { average, remarks: generalRemarks } = computeGeneralAverage(cardRows);
    const generalAverage = average != null ? String(average) : "";

    rows += `<tr class="general-row">
      <td><strong>General Average</strong></td>
      <td colspan="4"></td>
      <td class="text-center"><strong>${generalAverage}</strong></td>
      <td class="text-center"><strong>${generalRemarks}</strong></td>
    </tr>`;

    const studentName = `${student.last_name}, ${student.first_name} ${student.middle_name || ""} ${student.suffix || ""}`.trim();
    const gradeLabel =
      section.grade_level === -1 ? "SNED" : section.grade_level === 0 ? "Kindergarten" : `Grade ${section.grade_level}`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SF9 - Learner Progress Report Card - ${studentName}</title>
  <style>
    @page { size: 8.5in 13in; margin: 0.5in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; background: #fff; }
    .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 8px; }
    .school-name { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
    .school-address { font-size: 10pt; margin-top: 4px; }
    .form-title { font-size: 12pt; font-weight: bold; margin-top: 10px; text-transform: uppercase; }
    .form-subtitle { font-size: 10pt; margin-top: 4px; margin-bottom: 15px; }
    .student-info { margin-bottom: 15px; font-size: 10pt; }
    .student-info table { width: 100%; border-collapse: collapse; }
    .student-info td { padding: 4px 8px; border: 1px solid #000; }
    .info-label { font-weight: bold; width: 180px; background-color: #f0f0f0; }
    .form-table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    .form-table th, .form-table td { border: 1px solid #000; padding: 5px 8px; }
    .form-table th { background-color: #f0f0f0; font-weight: bold; }
    .general-row { background-color: #f8f8f8; }
    .text-center { text-align: center; }
    .subj-header { font-weight: bold; background-color: #f0f0f0; }
    .subj-indent { padding-left: 14px; }
    ${DEPED_HEADER_LOGOS_STYLES}
    @media print { body { print-color-adjust: exact; } }
  </style>
</head>
<body>
  ${buildDepEdHeaderWithLogos(`
    <div>Republic of the Philippines</div>
    <div class="school-name">Department of Education</div>
    <div class="school-name" style="margin-top:6px">${school.name}</div>
    <div class="school-address">${school.address || ""} ${school.district ? `• ${school.district}` : ""} ${school.region ? `• ${school.region}` : ""}</div>
    <div class="form-title" style="margin-top:12px">SF9 - Learner's Progress Report Card</div>
    <div class="form-subtitle">School Year ${schoolYear}</div>
  `)}
  <div class="student-info">
    <table>
      <tr>
        <td class="info-label">Learner Name:</td>
        <td>${studentName}</td>
        <td class="info-label">LRN:</td>
        <td>${student.lrn}</td>
      </tr>
      <tr>
        <td class="info-label">Grade Level & Section:</td>
        <td>${gradeLabel} - ${section.name}</td>
        <td class="info-label">Birthdate:</td>
        <td>${formatDate(student.date_of_birth)}</td>
      </tr>
      <tr>
        <td class="info-label">Adviser:</td>
        <td colspan="3">${adviserName}</td>
      </tr>
    </table>
  </div>
  <table class="form-table">
    <thead>
      <tr>
        <th>Learning Area</th>
        <th class="text-center">1st Quarter</th>
        <th class="text-center">2nd Quarter</th>
        <th class="text-center">3rd Quarter</th>
        <th class="text-center">4th Quarter</th>
        <th class="text-center">Final Grade</th>
        <th class="text-center">Remarks</th>
      </tr>
    </thead>
    <tbody>${rows || "<tr><td colspan='7' class='text-center'>No grades recorded</td></tr>"}</tbody>
  </table>
</body>
</html>`;

    printHTMLContent(htmlContent);
  } catch (error) {
    console.error("Error generating SF9:", error);
    throw error;
  }
}
