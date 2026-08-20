/**
 * Instructional Supervision printables — the two planning documents.
 *
 *   generateSupervisoryPlan      the School Head's term matrix
 *                                ("INSTRUCTIONAL SUPERVISORY PLAN of SCHOOL HEADS")
 *   generateSupervisoryPlanSlip  the per-teacher slip that carries one
 *                                observation's arrangements
 *
 * The matrix prints LANDSCAPE: it has nine columns and the source document is
 * unreadable at portrait width. It overrides @page from DEPED_BASE_STYLES for
 * that reason, so the override must come after the base styles in the cascade.
 */
import {
  CAREER_STAGES,
  indicatorLabels,
  parseFocusList,
  SUPERVISION_TYPE_LABELS,
  termLabel,
  termMonths,
  type CareerStage,
  type SupervisionType,
} from "@/lib/constants/supervision";
import {
  buildDepEdHeaderWithLogos,
  DEPED_BASE_STYLES,
  DEPED_HEADER_LOGOS_STYLES,
  printHTMLContent,
} from "@/lib/pdf/utils";
import { esc } from "@/lib/pdf/learnerRecordPrint";

export interface SupervisoryPlanRow {
  teachers: string;
  kra?: string | null;
  priority_strand?: string | null;
  objectives?: string | null;
  activities?: string | null;
  success_indicators?: string | null;
  means_of_verification?: string | null;
  time_frame?: string | null;
  accomplishment?: string | null;
  remarks?: string | null;
}

export interface SupervisoryPlanParams {
  schoolName?: string | null;
  schoolAddress?: string | null;
  schoolYear: string;
  /** One term per printed page; pass several to print the whole year. */
  terms: { term: number; rows: SupervisoryPlanRow[] }[];
  preparedByName?: string | null;
  preparedByPosition?: string | null;
}

export interface SupervisoryPlanSlipParams {
  schoolName?: string | null;
  schoolAddress?: string | null;
  schoolYear: string;
  teacherName: string;
  position?: string | null;
  careerStage: CareerStage;
  supervisionType: SupervisionType;
  term: number;
  classLabel?: string | null;
  preConference?: string | null;
  observation?: string | null;
  focusKra?: string | null;
  focusIndicator?: string | null;
  observers?: string[];
  preparedByName?: string | null;
  preparedByPosition?: string | null;
}

const PLAN_STYLES = `
.plan-head { text-align: center; margin-bottom: 10px; }
.plan-head .title { font-size: 13pt; font-weight: bold; text-transform: uppercase; }
.plan-head .sy { font-size: 11pt; font-weight: bold; }
.plan-head .term { font-size: 11pt; font-weight: bold; margin-top: 2px; }
table.plan { width: 100%; border-collapse: collapse; font-size: 8.5pt; table-layout: fixed; }
table.plan th, table.plan td {
  border: 1px solid #000;
  padding: 4px;
  vertical-align: top;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
table.plan th { background: #f0f0f0; text-align: center; font-weight: bold; font-size: 8.5pt; }
table.plan td { line-height: 1.25; }
table.plan .teachers { white-space: pre-line; }
.guide-row td { font-style: italic; font-size: 8pt; color: #333; }
.prepared { margin-top: 30px; font-size: 10.5pt; }
.prepared .by { margin-bottom: 26px; }
.prepared .name { font-weight: bold; text-transform: uppercase; text-align: center; width: 3.4in; }
.prepared .role { text-align: center; width: 3.4in; font-size: 10pt; }
.page-break { page-break-after: always; }
`;

const SLIP_STYLES = `
.slip-title {
  text-align: center;
  font-size: 13pt;
  font-weight: bold;
  text-transform: uppercase;
  margin: 16px 0 4px;
}
.slip-sy { text-align: center; font-size: 11pt; font-weight: bold; margin-bottom: 18px; }
table.slip { width: 100%; border-collapse: collapse; font-size: 11pt; }
table.slip th, table.slip td { border: 1px solid #000; padding: 8px 10px; vertical-align: top; }
table.slip th {
  width: 38%;
  text-align: left;
  font-weight: bold;
  background: #f0f0f0;
}
table.slip td { min-height: 22px; }
.attach { margin-top: 16px; font-size: 10.5pt; font-style: italic; }
.sign-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 48px; }
.sign-row .cell { flex: 1; text-align: center; }
.sign-row .name {
  border-top: 1px solid #000;
  padding-top: 3px;
  font-weight: bold;
  text-transform: uppercase;
  font-size: 10.5pt;
}
.sign-row .role { font-size: 10pt; }
`;

