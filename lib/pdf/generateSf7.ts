import { buildDepEdHeaderWithLogos, DEPED_HEADER_LOGOS_STYLES, printHTMLContent } from "@/lib/pdf/utils";
import { supabase } from "@/lib/supabase/client";

export interface Sf7Params {
  schoolId: string;
  schoolYear: string;
}

export async function generateSf7Print(params: Sf7Params): Promise<void> {
  try {
    const { schoolId, schoolYear } = params;

    const { data: school, error: schoolError } = await supabase
      .from("sms_schools")
      .select("id, school_id, name, address, district, region")
      .eq("id", schoolId)
      .single();

    if (schoolError || !school) {
      throw new Error("School not found");
    }

    // SF7 reports the personnel of THIS school for THIS year, which is not the
    // same question as "who is posted here today". Two ways the two diverge:
    //
    //   - Someone who has since moved schools (their sms_users.school_id now
    //     names another) may still hold this year's classes, or have held last
    //     year's when an earlier SF7 is reprinted. Dropping them silently took
    //     their whole teaching load off the form.
    //   - A user assigned to two schools (migration 134) has schedules at both,
    //     and the load query below had no school filter — so this school's SF7
    //     counted the other school's classes as its own.
    //
    // So: staff posted here, plus anyone holding a schedule or an advisership
    // here this year; and the load itself is school-filtered.
    const { data: schedules } = await supabase
      .from("sms_subject_schedules")
      .select("teacher_id, subject_id, section_id")
      .eq("school_id", schoolId)
      .eq("school_year", schoolYear)
      .not("teacher_id", "is", null);

    // Advisers count as personnel of this school for this year on the same
    // grounds as subject teachers, and an advisership survives a transfer
    // (see /division/users), so it is asked for separately.
    const { data: adviserRows } = await supabase
      .from("sms_sections")
      .select("section_adviser_id")
      .eq("school_id", schoolId)
      .eq("school_year", schoolYear)
      .not("section_adviser_id", "is", null);

    const assignedIds = [
      ...new Set([
        ...(schedules || []).map((s) => String(s.teacher_id)),
        ...(adviserRows || []).map((s) => String(s.section_adviser_id)),
      ]),
    ];

    const { data: posted } = await supabase
      .from("sms_users")
      .select("id, name, email, type, position, employee_id")
      .eq("school_id", schoolId)
      .eq("is_active", true)
      .order("type")
      .order("name");

    const postedIds = new Set((posted || []).map((u) => String(u.id)));
    const missingIds = assignedIds.filter((id) => !postedIds.has(id));

    // Read by id, so a former colleague resolves whatever school they are at
    // now. Ordered with the current staff so the form reads as one list.
    const { data: formerStaff } = missingIds.length
      ? await supabase
          .from("sms_users")
          .select("id, name, email, type, position, employee_id")
          .in("id", missingIds)
          .order("type")
          .order("name")
      : { data: [] };

    const users = [...(posted || []), ...(formerStaff || [])];

    if (users.length === 0) {
      throw new Error("No personnel found for this school");
    }

    // Deduplicate: same teacher-subject-section can have multiple schedule slots
    const seen = new Set<string>();
    const assignments = (schedules || []).filter((s) => {
      const key = `${s.teacher_id}-${s.subject_id}-${s.section_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const subjectIds = [
      ...new Set((assignments || []).map((a) => a.subject_id).filter(Boolean)),
    ];
    const sectionIds = [
      ...new Set(
        (assignments || [])
          .map((a) => a.section_id)
          .filter((v): v is string => v != null),
      ),
    ];

    const subjectMap = new Map<string, string>();
    const sectionMap = new Map<string, string>();
    if (subjectIds.length > 0) {
      const { data: subjects } = await supabase
        .from("sms_subjects")
        .select("id, name")
        .in("id", subjectIds);
      (subjects || []).forEach((s) =>
        subjectMap.set(String(s.id), s.name || s.id),
      );
    }
    if (sectionIds.length > 0) {
      const { data: secs } = await supabase
        .from("sms_sections")
        .select("id, name, grade_level")
        .in("id", sectionIds);
      (secs || []).forEach((s) => {
        const gl = s.grade_level === -1 ? "SNED" : s.grade_level === 0 ? "K" : s.grade_level;
        sectionMap.set(String(s.id), `${gl}-${s.name}`);
      });
    }

    const { data: sections } = await supabase
      .from("sms_sections")
      .select("id, section_adviser_id, name, grade_level")
      .eq("school_id", schoolId)
      .eq("school_year", schoolYear);

    const adviserMap = new Map<string, string[]>();
    (sections || []).forEach((s) => {
      if (s.section_adviser_id) {
        const id = String(s.section_adviser_id);
        if (!adviserMap.has(id)) adviserMap.set(id, []);
        const gl = s.grade_level === -1 ? "SNED" : s.grade_level === 0 ? "K" : s.grade_level;
        adviserMap.get(id)!.push(`${gl}-${s.name}`);
      }
    });

    const assignmentMap = new Map<
      string,
      { subject: string; section: string }[]
    >();
    (assignments || []).forEach((a) => {
      const teacherId = String(a.teacher_id);
      if (!assignmentMap.has(teacherId)) assignmentMap.set(teacherId, []);
      const subj = subjectMap.get(String(a.subject_id)) || "—";
      const sec = a.section_id
        ? sectionMap.get(String(a.section_id)) || "—"
        : "—";
      assignmentMap.get(teacherId)!.push({ subject: subj, section: sec });
    });

    const typeLabels: Record<string, string> = {
      school_head: "School Head",
      assistant_school_head: "Assistant School Principal",
      teacher: "Teacher",
      registrar: "Registrar",
      admin: "Admin",
      "super admin": "Super Admin",
      division_admin: "Division Admin",
      division_type: "Division User",
    };

    let rows = "";
    users.forEach((u, idx) => {
      const typeLabel = typeLabels[u.type || ""] || u.type || "—";
      const advisory = adviserMap.get(String(u.id)) || [];
      const advisoryStr = advisory.length > 0 ? advisory.join(", ") : "—";
      const load = assignmentMap.get(String(u.id)) || [];
      const loadStr =
        load.length > 0
          ? load.map((l) => `${l.subject} (${l.section})`).join("; ")
          : "—";
      rows += `<tr>
        <td class="text-center">${idx + 1}</td>
        <td>${u.name || "—"}</td>
        <td>${u.employee_id || "—"}</td>
        <td>${typeLabel}</td>
        <td>${u.position || "—"}</td>
        <td>${advisoryStr}</td>
        <td>${loadStr}</td>
      </tr>`;
    });

    const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SF7 - School Personnel Assignment List and Basic Profile</title>
  <style>
    @page { size: 8.5in 13in; margin: 0.5in; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: "Times New Roman", serif; font-size: 10pt; color: #000; background: #fff; }
    .header { text-align: center; margin-bottom: 15px; border-bottom: 2px solid #000; padding-bottom: 8px; }
    .school-name { font-size: 14pt; font-weight: bold; text-transform: uppercase; }
    .school-address { font-size: 10pt; margin-top: 4px; }
    .form-title { font-size: 12pt; font-weight: bold; margin-top: 10px; text-transform: uppercase; }
    .form-subtitle { font-size: 10pt; margin-top: 4px; margin-bottom: 15px; }
    .form-table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    .form-table th, .form-table td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
    .form-table th { background-color: #f0f0f0; font-weight: bold; }
    .text-center { text-align: center; }
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
    <div class="form-title" style="margin-top:12px">SF7 - School Personnel Assignment List and Basic Profile</div>
    <div class="form-subtitle">School Year ${schoolYear}</div>
  `)}
  <table class="form-table">
    <thead>
      <tr>
        <th style="width:35px">No.</th>
        <th style="width:140px">Name</th>
        <th style="width:80px">Employee ID</th>
        <th style="width:90px">Position/Designation</th>
        <th style="width:80px">Position Title</th>
        <th style="width:120px">Advisory Class</th>
        <th>Teaching Load / Assignment</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    printHTMLContent(htmlContent);
  } catch (error) {
    console.error("Error generating SF7:", error);
    throw error;
  }
}
