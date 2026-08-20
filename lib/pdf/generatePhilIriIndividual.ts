import { supabase } from "@/lib/supabase/client";
import {
  comprehensionLevel,
  overallReadingLevel,
  philIriIndividualFormCode,
  philIriPhaseLabel,
  philIriQuestionCount,
  PHILIRI_MISCUE_TYPES,
  PHILIRI_SELF_CORRECTION,
  PHILIRI_QUESTION_TYPE_ABBR,
  wordReadingLevel,
} from "@/lib/constants";
import { PhilIriComprehensionAnswer, PhilIriMaterial, Student } from "@/types";
import {
  buildDepEdHeaderWithLogos,
  DEPED_BASE_STYLES,
  DEPED_HEADER_LOGOS_STYLES,
  printHTMLContent,
} from "./utils";

export interface PhilIriIndividualParams {
  schoolId: number | null;
  schoolName?: string;
  material: PhilIriMaterial;
  student: Student;
  sectionName: string;
  teacherName: string;
  phase: string;
  readingTimeSeconds: number | null;
  comprehensionRaw: number | null;
  /**
   * Questions this passage read was scored against. Omit for a form recorded
   * before migration 152, which falls back to the material's authored count.
   */
  comprehensionTotal?: number | null;
  comprehensionAnswers: Record<string, PhilIriComprehensionAnswer>;
  miscueCounts: Record<string, number | null>;
  dateAssessed: string | null;
  remarks: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export async function generatePhilIriIndividual(
  params: PhilIriIndividualParams,
): Promise<void> {
  const {
    schoolId,
    material,
    student,
    sectionName,
    teacherName,
    phase,
    readingTimeSeconds,
    comprehensionRaw,
    comprehensionAnswers,
    miscueCounts,
    dateAssessed,
    remarks,
  } = params;

  let schoolName = params.schoolName ?? "";
  if (!schoolName && schoolId) {
    const { data } = await supabase
      .from("sms_schools")
      .select("name")
      .eq("id", schoolId)
      .single();
    schoolName = data?.name ?? "";
  }

  const isFilipino = material.language === "Filipino";
  const selectionLabel = isFilipino ? "Seleksyon" : "Selection";
  const wc = Number(material.word_count);
  // The denominator the read was scored against, not a fixed 7: DepEd passages
  // carry different question counts per grade level and set (migration 152).
  const questionTotal =
    params.comprehensionTotal && params.comprehensionTotal > 0
      ? Math.trunc(params.comprehensionTotal)
      : philIriQuestionCount(material);

  // Self-corrections are tallied but are not miscues — excluded from the total.
  const miscueValues = Object.entries(miscueCounts)
    .filter(([k]) => k !== PHILIRI_SELF_CORRECTION.key)
    .map(([, v]) => v)
    .filter((v): v is number => typeof v === "number");
  const totalMiscues =
    miscueValues.length > 0 ? miscueValues.reduce((a, b) => a + b, 0) : null;
  const selfCorrections = miscueCounts[PHILIRI_SELF_CORRECTION.key];
  const wrScore =
    totalMiscues === null || wc <= 0
      ? null
      : round2(((wc - totalMiscues) / wc) * 100);
  const compScore =
    comprehensionRaw === null
      ? null
      : questionTotal > 0
        ? round2((comprehensionRaw / questionTotal) * 100)
        : null;
  const readingRate =
    readingTimeSeconds && readingTimeSeconds > 0 && wc > 0
      ? round2((wc * 60) / readingTimeSeconds)
      : null;
  const wrLevel = wrScore === null ? "" : wordReadingLevel(wrScore);
  const compLevel = compScore === null ? "" : comprehensionLevel(compScore);
  const overall =
    wrLevel && compLevel
      ? overallReadingLevel(
          wrLevel as ReturnType<typeof wordReadingLevel>,
          compLevel as ReturnType<typeof comprehensionLevel>,
        )
      : wrLevel || compLevel || "";

  const timeLabel =
    readingTimeSeconds === null
      ? ""
      : `${Math.floor(readingTimeSeconds / 60)}:${String(
          readingTimeSeconds % 60,
        ).padStart(2, "0")}`;

  const answersHtml = Array.from(
    { length: questionTotal },
    (_, i) => {
      const a = comprehensionAnswers[`q${i + 1}`];
      const mark = a?.correct === true ? "✓" : a?.correct === false ? "✗" : "";
      const type = a ? PHILIRI_QUESTION_TYPE_ABBR[a.type] : "";
      return `<div class="ans-item">${i + 1}. <span class="ans-val">${mark}</span>${
        type ? ` <span class="ans-type">(${type})</span>` : ""
      }</div>`;
    },
  ).join("");

  // Official Form 3A/3B lists the miscue types in English with a Filipino gloss.
  const miscueRows = PHILIRI_MISCUE_TYPES.map((mt, i) => {
    const v = miscueCounts[mt.key];
    return `<tr>
      <td class="c">${i + 1}</td>
      <td>${escapeHtml(mt.en)} <span class="muted">(${escapeHtml(mt.fil)})</span></td>
      <td class="c">${typeof v === "number" ? v : ""}</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
${DEPED_BASE_STYLES}
${DEPED_HEADER_LOGOS_STYLES}
.form-code { text-align:right; font-weight:bold; font-size:10pt; margin: 2px 0; }
.sub-title { text-align:center; font-weight:bold; font-size:12pt; margin: 2px 0 10px; }
.meta-line { display:flex; gap:20px; font-size:10pt; margin-bottom:10px; flex-wrap:wrap; }
.part { font-weight:bold; margin:12px 0 6px; }
.row { font-size:10.5pt; margin-bottom:6px; }
.row strong { display:inline-block; }
.answers { display:flex; flex-wrap:wrap; gap:14px; font-size:10.5pt; margin:6px 0; }
.ans-val { border-bottom:1px solid #000; padding:0 10px; font-weight:bold; }
.ans-type { color:#555; font-style:italic; font-size:9pt; }
table.mis { width:100%; border-collapse:collapse; margin-top:6px; }
table.mis th, table.mis td { border:1px solid #000; padding:4px 8px; font-size:10pt; }
table.mis th { background:#eee; }
td.c { text-align:center; }
.muted { color:#555; font-style:italic; }
</style></head><body>
${buildDepEdHeaderWithLogos(
  `<div class="school-name">${escapeHtml(schoolName || "Department of Education")}</div>
   <div class="form-title">Phil-IRI — Individual Record Form</div>`,
)}
<div class="form-code">${escapeHtml(philIriIndividualFormCode(material.language))}</div>
<div class="sub-title">${escapeHtml(material.title)} · ${escapeHtml(philIriPhaseLabel(phase))}</div>
<div class="meta-line">
  <div><strong>Learner:</strong> ${escapeHtml(`${student.last_name}, ${student.first_name}`)}</div>
  <div><strong>Section:</strong> ${escapeHtml(sectionName || "")}</div>
  <div><strong>Teacher:</strong> ${escapeHtml(teacherName || "")}</div>
  <div><strong>Date:</strong> ${escapeHtml(dateAssessed || "")}</div>
</div>

<div class="part">PART A</div>
<div class="row"><strong>Total Time in Reading the Text:</strong> ${escapeHtml(timeLabel)} &nbsp;&nbsp;
  <strong>Reading Rate:</strong> ${readingRate ?? ""} words per minute</div>
<div class="row"><strong>Responses to Questions: Score:</strong> ${
  comprehensionRaw === null ? "" : `${comprehensionRaw} / ${questionTotal}`
} &nbsp;
  <strong>%=</strong> ${compScore ?? ""} &nbsp;
  <strong>Comprehension Level:</strong> ${escapeHtml(compLevel)}</div>
<div class="answers">${answersHtml}</div>

<div class="part">PART B — Word Reading (Pagbasa)</div>
<div class="row"><strong>${selectionLabel}:</strong> ${escapeHtml(material.title)} &nbsp;&nbsp;
  <strong>Level:</strong> ${material.grade_level} &nbsp;&nbsp;
  <strong>Set:</strong> ${escapeHtml(material.set_label ?? "")}</div>
<table class="mis">
  <thead>
    <tr>
      <th class="c">#</th>
      <th>Types of Miscues <span class="muted">(Uri ng Mali)</span></th>
      <th class="c">Number of Miscues</th>
    </tr>
  </thead>
  <tbody>
    ${miscueRows}
    <tr><td></td><td><strong>Total Miscues (Kabuuan)</strong></td><td class="c">${totalMiscues ?? ""}</td></tr>
    <tr><td></td><td>${escapeHtml(PHILIRI_SELF_CORRECTION.en)} <span class="muted">(${escapeHtml(PHILIRI_SELF_CORRECTION.fil)}) — not counted as a miscue</span></td><td class="c">${typeof selfCorrections === "number" ? selfCorrections : ""}</td></tr>
    <tr><td></td><td><strong>Number of Words in the Passage</strong></td><td class="c">${wc}</td></tr>
    <tr><td></td><td><strong>Word Reading Score</strong></td><td class="c">${wrScore === null ? "" : `${wrScore} %`}</td></tr>
    <tr><td></td><td><strong>Word Reading Level (Antas ng Pagbasa)</strong></td><td class="c">${escapeHtml(wrLevel)}</td></tr>
  </tbody>
</table>
<div class="row" style="margin-top:10px"><strong>Overall Reading Level:</strong> ${escapeHtml(overall)}</div>
${remarks ? `<div class="row"><strong>Remarks:</strong> ${escapeHtml(remarks)}</div>` : ""}
</body></html>`;

  printHTMLContent(html);
}
