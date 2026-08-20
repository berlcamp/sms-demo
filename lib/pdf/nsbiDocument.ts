import {
  NSBI_ACCESS_ROAD_TYPES,
  NSBI_ACTUAL_USAGE_LABELS,
  NSBI_AMENITIES,
  NSBI_BUILDING_CONDITIONS,
  NSBI_BUILDING_MATERIALS,
  NSBI_BUILDING_TYPE_LABELS,
  NSBI_CLASSIFICATIONS,
  NSBI_FUND_SOURCES,
  NSBI_FURNITURE_FIELDS,
  NSBI_PAGES,
  NSBI_ROOM_CONDITIONS,
  NSBI_ROOM_USAGES,
  NSBI_SIGNATORY_ROLES,
  NSBI_SPECIFIC_FUND_SOURCES,
  NSBI_TRANSPORT_TYPES,
  NSBI_WASH_FIELDS,
} from "@/lib/constants/nsbi";
import {
  buildDepEdHeaderWithLogos,
  DEPED_HEADER_LOGOS_STYLES,
} from "@/lib/pdf/utils";
import { formatNsbiAsOf } from "@/lib/utils/nsbi";
import type {
  NsbiBuilding,
  NsbiPageKey,
  NsbiRoom,
  NsbiSignatoryRole,
  NsbiSubmission,
} from "@/types";

/**
 * DepEd School Building Inventory Form — a FACSIMILE of the issued document,
 * not a report styled like one (migration 154).
 *
 * The form is FIVE pages, not seven: several tables share a page under a single
 * signature block, only page 1 carries Longitude/Latitude and the Supply
 * Officer, and page 1 alone reads "Prepared & Certified True and Correct by"
 * where the rest read "Prepared, Certified True and Correct by". All of that
 * lives in NSBI_PAGES so the generator cannot disagree with the paper.
 *
 * Every page is headed with the submission's OWN as_of_date. Never substitute
 * the current date: reprinting a filed return must reproduce what was signed.
 *
 * The `Col. n` numbering rows are reproduced under each header because the
 * division office checks against them.
 *
 * Deliberately does NOT use reportShell.buildReportDocument(): that shell emits
 * exactly two signatory blocks and centres the school identity, where this form
 * needs three or four blocks and a labelled two-column header.
 */

const escapeMap: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[&<>"']/g, (c) => escapeMap[c]!);
}

/** A blank cell prints blank. Zero is a real answer and prints as 0. */
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function yesNo(value: boolean | null | undefined): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "";
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function label<T extends { value: string; label: string }>(
  list: T[],
  value: string | null | undefined,
): string {
  if (!value) return "";
  return list.find((x) => x.value === value)?.label ?? value;
}

function labels<T extends { value: string; label: string }>(
  list: T[],
  values: string[] | null | undefined,
): string {
  if (!values || values.length === 0) return "";
  return values.map((v) => label(list, v)).join(", ");
}

/** A run of empty ruled rows, so a blank table still looks like a blank form. */
function blankRows(columns: number, count: number): string {
  const cells = `<td>&nbsp;</td>`.repeat(columns);
  return `<tr>${cells}</tr>`.repeat(count);
}

/** The `Col. 1 … Col. n` row the division office checks against. */
function colRow(count: number, startAt = 1): string {
  let out = "<tr class='colnums'>";
  for (let i = 0; i < count; i += 1) out += `<td>Col. ${startAt + i}</td>`;
  return `${out}</tr>`;
}