function header(schoolName?: string | null, schoolAddress?: string | null): string {
  return buildDepEdHeaderWithLogos(`
    <div style="font-size:11pt;">Republic of the Philippines</div>
    <div style="font-size:14pt;font-weight:bold;">Department of Education</div>
    ${schoolName ? `<div style="font-size:12pt;text-transform:uppercase;">${esc(schoolName)}</div>` : ""}
    ${schoolAddress ? `<div style="font-size:10pt;">${esc(schoolAddress)}</div>` : ""}
  `);
}

function preparedBlock(name?: string | null, position?: string | null): string {
  return `<div class="prepared">
  <div class="by">Prepared by:</div>
  <div class="name">${esc(name) || "&nbsp;"}</div>
  <div class="role">${esc(position) || "&nbsp;"}</div>
</div>`;
}

/**
 * The School Head's supervisory plan matrix — one page per term.
 *
 * The italic guide row under the headings is reproduced from the source
 * document: it is instructional text the School Head reads while filling the
 * form, and reviewers expect to see it on the filed copy.
 */
export function generateSupervisoryPlan(params: SupervisoryPlanParams): void {
  const pages = params.terms
    .map((termBlock, index) => {
      const rows =
        termBlock.rows.length > 0
          ? termBlock.rows
              .map(
                (row) => `<tr>
  <td class="teachers">${esc(row.teachers)}</td>
  <td>${esc([row.kra, row.priority_strand].filter(Boolean).join("\n\n"))}</td>
  <td>${esc(row.objectives)}</td>
  <td>${esc(row.activities)}</td>
  <td>${esc(row.success_indicators)}</td>
  <td>${esc(row.means_of_verification)}</td>
  <td>${esc(row.time_frame)}</td>
  <td>${esc(row.accomplishment)}</td>
  <td>${esc(row.remarks)}</td>
</tr>`,
              )
              .join("\n")
          : `<tr><td colspan="9" style="text-align:center;padding:24px;">&nbsp;</td></tr>`;

      return `<div class="${index < params.terms.length - 1 ? "page-break" : ""}">
${header(params.schoolName, params.schoolAddress)}
<div class="plan-head">
  <div class="title">Instructional Supervisory Plan of School Heads</div>
  <div class="sy">School Year ${esc(params.schoolYear)}</div>
  <div class="term">${esc(termLabel(termBlock.term))} - Instructional Supervision Plan (${esc(termMonths(termBlock.term))})</div>
</div>

<table class="plan">
  <colgroup>
    <col style="width:11%"><col style="width:12%"><col style="width:16%">
    <col style="width:10%"><col style="width:11%"><col style="width:11%">
    <col style="width:9%"><col style="width:10%"><col style="width:10%">
  </colgroup>
  <thead>
    <tr>
      <th>Name of Teachers / Learning Area / Level</th>
      <th>Key Result Areas (Priority Strand)</th>
      <th>Objectives</th>
      <th>Enabling Projects and/or Activities</th>
      <th>Success Indicators</th>
      <th>Means of Verification</th>
      <th>Time Frame</th>
      <th>Accomplishment / Status</th>
      <th>Remarks (STAR Approach)</th>
    </tr>
    <tr class="guide-row">
      <td>&nbsp;</td>
      <td>Teacher&rsquo;s KRA</td>
      <td>The objectives should be anchored on your role as School Head, emphasizing the specific support, guidance, and interventions you can provide to help teachers successfully implement and attain their priority strands and PPST indicators.</td>
      <td>&nbsp;</td>
      <td>Success indicators specify the expected number of teachers who should be able to effectively carry out, demonstrate, and achieve the competencies and expectations outlined in the identified priority strand.</td>
      <td>&nbsp;</td>
      <td>&nbsp;</td>
      <td>Shall be determined based on the attainment of the identified success indicators, taking into consideration how many of these indicators have been successfully accomplished.</td>
      <td>STAR Approach (Situation, Task, Action, and Result)</td>
    </tr>
  </thead>
  <tbody>
${rows}
  </tbody>
</table>

${preparedBlock(params.preparedByName, params.preparedByPosition)}
</div>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Instructional Supervisory Plan ${esc(params.schoolYear)}</title>
<style>
${DEPED_BASE_STYLES}
${DEPED_HEADER_LOGOS_STYLES}
${PLAN_STYLES}
/* Nine columns do not fit portrait — must follow DEPED_BASE_STYLES to win. */
@page { size: 13in 8.5in; margin: 0.4in 0.5in; }
</style>
</head>
<body>
${pages}
</body>
</html>`;

  printHTMLContent(html);
}

/**
 * The per-teacher supervisory plan slip — the arrangements for one observation,
 * signed by the teacher and the School Head before the observation happens.
 */
export function generateSupervisoryPlanSlip(
  params: SupervisoryPlanSlipParams,
): void {
  const stage = CAREER_STAGES[params.careerStage];
  // Both may hold several entries (stored pipe-delimited); each prints on its
  // own line so the slip reads the way the paper form is filled in.
  const kras = parseFocusList(params.focusKra);
  const indicators = indicatorLabels(params.focusIndicator);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Instructional Supervisory Plan - ${esc(params.teacherName)}</title>
<style>
${DEPED_BASE_STYLES}
${DEPED_HEADER_LOGOS_STYLES}
${SLIP_STYLES}
</style>
</head>
<body>
${header(params.schoolName, params.schoolAddress)}

<div class="slip-title">Instructional Supervisory Plan</div>
<div class="slip-sy">School Year ${esc(params.schoolYear)}</div>

<table class="slip">
  <tr><th>Name of Teacher</th><td>${esc(params.teacherName)}</td></tr>
  <tr><th>Position</th><td>${esc(params.position) || esc(stage.positionLabel)}</td></tr>
  <tr>
    <th>Type of Instructional Supervision<br><span style="font-weight:normal;">(Rated / Non-rated)</span></th>
    <td>${esc(SUPERVISION_TYPE_LABELS[params.supervisionType])}</td>
  </tr>
  <tr><th>Term<br><span style="font-weight:normal;">(1 / 2 / 3)</span></th><td>${esc(termLabel(params.term))} (${esc(termMonths(params.term))})</td></tr>
  <tr><th>Grade and Section of Class for Observation</th><td>${esc(params.classLabel) || "&nbsp;"}</td></tr>
  <tr><th>Date and Time of Pre-Conference</th><td>${esc(params.preConference) || "&nbsp;"}</td></tr>
  <tr><th>Date and Time of Actual Observation</th><td>${esc(params.observation) || "&nbsp;"}</td></tr>
  <tr><th>Focus KRA</th><td>${kras.map((k) => esc(k)).join("<br>") || "&nbsp;"}</td></tr>
  <tr><th>Focus Indicator</th><td>${indicators.map((i) => esc(i)).join("<br>") || "&nbsp;"}</td></tr>
  <tr><th>Observer/s</th><td>${esc((params.observers ?? []).join(", ")) || "&nbsp;"}</td></tr>
  <tr><th>COT Rating Scale</th><td>${stage.minRating} &ndash; ${stage.maxRating} (${esc(stage.formLabel)})</td></tr>
</table>

<div class="attach">Attach ILAW Lesson Plan.</div>

<div class="sign-row">
  <div class="cell">
    <div style="height:34px;"></div>
    <div class="name">${esc(params.teacherName)}</div>
    <div class="role">Teacher</div>
  </div>
  <div class="cell">
    <div style="height:34px;"></div>
    <div class="name">${esc(params.preparedByName) || "&nbsp;"}</div>
    <div class="role">${esc(params.preparedByPosition) || "School Head"}</div>
  </div>
</div>

</body>
</html>`;

  printHTMLContent(html);
}
