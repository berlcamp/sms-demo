"use client";

/**
 * IPEd Program Data Set FY <year> — sheet 1 of the division's IPEd workbook.
 *
 * One row per school, fifty-one columns wide. Half of it is derived live by
 * `iped_program_facts` (migration 149) and half is typed into
 * `sms_iped_report_entries`; which half is which is not a preference but what
 * the schema can answer — see the migration header. Derived cells are shown
 * plain, typed cells on a tinted background, and the typed half is edited in a
 * per-school dialog because an inline input grid at this width is unusable.
 *
 * The A / B halves of the enrolment matrix follow the typed `implementing_iped`
 * flag: a school that has answered YES reports under A. IPEd Implementing
 * Schools, NO under B. Schools Serving IP Learners, and one that has not
 * answered reports under neither — which is why an unfilled row shows a blank
 * enrolment block even though the enrolment itself is known.
 *
 * Rendered at two routes: `/division/reports/iped` (every school, the shape the
 * printed form takes) and `/school-reports/iped` (the signed-in school alone).
 * The `scope` prop is the only difference between them — see ReportScope.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  IPED_BANDS,
  IPED_HALVES,
  IPED_TEACHER_CELLS,
  IPED_TEXT_FIELDS,
  fiscalYearOptions,
  orientedKey,
  schoolTypeBands,
  schoolYearForFiscalYear,
  type IpedBand,
  type IpedEntryNumericKey,
  type IpedHalf,
} from "@/lib/constants/iped";
import { supabase } from "@/lib/supabase/client";
import type { IpedProgramFact, IpedReportEntry } from "@/types";
import { ArrowLeft, Download, Loader2, Pencil, Sprout } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import {
  ReportAccessDenied,
  useReportScope,
  type ReportScope,
} from "./ReportScope";
import { IpedEntryDialog } from "./IpedEntryDialog";

const ORIENTED_BLOCKS = [
  {
    block: "teachers_oriented" as const,
    label: "Total No. of Teachers Oriented on IPEd Program (CUMULATIVE)",
  },
  {
    block: "heads_oriented" as const,
    label: "Total No. of School Heads Oriented on IPEd Program (CUMULATIVE)",
  },
];

/** Enrolment counts per band, as the RPC returns them. */
function enrolmentCell(
  fact: IpedProgramFact,
  band: IpedBand,
  ip: boolean,
): number {
  const key = `enrolment_${band}_${ip ? "ip" : "non_ip"}` as keyof IpedProgramFact;
  return (fact[key] as number) ?? 0;
}