const STYLES = `
@page { size: 13in 8.5in; margin: 0.4in; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: "Times New Roman", serif;
  font-size: 9pt;
  line-height: 1.25;
  color: #000;
  background: #fff;
}
${DEPED_HEADER_LOGOS_STYLES}
.page { page-break-after: always; }
.page:last-child { page-break-after: auto; }
.doc-title { font-size: 11pt; font-weight: bold; }
.doc-sub { font-size: 10pt; }
.idbar {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 24px;
  margin: 10px 0 6px;
  font-size: 9pt;
}
.idbar div { border-bottom: 1px solid #000; padding-bottom: 1px; }
.idbar span { font-weight: bold; }
.tbl-title { font-weight: bold; font-size: 9.5pt; margin: 10px 0 3px; }
table.f { width: 100%; border-collapse: collapse; table-layout: fixed; }
table.f th, table.f td {
  border: 1px solid #000;
  padding: 2px 3px;
  font-size: 7.5pt;
  vertical-align: top;
  word-wrap: break-word;
}
table.f th { text-align: center; font-weight: bold; background: #efefef; }
tr.colnums td { text-align: center; font-size: 6.5pt; font-style: italic; }
td.c { text-align: center; }
td.r { text-align: right; }
.checkgrid { width: 100%; border-collapse: collapse; }
.checkgrid td { border: 1px solid #000; padding: 3px 4px; font-size: 8pt; }
.box { display: inline-block; width: 9px; height: 9px; border: 1px solid #000; margin-right: 3px; vertical-align: -1px; }
.box.on { background: #000; }
.sigs { display: flex; justify-content: space-between; gap: 18px; margin-top: 26px; }
.sig { flex: 1; font-size: 8pt; }
.sig .cap { margin-bottom: 26px; }
.sig .name {
  border-top: 1px solid #000;
  padding-top: 2px;
  text-align: center;
  font-weight: bold;
  text-transform: uppercase;
  min-height: 14px;
}
.sig .title { text-align: center; font-size: 7.5pt; white-space: pre-line; }
@media print {
  body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
}
`;

export interface NsbiDocumentContext {
  submission: NsbiSubmission;
  buildings: NsbiBuilding[];
  rooms: NsbiRoom[];
  school: {
    name: string;
    school_id: string | null;
    division_id: string | null;
    region: string | null;
  };
}

// ============================================================================
// Page furniture
// ============================================================================

function pageHeader(ctx: NsbiDocumentContext, showCoordinates: boolean): string {
  const { school, submission } = ctx;
  const header = buildDepEdHeaderWithLogos(`
    <div style="font-size:9pt;">Department of Education</div>
    <div class="doc-title">School Building Inventory Form</div>
    <div class="doc-sub">(as of ${esc(formatNsbiAsOf(submission.as_of_date))})</div>
  `);

  const coords = showCoordinates
    ? `<div><span>Longitude:</span> ${esc(num(submission.longitude))}</div>
       <div><span>Latitude:</span> ${esc(num(submission.latitude))}</div>`
    : "";

  return `${header}
    <div class="idbar">
      <div><span>Region:</span> ${esc(school.region)}</div>
      <div><span>School ID:</span> ${esc(school.school_id)}</div>
      <div><span>Division:</span> ${esc(school.division_id)}</div>
      <div><span>School Name:</span> ${esc(school.name)}</div>
      ${coords}
    </div>`;
}

function signatureBlock(
  ctx: NsbiDocumentContext,
  roles: NsbiSignatoryRole[],
  preparedCaption: string,
): string {
  const blocks = roles.map((role) => {
    const meta = NSBI_SIGNATORY_ROLES.find((r) => r.value === role)!;
    const entry = ctx.submission.signatories?.find((s) => s.role === role);
    // Page 1 alone uses the ampersand caption; every other page uses the comma
    // form. Both are reproduced exactly as issued.
    const caption =
      role === "school_head" ? preparedCaption : meta.caption;
    return `<div class="sig">
      <div class="cap">${esc(caption)}</div>
      <div class="name">${esc(entry?.name ?? "")}</div>
      <div class="title">${esc(entry?.title ?? meta.defaultTitle)}</div>
    </div>`;
  });
  return `<div class="sigs">${blocks.join("")}</div>`;
}

// ============================================================================
// Table 1 — Summary of Existing Building (18 columns)
// ============================================================================

