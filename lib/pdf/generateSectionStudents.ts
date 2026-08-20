import {
  buildDepEdHeaderWithLogos,
  DEPED_HEADER_LOGOS_STYLES,
  printHTMLContent,
} from "@/lib/pdf/utils";
import { supabase } from "@/lib/supabase/client";

export interface SectionStudentsPrintParams {
  schoolId: string | number;
  sectionId: string;
  sectionName: string;
  gradeLevel: number;
  schoolYear: string;
  adviserName: string;
}

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}

export async function generateSectionStudentsPrint(
  params: SectionStudentsPrintParams,
): Promise<void> {
  try {
    const {
      schoolId,
      sectionId,
      sectionName,
      gradeLevel,
      schoolYear,
      adviserName,
    } = params;

    // Fetch school
    const { data: school, error: schoolError } = await supabase
      .from("sms_schools")
      .select("id, school_id, name, address, district, region")
      .eq("id", schoolId)
      .single();

    if (schoolError || !school) {
      throw new Error("School not found");
    }

    // Fetch enrolled students
    const { data: enrollments } = await supabase
      .from("sms_enrollments")
      .select("student_id")
      .eq("section_id", sectionId)
      .eq("school_year", schoolYear)
      .eq("status", "approved");

    const studentIds = (enrollments || []).map((e) => e.student_id);
    let students: {
      id: string;
      lrn: string;
      first_name: string;
      middle_name: string | null;
      last_name: string;
      suffix: string | null;
      gender: string;
      date_of_birth: string;
    }[] = [];

    if (studentIds.length > 0) {
      const { data: studentList } = await supabase
        .from("sms_students")
        .select(
          "id, lrn, first_name, middle_name, last_name, suffix, gender, date_of_birth",
        )
        .in("id", studentIds)
        .order("last_name")
        .order("first_name");
      students = studentList || [];
    }

    const gradeLabel =
      gradeLevel === -1
        ? "SNED"
        : gradeLevel === 0
          ? "Kindergarten"
          : `Grade ${gradeLevel}`;

    // Split by sex, per the DepEd convention of listing males then females with
    // a count under each. A learner whose sex is unrecorded lands in neither
    // column, so they get their own trailing group rather than being dropped
    // silently or guessed into one of the two.
    const males = students.filter((s) => s.gender === "male");
    const females = students.filter((s) => s.gender === "female");
    const unspecified = students.filter(
      (s) => s.gender !== "male" && s.gender !== "female",
    );

    const escapeHtml = (value: string) =>
      value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const fullNameOf = (s: (typeof students)[number]) =>
      `${s.last_name}, ${s.first_name} ${s.middle_name || ""} ${s.suffix || ""}`
        .replace(/\s+/g, " ")
        .trim();

    // One table per sex. Numbering restarts at 1 in each group and the group's
    // own count closes it, so each list stands on its own when read on paper.
    const buildGroupTable = (
      label: string,
      group: typeof students,
    ): string => {
      const rows = group
        .map(
          (s, idx) => `<tr>
        <td class="text-center">${idx + 1}</td>
        <td>${escapeHtml(s.lrn || "")}</td>
        <td>${escapeHtml(fullNameOf(s))}</td>
        <td class="text-center">${formatDate(s.date_of_birth)}</td>
      </tr>`,
        )
        .join("");

      return `<table class="form-table">
    <thead>
      <tr>
        <th colspan="4" class="group-header">${label}</th>
      </tr>
      <tr>
        <th style="width:40px">No.</th>
        <th style="width:120px">LRN</th>
        <th>Name (Last, First, Middle)</th>
        <th style="width:100px" class="text-center">Date of Birth</th>
      </tr>
    </thead>
    <tbody>${
      rows ||
      `<tr><td colspan="4" class="text-center">No learners enrolled</td></tr>`
    }</tbody>
    <tfoot>
      <tr class="group-total">
        <td colspan="3" style="text-align:right">Total ${label}</td>
        <td class="text-center">${group.length}</td>
      </tr>
    </tfoot>
  </table>`;
    };

    const groupTables = [
      buildGroupTable("Male", males),
      buildGroupTable("Female", females),
      ...(unspecified.length > 0
        ? [buildGroupTable("Sex Not Indicated", unspecified)]
        : []),
    ].join("\n  ");

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Section Student List - ${sectionName}</title>
  <style>
    @page { size: 8.5in 13in; margin: 0.5in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Times New Roman", serif; font-size: 11pt; color: #000; background: #fff; }
    .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 8px; }
    .school-name { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
    .school-address { font-size: 10pt; margin-top: 4px; }
    .form-title { font-size: 12pt; font-weight: bold; margin-top: 10px; text-transform: uppercase; }
    .form-subtitle { font-size: 10pt; margin-top: 4px; }
    .section-info { font-size: 10pt; margin-bottom: 12px; line-height: 1.6; }
    .section-info strong { font-weight: bold; }
    .form-table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-bottom: 15px; }
    .form-table th, .form-table td { border: 1px solid #000; padding: 4px 6px; }
    .form-table th { background-color: #f0f0f0; font-weight: bold; }
    .group-header { text-align: left; text-transform: uppercase; letter-spacing: 0.5px; background-color: #e0e0e0; }
    .group-total td { font-weight: bold; background-color: #f0f0f0; }
    .text-center { text-align: center; }
    .total-row { font-weight: bold; margin-top: 8px; font-size: 10pt; }
    ${DEPED_HEADER_LOGOS_STYLES}
    @media print { body { print-color-adjust: exact; } .form-table { page-break-inside: auto; } tr { page-break-inside: avoid; } thead { display: table-header-group; } }
  </style>
</head>
<body>
  ${buildDepEdHeaderWithLogos(`
    <div>Republic of the Philippines</div>
    <div class="school-name">Department of Education</div>
    <div class="school-name" style="margin-top:6px">${school.name}</div>
    <div class="school-address">${school.address || ""} ${school.district ? `• ${school.district}` : ""} ${school.region ? `• ${school.region}` : ""}</div>
    <div class="form-title" style="margin-top:12px">Section Student List</div>
    <div class="form-subtitle">School Year ${schoolYear}</div>
  `)}
  <div class="section-info">
    <strong>Section:</strong> ${sectionName} &nbsp;&nbsp;
    <strong>Grade Level:</strong> ${gradeLabel} &nbsp;&nbsp;
    <strong>Adviser:</strong> ${adviserName || "N/A"}
  </div>
  ${groupTables}
  <div class="total-row">
    Total Male: ${males.length} &nbsp;&nbsp; Total Female: ${females.length}${
      unspecified.length > 0
        ? ` &nbsp;&nbsp; Sex Not Indicated: ${unspecified.length}`
        : ""
    } &nbsp;&nbsp; Grand Total: ${students.length} student(s)
  </div>
</body>
</html>`;

    printHTMLContent(htmlContent);
  } catch (error) {
    console.error("Error generating section student list:", error);
    throw error;
  }
}
