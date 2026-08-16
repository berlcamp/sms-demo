/**
 * Printable: "Classroom Enrollment and Size".
 * One row per section of the school year — grade level, the classroom's
 * dimension and capacity, the section name and its actual enrollees.
 */

import { getGradeLevelLabel } from "@/lib/constants";
import {
  buildReportDocument,
  esc,
  fetchReportSchool,
} from "@/lib/pdf/reportShell";
import { printHTMLContent } from "@/lib/pdf/utils";
import { ClassroomEnrollmentRow } from "@/lib/utils/classroomEnrollment";

export interface ClassroomEnrollmentPrintParams {
  schoolId: string | number;
  schoolYear: string;
  rows: ClassroomEnrollmentRow[];
  preparedBy: string;
  principalName: string | null;
  principalTitle: string | null;
}

function buildTable(rows: ClassroomEnrollmentRow[]): string {
  const body = rows
    .map(
      (r, i) => `<tr>
  <td class="ctr">${i + 1}</td>
  <td class="ctr">${esc(getGradeLevelLabel(r.gradeLevel))}</td>
  <td class="ctr">${esc(r.classroomSize)}</td>
  <td>${esc(r.sectionName)}</td>
  <td class="num">${r.enrollees}</td>
  <td class="num">${r.capacity ?? ""}</td>
  <td>${esc(r.remarks)}</td>
</tr>`,
    )
    .join("\n");

  const totalEnrollees = rows.reduce((sum, r) => sum + r.enrollees, 0);
  const totalCapacity = rows.reduce((sum, r) => sum + (r.capacity ?? 0), 0);

  return `<table class="report">
  <thead>
    <tr>
      <th style="width:4%">#</th>
      <th style="width:14%">Grade Level</th>
      <th style="width:16%">Classroom Size</th>
      <th style="width:24%">Section Name</th>
      <th style="width:11%">Enrollees</th>
      <th style="width:11%">Capacity</th>
      <th style="width:20%">Remarks</th>
    </tr>
  </thead>
  <tbody>
    ${body}
    <tr class="subtotal">
      <td colspan="4">TOTAL (${rows.length} section${rows.length === 1 ? "" : "s"})</td>
      <td class="num">${totalEnrollees}</td>
      <td class="num">${totalCapacity > 0 ? totalCapacity : ""}</td>
      <td></td>
    </tr>
  </tbody>
</table>`;
}

export async function generateClassroomEnrollmentPrint(
  params: ClassroomEnrollmentPrintParams,
): Promise<void> {
  const {
    schoolId,
    schoolYear,
    rows,
    preparedBy,
    principalName,
    principalTitle,
  } = params;

  const school = await fetchReportSchool(schoolId);

  const body =
    rows.length > 0
      ? buildTable(rows)
      : `<p class="empty">No sections found for SY ${esc(schoolYear)}.</p>`;

  printHTMLContent(
    buildReportDocument({
      school,
      title: "Classroom Enrollment and Size",
      subtitle: `School Year ${schoolYear}`,
      body,
      preparedBy,
      principalName,
      principalTitle,
    }),
  );
}