function table1(ctx: NsbiDocumentContext): string {
  const heads = [
    "Building Name/Number",
    "Building Type",
    "Fund Source/s",
    "Specific Fund Source/s",
    "Building Condition",
    "Number of Storeys",
    "Number of Rooms",
    "Year Completed",
    "Classification of Building",
    "Is building PWD accessible?",
    "Have undergone major repair for the last 5 years?",
    "With Certificate of Acceptance?",
    "Is the school building included in the DepEd Book of Accounts?",
    "Building Materials",
    "Date of Acquisition",
    "Acquisition Cost",
    "Book Value",
    "Insurance Information",
  ];

  const rows = ctx.buildings
    .map(
      (b) => `<tr>
      <td>${esc(b.building_name)}</td>
      <td>${esc(NSBI_BUILDING_TYPE_LABELS[b.building_type ?? ""] ?? b.building_type ?? "")}</td>
      <td>${esc(labels(NSBI_FUND_SOURCES, b.fund_sources))}</td>
      <td>${esc(label(NSBI_SPECIFIC_FUND_SOURCES, b.specific_fund_source))}</td>
      <td>${esc(label(NSBI_BUILDING_CONDITIONS, b.condition))}</td>
      <td class="c">${esc(num(b.storeys))}</td>
      <td class="c">${esc(num(b.room_count))}</td>
      <td class="c">${esc(num(b.year_completed))}</td>
      <td>${esc(label(NSBI_CLASSIFICATIONS, b.classification))}</td>
      <td class="c">${esc(yesNo(b.pwd_accessible))}</td>
      <td class="c">${esc(yesNo(b.major_repair_last_5y))}</td>
      <td class="c">${esc(yesNo(b.has_certificate_of_acceptance))}</td>
      <td class="c">${esc(yesNo(b.in_deped_book_of_accounts))}</td>
      <td>${esc(labels(NSBI_BUILDING_MATERIALS, b.building_materials))}</td>
      <td class="c">${esc(b.date_of_acquisition)}</td>
      <td class="r">${esc(money(b.acquisition_cost))}</td>
      <td class="r">${esc(money(b.book_value))}</td>
      <td>${esc(b.insurance_info)}</td>
    </tr>`,
    )
    .join("");

  return `<div class="tbl-title">Table 1. Summary of Existing Building</div>
  <table class="f">
    <thead>
      <tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
      ${colRow(18)}
    </thead>
    <tbody>${rows || blankRows(18, 6)}</tbody>
  </table>`;
}

// ============================================================================
// Table 2 — Existing Rooms per Building (8 columns)
// ============================================================================

function table2(ctx: NsbiDocumentContext): string {
  const nameById = new Map(ctx.buildings.map((b) => [b.id, b.building_name]));

  const rows = ctx.rooms
    .map((r) => {
      const usages = (r.actual_usages ?? [])
        .map((u) => NSBI_ACTUAL_USAGE_LABELS[u] ?? u)
        .join(", ");
      return `<tr>
        <td>${esc(nameById.get(r.building_id) ?? "")}</td>
        <td class="c">${esc(num(r.floor_number))}</td>
        <td class="c">${esc(r.room_number)}</td>
        <td>${esc(label(NSBI_ROOM_CONDITIONS, r.condition))}</td>
        <td>${esc(label(NSBI_ROOM_USAGES, r.room_usage))}</td>
        <td>${esc(usages)}</td>
        <td class="c">${esc(num(r.width_m))}</td>
        <td class="c">${esc(num(r.length_m))}</td>
      </tr>`;
    })
    .join("");

  return `<div class="tbl-title">Table 2. Existing Rooms per Building</div>
  <table class="f">
    <thead>
      <tr>
        <th style="width:14%">Building Number</th>
        <th style="width:7%">Floor Number</th>
        <th style="width:9%">Room Number</th>
        <th style="width:14%">Room Condition</th>
        <th style="width:13%">Room Usage</th>
        <th>Actual Usage/s</th>
        <th style="width:8%">Room Dimension — Width (m)</th>
        <th style="width:8%">Room Dimension — Length (m)</th>
      </tr>
      ${colRow(8)}
    </thead>
    <tbody>${rows || blankRows(8, 12)}</tbody>
  </table>`;
}

// ============================================================================
// Table 3 — TLS and Makeshift Rooms (4 columns)
// ============================================================================

function table3(ctx: NsbiDocumentContext): string {
  const s = ctx.submission;
  return `<div class="tbl-title">Table 3. Number of Temporary Learning Space/s (TLS) &amp; Makeshift Room/s</div>
  <table class="f">
    <thead>
      <tr>
        <th colspan="2">Temporary Learning Space/s</th>
        <th colspan="2">Makeshift Room/s</th>
      </tr>
      <tr>
        <th>No. of Temporary Learning Space/s</th>
        <th>No. of Classes/Sections using Temporary Learning Space/s</th>
        <th>No. of Makeshift Room/s</th>
        <th>No. of Classes/Sections using Makeshift Room/s</th>
      </tr>
      ${colRow(4)}
    </thead>
    <tbody>
      <tr>
        <td class="c">${esc(num(s.tls_count))}</td>
        <td class="c">${esc(num(s.tls_sections_count))}</td>
        <td class="c">${esc(num(s.makeshift_count))}</td>
        <td class="c">${esc(num(s.makeshift_sections_count))}</td>
      </tr>
    </tbody>
  </table>`;
}