/** A blank, not a zero: an unanswered cell prints blank on the paper form. */
function show(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

export function IpedDataSet({ scope }: { scope: ReportScope }) {
  const {
    schoolId: effectiveSchoolId,
    canView,
    canEdit,
    ready,
    blockedReason,
    backHref,
    label: scopeName,
  } = useReportScope(scope);
  const isDivisionScope = scope === "division";

  const [fiscalYear, setFiscalYear] = useState(() => fiscalYearOptions()[1]);
  const [facts, setFacts] = useState<IpedProgramFact[]>([]);
  const [entries, setEntries] = useState<Record<string, IpedReportEntry>>({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<IpedProgramFact | null>(null);

  const schoolYear = schoolYearForFiscalYear(fiscalYear);

  const load = useCallback(async () => {
    if (!canView || !ready) return;
    setLoading(true);
    try {
      const schoolParam =
        effectiveSchoolId === null ? null : Number(effectiveSchoolId);

      let entryQuery = supabase
        .from("sms_iped_report_entries")
        .select("*")
        .eq("fiscal_year", fiscalYear);
      if (schoolParam !== null) {
        entryQuery = entryQuery.eq("school_id", schoolParam);
      }

      const [factResult, entryResult] = await Promise.all([
        supabase.rpc("iped_program_facts", {
          p_school_id: schoolParam,
          p_school_year: schoolYear,
        }),
        entryQuery,
      ]);

      if (factResult.error) throw factResult.error;
      if (entryResult.error) throw entryResult.error;

      setFacts(
        ((factResult.data ?? []) as IpedProgramFact[]).map((f) => ({
          ...f,
          school_id: String(f.school_id),
        })),
      );
      const bySchool: Record<string, IpedReportEntry> = {};
      ((entryResult.data ?? []) as IpedReportEntry[]).forEach((e) => {
        bySchool[String(e.school_id)] = { ...e, school_id: String(e.school_id) };
      });
      setEntries(bySchool);
    } catch (err) {
      console.error("Error loading IPEd data set:", err);
      toast.error("Failed to load the data set");
      setFacts([]);
      setEntries({});
    } finally {
      setLoading(false);
    }
  }, [canView, ready, effectiveSchoolId, fiscalYear, schoolYear]);

  useEffect(() => {
    load();
  }, [load]);

  const scopeLabel = isDivisionScope
    ? "Division-wide"
    : (facts[0]?.school_name ?? scopeName);

  /**
   * The one derivation that depends on typed data: the enrolment block prints
   * under A or under B according to the school's IPEd designation, and under
   * neither while that is unanswered.
   */
  const enrolmentHalf = (schoolId: string): IpedHalf | null => {
    const implementing = entries[schoolId]?.implementing_iped;
    if (implementing === true) return "a";
    if (implementing === false) return "b";
    return null;
  };

  // ── Excel export ─────────────────────────────────────────────────────────
  // Built as an array of arrays with explicit merges rather than from JSON, so
  // the exported sheet carries the same banded header as the printed form.
  const handleExport = () => {
    try {
      const bandHeads = IPED_BANDS.map((b) => b.label);
      const enrolmentLeaf = IPED_HALVES.flatMap(() =>
        bandHeads.flatMap(() => ["IPs", "Non-IPs"]),
      );

      const row1: (string | number)[] = [
        "No.",
        "SCHOOLS",
        "DISTRICT",
        "TYPE OF SCHOOL",
        "",
        "",
        "",
        "IMPLEMENTING IPEd",
        "",
        "Total No. OF TEACHERS",
        "",
        "",
        "",
        "Is your school has IP Learners",
        "",
        `Total Enrolment SY ${schoolYear}`,
        ...Array(15).fill(""),
        ORIENTED_BLOCKS[0].label,
        ...Array(7).fill(""),
        ORIENTED_BLOCKS[1].label,
        ...Array(7).fill(""),
        "Total No. of Contextualized Teaching and Learning Resources (CUMULATIVE)",
        "Major Activities conducted (Categorized based on specific program/direction)",
        "Name of Division CAB Officers (Recent)",
        "Major Issues/ Concerns (elevated to RO/CO)",
      ];

      const row2: (string | number)[] = [
        ...Array(15).fill(""),
        IPED_HALVES[0].label,
        ...Array(7).fill(""),
        IPED_HALVES[1].label,
        ...Array(7).fill(""),
        IPED_HALVES[0].label,
        ...Array(3).fill(""),
        IPED_HALVES[1].label,
        ...Array(3).fill(""),
        IPED_HALVES[0].label,
        ...Array(3).fill(""),
        IPED_HALVES[1].label,
        ...Array(3).fill(""),
        "",
        "",
        "",
        "",
      ];

      const row3: (string | number)[] = [
        ...Array(9).fill(""),
        "Male",
        "",
        "Female",
        "",
        "",
        "",
        ...IPED_HALVES.flatMap(() => bandHeads.flatMap((b) => [b, ""])),
        ...IPED_HALVES.flatMap(() => bandHeads),
        ...IPED_HALVES.flatMap(() => bandHeads),
        "",
        "",
        "",
        "",
      ];

      const row4: (string | number)[] = [
        "",
        "",
        "",
        ...bandHeads,
        "YES",
        "NO",
        "IPs",
        "Non-IPs",
        "IPs",
        "Non-IPs",
        "YES",
        "NO",
        ...enrolmentLeaf,
        ...Array(16).fill(""),
        "",
        "",
        "",
        "",
      ];

      const body = facts.map((f, index) => {
        const entry = entries[f.school_id];
        const bands = schoolTypeBands(f.school_type);
        const half = enrolmentHalf(f.school_id);
        const enrolmentCells = IPED_HALVES.flatMap((h) =>
          IPED_BANDS.flatMap((band): (string | number)[] =>
            half === h.value
              ? [
                  enrolmentCell(f, band.value, true),
                  enrolmentCell(f, band.value, false),
                ]
              : ["", ""],
          ),
        );
        const orientedCells = ORIENTED_BLOCKS.flatMap(({ block }) =>
          IPED_HALVES.flatMap((h) =>
            IPED_BANDS.map((band) =>
              show(entry?.[orientedKey(block, h.value, band.value)]),
            ),
          ),
        );
        return [
          index + 1,
          f.school_name,
          f.district ?? "",
          ...IPED_BANDS.map((b) => (bands.includes(b.value) ? "✓" : "")),
          entry?.implementing_iped === true ? "✓" : "",
          entry?.implementing_iped === false ? "✓" : "",
          ...IPED_TEACHER_CELLS.map((c) => show(entry?.[c.key])),
          f.has_ip_learners ? "✓" : "",
          f.has_ip_learners ? "" : "✓",
          ...enrolmentCells,
          ...orientedCells,
          show(entry?.contextualized_resources),
          entry?.major_activities ?? "",
          entry?.cab_officers ?? "",
          entry?.major_issues ?? "",
        ];
      });

      const sheet = XLSX.utils.aoa_to_sheet([
        [`IPEd Program Data Set FY ${fiscalYear}`],
        [],
        row1,
        row2,
        row3,
        row4,
        ...body,
      ]);

      // Header merges. Rows 2-5 (0-indexed) are the four banded header rows.
      const H = 2;
      const merges: XLSX.Range[] = [
        { s: { r: H, c: 0 }, e: { r: H + 3, c: 0 } }, // No.
        { s: { r: H, c: 1 }, e: { r: H + 3, c: 1 } }, // SCHOOLS
        { s: { r: H, c: 2 }, e: { r: H + 3, c: 2 } }, // DISTRICT
        { s: { r: H, c: 3 }, e: { r: H + 2, c: 6 } }, // TYPE OF SCHOOL
        { s: { r: H, c: 7 }, e: { r: H + 2, c: 8 } }, // IMPLEMENTING IPEd
        { s: { r: H, c: 9 }, e: { r: H + 1, c: 12 } }, // TEACHERS
        { s: { r: H + 2, c: 9 }, e: { r: H + 2, c: 10 } }, // Male
        { s: { r: H + 2, c: 11 }, e: { r: H + 2, c: 12 } }, // Female
        { s: { r: H, c: 13 }, e: { r: H + 2, c: 14 } }, // Is your school has IP Learners
        { s: { r: H, c: 15 }, e: { r: H, c: 30 } }, // Total Enrolment
        { s: { r: H + 1, c: 15 }, e: { r: H + 1, c: 22 } }, // Enrolment A
        { s: { r: H + 1, c: 23 }, e: { r: H + 1, c: 30 } }, // Enrolment B
        { s: { r: H, c: 31 }, e: { r: H, c: 38 } }, // Teachers oriented
        { s: { r: H + 1, c: 31 }, e: { r: H + 1, c: 34 } },
        { s: { r: H + 1, c: 35 }, e: { r: H + 1, c: 38 } },
        { s: { r: H, c: 39 }, e: { r: H, c: 46 } }, // Heads oriented
        { s: { r: H + 1, c: 39 }, e: { r: H + 1, c: 42 } },
        { s: { r: H + 1, c: 43 }, e: { r: H + 1, c: 46 } },
        { s: { r: H, c: 47 }, e: { r: H + 3, c: 47 } },
        { s: { r: H, c: 48 }, e: { r: H + 3, c: 48 } },
        { s: { r: H, c: 49 }, e: { r: H + 3, c: 49 } },
        { s: { r: H, c: 50 }, e: { r: H + 3, c: 50 } },
      ];
      // Enrolment band pairs (Elem/IS/JHS/SHS over IPs + Non-IPs) on row 3.
      for (let i = 0; i < 8; i += 1) {
        const c = 15 + i * 2;
        merges.push({ s: { r: H + 2, c }, e: { r: H + 2, c: c + 1 } });
      }
      // Oriented band labels span rows 3-4 — there is no fifth level below them.
      for (let c = 31; c <= 46; c += 1) {
        merges.push({ s: { r: H + 2, c }, e: { r: H + 3, c } });
      }
      sheet["!merges"] = merges;

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, "IPEd Data Set");
      XLSX.writeFile(
        workbook,
        `IPEd_Program_Data_Set_FY${fiscalYear}_${scopeLabel.replace(/[^\w]+/g, "_")}.xlsx`,
      );
      toast.success("Exported");
    } catch (err) {
      console.error("Error exporting IPEd data set:", err);
      toast.error("Failed to export");
    }
  };

  if (!canView) {
    return (
      <ReportAccessDenied message="You do not have permission to view this data set." />
    );
  }

  if (blockedReason) {
    return <ReportAccessDenied message={blockedReason} />;
  }

  const typedCell = "border px-2 py-1.5 text-center tabular-nums bg-amber-50/60 dark:bg-amber-950/20";
  const derivedCell = "border px-2 py-1.5 text-center tabular-nums";

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Link
        href={backHref}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Reports
      </Link>

      <div className="flex items-center gap-2">
        <Sprout className="h-6 w-6" />
        <div>
          <h1 className="text-xl font-semibold">
            IPEd Program Data Set FY {fiscalYear}
          </h1>
          <p className="text-sm text-muted-foreground">
            Indigenous Peoples Education programme returns against enrolment
            for SY {schoolYear}.{" "}
            {isDivisionScope
              ? "Every school in the division, one row each."
              : "This school only."}
          </p>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-0">
          <CardDescription>
            Plain cells are derived from live records. Tinted cells are typed —
            the IPEd designation, the teacher IP split and the two cumulative
            orientation matrices have no source anywhere in the system, so a
            school fills them in with{" "}
            <span className="font-medium">Edit</span>. The enrolment block
            prints under A or B according to the designation, and stays blank
            until that is answered.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-6">
          <div className="rounded-lg border bg-muted/30">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">
                  Fiscal Year
                </label>
                <Select
                  value={String(fiscalYear)}
                  onValueChange={(v) => setFiscalYear(Number(v))}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fiscalYearOptions().map((fy) => (
                      <SelectItem key={fy} value={String(fy)}>
                        FY {fy}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Enrolment is read for SY {schoolYear}.
                </p>
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={handleExport}
                  disabled={loading || facts.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export to Excel
                </Button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Building the data set…
            </div>
          ) : (
            <div className="overflow-x-auto border rounded-md">
              <table className="text-xs border-collapse min-w-full whitespace-nowrap">
                <thead>
                  <tr className="bg-muted/60">
                    <th rowSpan={4} className="border px-2 py-2 w-10">
                      No.
                    </th>
                    <th rowSpan={4} className="border px-3 py-2 text-left">
                      SCHOOLS
                    </th>
                    <th rowSpan={4} className="border px-3 py-2 text-left">
                      DISTRICT
                    </th>
                    <th colSpan={4} rowSpan={3} className="border px-2 py-2">
                      TYPE OF SCHOOL
                    </th>
                    <th colSpan={2} rowSpan={3} className="border px-2 py-2">
                      IMPLEMENTING IPEd
                    </th>
                    <th colSpan={4} rowSpan={2} className="border px-2 py-2">
                      Total No. OF TEACHERS
                    </th>
                    <th colSpan={2} rowSpan={3} className="border px-2 py-2">
                      Is your school has
                      <br />
                      IP Learners
                    </th>
                    <th colSpan={16} className="border px-2 py-2">
                      Total Enrolment SY {schoolYear}
                    </th>
                    {ORIENTED_BLOCKS.map((b) => (
                      <th key={b.block} colSpan={8} className="border px-2 py-2">
                        {b.label}
                      </th>
                    ))}
                    <th rowSpan={4} className="border px-2 py-2 max-w-40 whitespace-normal">
                      Total No. of Contextualized Teaching and Learning
                      Resources (CUMULATIVE)
                    </th>
                    <th rowSpan={4} className="border px-2 py-2 max-w-40 whitespace-normal">
                      Major Activities conducted
                    </th>
                    <th rowSpan={4} className="border px-2 py-2 max-w-40 whitespace-normal">
                      Name of Division CAB Officers (Recent)
                    </th>
                    <th rowSpan={4} className="border px-2 py-2 max-w-40 whitespace-normal">
                      Major Issues / Concerns (elevated to RO/CO)
                    </th>
                    {canEdit && (
                      <th rowSpan={4} className="border px-2 py-2 w-16">
                        Edit
                      </th>
                    )}
                  </tr>

                  <tr className="bg-muted/60">
                    {IPED_HALVES.map((h) => (
                      <th
                        key={`enr-${h.value}`}
                        colSpan={8}
                        className="border px-2 py-1"
                      >
                        {h.label}
                      </th>
                    ))}
                    {ORIENTED_BLOCKS.map((b) =>
                      IPED_HALVES.map((h) => (
                        <th
                          key={`${b.block}-${h.value}`}
                          colSpan={4}
                          className="border px-2 py-1"
                        >
                          {h.label}
                        </th>
                      )),
                    )}
                  </tr>

                  <tr className="bg-muted/60">
                    <th colSpan={2} className="border px-2 py-1">
                      Male
                    </th>
                    <th colSpan={2} className="border px-2 py-1">
                      Female
                    </th>
                    {IPED_HALVES.map((h) =>
                      IPED_BANDS.map((band) => (
                        <th
                          key={`enr-${h.value}-${band.value}`}
                          colSpan={2}
                          className="border px-2 py-1"
                        >
                          {band.label}
                        </th>
                      )),
                    )}
                    {ORIENTED_BLOCKS.map((b) =>
                      IPED_HALVES.map((h) =>
                        IPED_BANDS.map((band) => (
                          <th
                            key={`${b.block}-${h.value}-${band.value}`}
                            rowSpan={2}
                            className="border px-2 py-1 w-12"
                          >
                            {band.label}
                          </th>
                        )),
                      ),
                    )}
                  </tr>

                  <tr className="bg-muted/60">
                    {IPED_BANDS.map((b) => (
                      <th key={`type-${b.value}`} className="border px-2 py-1 w-10">
                        {b.label}
                      </th>
                    ))}
                    <th className="border px-2 py-1 w-10">YES</th>
                    <th className="border px-2 py-1 w-10">NO</th>
                    {IPED_TEACHER_CELLS.map((c) => (
                      <th key={c.key} className="border px-2 py-1 w-14">
                        {c.ip}
                      </th>
                    ))}
                    <th className="border px-2 py-1 w-10">YES</th>
                    <th className="border px-2 py-1 w-10">NO</th>
                    {IPED_HALVES.map((h) =>
                      IPED_BANDS.map((band) => (
                        <Fragment key={`enrleaf-${h.value}-${band.value}`}>
                          <th className="border px-2 py-1 w-12">IPs</th>
                          <th className="border px-2 py-1 w-14">Non-IPs</th>
                        </Fragment>
                      )),
                    )}
                  </tr>
                </thead>

                <tbody>
                  {facts.map((f, index) => {
                    const entry = entries[f.school_id];
                    const bands = schoolTypeBands(f.school_type);
                    const half = enrolmentHalf(f.school_id);
                    return (
                      <tr key={f.school_id} className="hover:bg-muted/30">
                        <td className="border px-2 py-1.5 text-center text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="border px-3 py-1.5">{f.school_name}</td>
                        <td className="border px-3 py-1.5">
                          {f.district ?? "—"}
                        </td>
                        {IPED_BANDS.map((b) => (
                          <td key={`type-${b.value}`} className={derivedCell}>
                            {bands.includes(b.value) ? "✓" : ""}
                          </td>
                        ))}
                        <td className={typedCell}>
                          {entry?.implementing_iped === true ? "✓" : ""}
                        </td>
                        <td className={typedCell}>
                          {entry?.implementing_iped === false ? "✓" : ""}
                        </td>
                        {IPED_TEACHER_CELLS.map((c) => (
                          <td key={c.key} className={typedCell}>
                            {show(entry?.[c.key])}
                          </td>
                        ))}
                        <td className={derivedCell}>
                          {f.has_ip_learners ? "✓" : ""}
                        </td>
                        <td className={derivedCell}>
                          {f.has_ip_learners ? "" : "✓"}
                        </td>
                        {IPED_HALVES.map((h) =>
                          IPED_BANDS.map((band) => (
                            <Fragment key={`enr-${h.value}-${band.value}`}>
                              <td className={derivedCell}>
                                {half === h.value
                                  ? enrolmentCell(f, band.value, true)
                                  : ""}
                              </td>
                              <td className={derivedCell}>
                                {half === h.value
                                  ? enrolmentCell(f, band.value, false)
                                  : ""}
                              </td>
                            </Fragment>
                          )),
                        )}
                        {ORIENTED_BLOCKS.map(({ block }) =>
                          IPED_HALVES.map((h) =>
                            IPED_BANDS.map((band) => {
                              const key: IpedEntryNumericKey = orientedKey(
                                block,
                                h.value,
                                band.value,
                              );
                              return (
                                <td
                                  key={`${block}-${h.value}-${band.value}`}
                                  className={typedCell}
                                >
                                  {show(entry?.[key])}
                                </td>
                              );
                            }),
                          ),
                        )}
                        <td className={typedCell}>
                          {show(entry?.contextualized_resources)}
                        </td>
                        {IPED_TEXT_FIELDS.map((field) => (
                          <td
                            key={field.key}
                            className="border px-2 py-1.5 max-w-56 whitespace-normal bg-amber-50/60 dark:bg-amber-950/20"
                          >
                            {entry?.[field.key] ?? ""}
                          </td>
                        ))}
                        {canEdit && (
                          <td className="border px-2 py-1.5 text-center">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              onClick={() => setEditing(f)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {facts.length === 0 && (
                    <tr>
                      <td
                        colSpan={canEdit ? 52 : 51}
                        className="border px-3 py-8 text-center text-sm text-muted-foreground"
                      >
                        No schools in scope.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <IpedEntryDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        fiscalYear={fiscalYear}
        fact={editing}
        entry={editing ? (entries[editing.school_id] ?? null) : null}
        onSaved={load}
      />
    </div>
  );
}