// ============================================================================
// Tables 4A and 4B — Water and Sanitation
// ============================================================================
// 4A carries a Building Number column and one row per building; 4B has no such
// column and exactly one row. Both draw their measures from NSBI_WASH_FIELDS.

function table4a(ctx: NsbiDocumentContext): string {
  const rows = ctx.buildings
    .map((b) => {
      const cells = NSBI_WASH_FIELDS.map((f) => {
        const raw = (b as unknown as Record<string, unknown>)[f.key];
        return f.kind === "tristate"
          ? `<td class="c">${esc(yesNo(raw as boolean | null))}</td>`
          : `<td class="c">${esc(num(raw as number | null))}</td>`;
      }).join("");
      return `<tr><td>${esc(b.building_name)}</td>${cells}</tr>`;
    })
    .join("");

  return `<div class="tbl-title">Table 4A. Existing Number of Water and Sanitation Facilities</div>
  <table class="f">
    <thead>
      <tr>
        <th>Building Number</th>
        ${NSBI_WASH_FIELDS.map((f) => `<th>${esc(f.label)}</th>`).join("")}
      </tr>
      ${colRow(NSBI_WASH_FIELDS.length + 1)}
    </thead>
    <tbody>${rows || blankRows(NSBI_WASH_FIELDS.length + 1, 5)}</tbody>
  </table>`;
}

function table4b(ctx: NsbiDocumentContext): string {
  const s = ctx.submission as unknown as Record<string, unknown>;
  const cells = NSBI_WASH_FIELDS.map((f) => {
    const raw = s[`standalone_${f.key}`];
    return f.kind === "tristate"
      ? `<td class="c">${esc(yesNo(raw as boolean | null))}</td>`
      : `<td class="c">${esc(num(raw as number | null))}</td>`;
  }).join("");

  return `<div class="tbl-title">Table 4B. Existing Number of Stand-Alone Water and Sanitation Facilities</div>
  <table class="f">
    <thead>
      <tr>${NSBI_WASH_FIELDS.map((f) => `<th>${esc(f.label)}</th>`).join("")}</tr>
      ${colRow(NSBI_WASH_FIELDS.length)}
    </thead>
    <tbody><tr>${cells}</tr></tbody>
  </table>`;
}

// ============================================================================
// Table 5 — Usable Furniture (12 columns)
// ============================================================================

function table5(ctx: NsbiDocumentContext): string {
  const s = ctx.submission as unknown as Record<string, unknown>;
  const ungrouped = NSBI_FURNITURE_FIELDS.filter((f) => !f.group);
  const groups = Array.from(
    new Set(
      NSBI_FURNITURE_FIELDS.filter((f) => f.group).map((f) => f.group as string),
    ),
  );

  const topRow = [
    ...ungrouped.map(
      (f) => `<th rowspan="2" style="width:7%">${esc(f.label)}</th>`,
    ),
    ...groups.map((g) => {
      const span = NSBI_FURNITURE_FIELDS.filter((f) => f.group === g).length;
      return `<th colspan="${span}">${esc(g)}</th>`;
    }),
  ].join("");

  const secondRow = groups
    .flatMap((g) =>
      NSBI_FURNITURE_FIELDS.filter((f) => f.group === g).map(
        (f) => `<th>${esc(f.label)}</th>`,
      ),
    )
    .join("");

  const cells = NSBI_FURNITURE_FIELDS.map(
    (f) => `<td class="c">${esc(num(s[f.field] as number | null))}</td>`,
  ).join("");

  return `<div class="tbl-title">Table 5. Existing Number of Usable Furniture</div>
  <table class="f">
    <thead>
      <tr>${topRow}</tr>
      <tr>${secondRow}</tr>
      ${colRow(NSBI_FURNITURE_FIELDS.length)}
    </thead>
    <tbody><tr>${cells}</tr></tbody>
  </table>`;
}

// ============================================================================
// Table 6 — Other Facilities/Amenities
// ============================================================================
// Printed as the form's three column-pairs of Yes/No boxes, not reflowed into a
// data table: the paper original is read as a checklist.

function table6(ctx: NsbiDocumentContext): string {
  const amenities = ctx.submission.amenities ?? {};
  const byColumn = ([1, 2, 3] as const).map((c) =>
    NSBI_AMENITIES.filter((a) => a.column === c),
  );
  const depth = Math.max(...byColumn.map((c) => c.length));

  let body = "";
  for (let i = 0; i < depth; i += 1) {
    body += "<tr>";
    for (const column of byColumn) {
      const a = column[i];
      if (!a) {
        body += `<td></td><td></td>`;
        continue;
      }
      const v = amenities[a.value];
      body += `<td>${esc(a.label)}</td>
        <td class="c">
          <span class="box ${v === true ? "on" : ""}"></span>Yes
          &nbsp;&nbsp;
          <span class="box ${v === false ? "on" : ""}"></span>No
        </td>`;
    }
    body += "</tr>";
  }

  return `<div class="tbl-title">Table 6. Other Facilities/Amenities</div>
  <table class="checkgrid">
    <thead>
      <tr>
        <td><b>Type of Facilities/Amenities</b></td><td class="c"><b>Present in Campus? (Yes/No)</b></td>
        <td><b>Type of Facilities/Amenities</b></td><td class="c"><b>Present in Campus? (Yes/No)</b></td>
        <td><b>Type of Facilities/Amenities</b></td><td class="c"><b>Present in Campus? (Yes/No)</b></td>
      </tr>
      <tr class="colnums">
        <td>Col. 1</td><td>Col. 2</td><td>Col. 3</td>
        <td>Col. 4</td><td>Col. 5</td><td>Col. 6</td>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

// ============================================================================
// Table 7 — Access going to School
// ============================================================================

function table7(ctx: NsbiDocumentContext): string {
  const roads = ctx.submission.access_road_types ?? [];
  const transport = ctx.submission.transport_types ?? [];

  // The form prints transport in two side-by-side columns of six.
  const half = Math.ceil(NSBI_TRANSPORT_TYPES.length / 2);
  const left = NSBI_TRANSPORT_TYPES.slice(0, half);
  const right = NSBI_TRANSPORT_TYPES.slice(half);
  const depth = Math.max(NSBI_ACCESS_ROAD_TYPES.length, half);

  let body = "";
  for (let i = 0; i < depth; i += 1) {
    const road = NSBI_ACCESS_ROAD_TYPES[i];
    const l = left[i];
    const r = right[i];
    const cell = (
      item: { value: string; label: string } | undefined,
      selected: string[],
    ) =>
      item
        ? `<td><span class="box ${selected.includes(item.value) ? "on" : ""}"></span>${esc(item.label)}</td>`
        : "<td></td>";
    body += `<tr>${cell(road, roads)}${cell(l, transport)}${cell(r, transport)}</tr>`;
  }

  return `<div class="tbl-title">Table 7. Access going to School</div>
  <div style="font-size:8pt;font-style:italic;margin-bottom:3px;">(Check all applicable)</div>
  <table class="checkgrid" style="width:70%">
    <thead>
      <tr>
        <td class="c"><b>Type of Access Road</b></td>
        <td class="c" colspan="2"><b>Accessible by type of transportation</b></td>
      </tr>
      <tr class="colnums">
        <td>Col. 1</td><td colspan="2">Col. 2</td>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>`;
}

// ============================================================================
// Assembly
// ============================================================================

const TABLE_RENDERERS: Record<NsbiPageKey, ((ctx: NsbiDocumentContext) => string)[]> = {
  page_1: [table1],
  page_2: [table2],
  page_3: [table3, table4a],
  page_4: [table4b, table5, table6],
  page_5: [table7],
};

export function buildNsbiDocument(ctx: NsbiDocumentContext): string {
  const pages = NSBI_PAGES.map((page) => {
    const body = TABLE_RENDERERS[page.key]
      .map((render) => render(ctx))
      .join("");
    return `<div class="page">
      ${pageHeader(ctx, page.showCoordinates)}
      ${body}
      ${signatureBlock(ctx, page.signatories, page.preparedCaption)}
    </div>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>School Building Inventory Form — ${esc(ctx.school.name)}</title>
<style>${STYLES}</style>
</head>
<body>${pages}</body>
</html>`;
}
