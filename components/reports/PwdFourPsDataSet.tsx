"use client";

/**
 * PWD and 4P's Beneficiary Data Set FY <year>.
 *
 * Sheets 2 and 3 of the division's IPEd workbook: the same three learner
 * categories (PWD, 4Ps, IP) counted by sex, once per school and once per grade
 * level. Nothing here is typed — `pwd_fourps_facts` (migration 149) returns the
 * (school, grade level) cross-product and both tables are folded from that one
 * result, so the two sheets can never disagree.
 *
 * Rendered at two routes: `/division/reports/pwd-4ps` (every school, the shape
 * the printed form takes) and `/school-reports/pwd-4ps` (the signed-in school
 * alone). The `scope` prop is the only difference between them — see
 * ReportScope.
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getGradeLevelLabel } from "@/lib/constants";
import {
  IPED_BANDS,
  PWD_FOURPS_CATEGORIES,
  fiscalYearOptions,
  schoolTypeBands,
  schoolYearForFiscalYear,
} from "@/lib/constants/iped";
import { supabase } from "@/lib/supabase/client";
import type { PwdFourPsFact } from "@/types";
import { ArrowLeft, Download, HeartHandshake, Loader2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import * as XLSX from "xlsx";
import {
  ReportAccessDenied,
  useReportScope,
  type ReportScope,
} from "./ReportScope";

interface SchoolRow {
  school_id: string;
  school_name: string;
  district: string | null;
  school_type: string | null;
  enrolment: number;
  pwd_male: number;
  pwd_female: number;
  fourps_male: number;
  fourps_female: number;
  ip_male: number;
  ip_female: number;
}

type CountKeys = Exclude<keyof SchoolRow, "school_id" | "school_name" | "district" | "school_type">;

const COUNT_KEYS: CountKeys[] = [
  "enrolment",
  "pwd_male",
  "pwd_female",
  "fourps_male",
  "fourps_female",
  "ip_male",
  "ip_female",
];

const emptyCounts = () =>
  Object.fromEntries(COUNT_KEYS.map((k) => [k, 0])) as Record<CountKeys, number>;

export function PwdFourPsDataSet({ scope }: { scope: ReportScope }) {
  const {
    schoolId: effectiveSchoolId,
    canView,
    ready,
    blockedReason,
    backHref,
    label: scopeName,
  } = useReportScope(scope);
  const isDivisionScope = scope === "division";

  const [fiscalYear, setFiscalYear] = useState(() => fiscalYearOptions()[1]);
  const [facts, setFacts] = useState<PwdFourPsFact[]>([]);
  const [loading, setLoading] = useState(false);

  const schoolYear = schoolYearForFiscalYear(fiscalYear);

  const load = useCallback(async () => {
    if (!canView || !ready) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("pwd_fourps_facts", {
        p_school_id:
          effectiveSchoolId === null ? null : Number(effectiveSchoolId),
        p_school_year: schoolYear,
      });
      if (error) throw error;
      setFacts(
        ((data ?? []) as PwdFourPsFact[]).map((f) => ({
          ...f,
          school_id: String(f.school_id),
        })),
      );
    } catch (err) {
      console.error("Error loading PWD / 4Ps data:", err);
      toast.error("Failed to load the data set");
      setFacts([]);
    } finally {
      setLoading(false);
    }
  }, [canView, ready, effectiveSchoolId, schoolYear]);

  useEffect(() => {
    load();
  }, [load]);

  /** Sheet 2 — one row per school. */
  const schoolRows = useMemo(() => {
    const byId = new Map<string, SchoolRow>();
    facts.forEach((f) => {
      const row =
        byId.get(f.school_id) ??
        ({
          school_id: f.school_id,
          school_name: f.school_name,
          district: f.district,
          school_type: f.school_type,
          ...emptyCounts(),
        } as SchoolRow);
      COUNT_KEYS.forEach((k) => {
        row[k] += f[k];
      });
      byId.set(f.school_id, row);
    });
    return Array.from(byId.values()).sort((a, b) =>
      a.school_name.localeCompare(b.school_name),
    );
  }, [facts]);

  /**
   * Sheet 3 — one row per grade level. Rungs with no enrolment anywhere in
   * scope are dropped: an elementary school has no Grade 9, and a blank row is
   * not the same statement as a zero. The `grade_level` null row a school with
   * no enrolment returns carries no rung at all.
   */
  const gradeRows = useMemo(() => {
    const byGrade = new Map<number, Record<CountKeys, number>>();
    facts.forEach((f) => {
      if (f.grade_level === null) return;
      const row = byGrade.get(f.grade_level) ?? emptyCounts();
      COUNT_KEYS.forEach((k) => {
        row[k] += f[k];
      });
      byGrade.set(f.grade_level, row);
    });
    return Array.from(byGrade.entries())
      .filter(([, counts]) => counts.enrolment > 0)
      .sort((a, b) => a[0] - b[0]);
  }, [facts]);

  const totals = useMemo(() => {
    const t = emptyCounts();
    schoolRows.forEach((r) => {
      COUNT_KEYS.forEach((k) => {
        t[k] += r[k];
      });
    });
    return t;
  }, [schoolRows]);

  const scopeLabel = isDivisionScope
    ? "Division-wide"
    : (schoolRows[0]?.school_name ?? scopeName);

  const handleExport = () => {
    try {
      const workbook = XLSX.utils.book_new();

      const bySchool = schoolRows.map((r, index) => {
        const bands = schoolTypeBands(r.school_type);
        return {
          No: index + 1,
          SCHOOLS: r.school_name,
          DISTRICT: r.district ?? "",
          "Elem.": bands.includes("elem") ? "✓" : "",
          IS: bands.includes("is") ? "✓" : "",
          JHS: bands.includes("jhs") ? "✓" : "",
          SHS: bands.includes("shs") ? "✓" : "",
          "PWD MALE": r.pwd_male,
          "PWD FEMALE": r.pwd_female,
          "4P'S MALE": r.fourps_male,
          "4P'S FEMALE": r.fourps_female,
          "IP MALE": r.ip_male,
          "IP FEMALE": r.ip_female,
        };
      });
      bySchool.push({
        No: "" as unknown as number,
        SCHOOLS: "Total",
        DISTRICT: "",
        "Elem.": "",
        IS: "",
        JHS: "",
        SHS: "",
        "PWD MALE": totals.pwd_male,
        "PWD FEMALE": totals.pwd_female,
        "4P'S MALE": totals.fourps_male,
        "4P'S FEMALE": totals.fourps_female,
        "IP MALE": totals.ip_male,
        "IP FEMALE": totals.ip_female,
      });
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(bySchool),
        "By School",
      );

      const byGrade: Record<string, string | number>[] = gradeRows.map(
        ([grade, counts], index) => ({
          No: index + 1,
          "GRADE LEVEL": getGradeLevelLabel(grade),
          "PWD MALE": counts.pwd_male,
          "PWD FEMALE": counts.pwd_female,
          "4P'S MALE": counts.fourps_male,
          "4P'S FEMALE": counts.fourps_female,
          "IP MALE": counts.ip_male,
          "IP FEMALE": counts.ip_female,
        }),
      );
      byGrade.push({
        No: "",
        "GRADE LEVEL": "TOTAL",
        "PWD MALE": totals.pwd_male,
        "PWD FEMALE": totals.pwd_female,
        "4P'S MALE": totals.fourps_male,
        "4P'S FEMALE": totals.fourps_female,
        "IP MALE": totals.ip_male,
        "IP FEMALE": totals.ip_female,
      });
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.json_to_sheet(byGrade),
        "By Grade Level",
      );

      XLSX.writeFile(
        workbook,
        `PWD_4Ps_Data_Set_FY${fiscalYear}_${scopeLabel.replace(/[^\w]+/g, "_")}.xlsx`,
      );
      toast.success("Exported");
    } catch (err) {
      console.error("Error exporting PWD / 4Ps data:", err);
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
        <HeartHandshake className="h-6 w-6" />
        <div>
          <h1 className="text-xl font-semibold">
            PWD and 4P&apos;s Beneficiary Data Set FY {fiscalYear}
          </h1>
          <p className="text-sm text-muted-foreground">
            Learners with a disability, 4Ps beneficiaries and IP learners by
            sex, for SY {schoolYear}.{" "}
            {isDivisionScope
              ? "Every school in the division, one row each."
              : "This school only."}{" "}
            Every figure is derived; nothing on this form is typed.
          </p>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardHeader className="pb-0">
          <CardDescription>
            PWD is read from the SNED disability records, which only the
            enrolment wizard&apos;s SNED branch writes — a learner with a
            disability enrolled in a regular grade has no record yet and is not
            counted here.
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
                  Counted from enrolment in SY {schoolYear}.
                </p>
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={handleExport}
                  disabled={loading || schoolRows.length === 0}
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
              Counting learners…
            </div>
          ) : (
            <Tabs defaultValue="schools">
              <TabsList>
                <TabsTrigger value="schools">By School</TabsTrigger>
                <TabsTrigger value="grades">By Grade Level</TabsTrigger>
              </TabsList>

              <TabsContent value="schools" className="mt-4">
                <div className="overflow-x-auto border rounded-md">
                  <table className="text-sm border-collapse min-w-full">
                    <thead>
                      <tr className="bg-muted/60">
                        <th rowSpan={2} className="border px-2 py-2 w-10">
                          No.
                        </th>
                        <th rowSpan={2} className="border px-3 py-2 text-left">
                          SCHOOLS
                        </th>
                        <th rowSpan={2} className="border px-3 py-2 text-left">
                          DISTRICT
                        </th>
                        <th colSpan={4} className="border px-3 py-2">
                          TYPE OF SCHOOL
                        </th>
                        {PWD_FOURPS_CATEGORIES.map((c) => (
                          <th
                            key={c.value}
                            colSpan={2}
                            className="border px-3 py-2"
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                      <tr className="bg-muted/60">
                        {IPED_BANDS.map((b) => (
                          <th key={b.value} className="border px-2 py-1 w-12">
                            {b.label}
                          </th>
                        ))}
                        {PWD_FOURPS_CATEGORIES.map((c) => (
                          <Fragment key={c.value}>
                            <th
                              className="border px-2 py-1 w-16"
                            >
                              MALE
                            </th>
                            <th
                              className="border px-2 py-1 w-16"
                            >
                              FEMALE
                            </th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {schoolRows.map((r, index) => {
                        const bands = schoolTypeBands(r.school_type);
                        return (
                          <tr key={r.school_id} className="hover:bg-muted/30">
                            <td className="border px-2 py-1.5 text-center text-xs text-muted-foreground">
                              {index + 1}
                            </td>
                            <td className="border px-3 py-1.5 whitespace-nowrap">
                              {r.school_name}
                            </td>
                            <td className="border px-3 py-1.5 text-xs">
                              {r.district ?? "—"}
                            </td>
                            {IPED_BANDS.map((b) => (
                              <td
                                key={b.value}
                                className="border px-2 py-1.5 text-center"
                              >
                                {bands.includes(b.value) ? "✓" : ""}
                              </td>
                            ))}
                            {PWD_FOURPS_CATEGORIES.map((c) => (
                              <Fragment key={c.value}>
                                <td
                                  className="border px-2 py-1.5 text-center tabular-nums"
                                >
                                  {r[c.maleKey]}
                                </td>
                                <td
                                  className="border px-2 py-1.5 text-center tabular-nums"
                                >
                                  {r[c.femaleKey]}
                                </td>
                              </Fragment>
                            ))}
                          </tr>
                        );
                      })}
                      {schoolRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={13}
                            className="border px-3 py-8 text-center text-sm text-muted-foreground"
                          >
                            No enrolment recorded for SY {schoolYear}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {schoolRows.length > 0 && (
                      <tfoot>
                        <tr className="bg-muted/60 font-semibold">
                          <td className="border px-2 py-2" />
                          <td className="border px-3 py-2" colSpan={2}>
                            Total
                          </td>
                          <td className="border px-2 py-2" colSpan={4} />
                          {PWD_FOURPS_CATEGORIES.map((c) => (
                            <Fragment key={c.value}>
                              <td
                                className="border px-2 py-2 text-center tabular-nums"
                              >
                                {totals[c.maleKey]}
                              </td>
                              <td
                                className="border px-2 py-2 text-center tabular-nums"
                              >
                                {totals[c.femaleKey]}
                              </td>
                            </Fragment>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="grades" className="mt-4">
                <div className="overflow-x-auto border rounded-md">
                  <table className="text-sm border-collapse min-w-full">
                    <thead>
                      <tr className="bg-muted/60">
                        <th rowSpan={2} className="border px-2 py-2 w-12">
                          No.
                        </th>
                        <th rowSpan={2} className="border px-3 py-2 text-left">
                          GRADE LEVEL
                        </th>
                        {PWD_FOURPS_CATEGORIES.map((c) => (
                          <th
                            key={c.value}
                            colSpan={2}
                            className="border px-3 py-2"
                          >
                            {c.label}
                          </th>
                        ))}
                      </tr>
                      <tr className="bg-muted/60">
                        {PWD_FOURPS_CATEGORIES.map((c) => (
                          <Fragment key={c.value}>
                            <th
                              className="border px-2 py-1 w-20"
                            >
                              MALE
                            </th>
                            <th
                              className="border px-2 py-1 w-20"
                            >
                              FEMALE
                            </th>
                          </Fragment>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {gradeRows.map(([grade, counts], index) => (
                        <tr key={grade} className="hover:bg-muted/30">
                          <td className="border px-2 py-1.5 text-center text-xs text-muted-foreground">
                            {index + 1}
                          </td>
                          <td className="border px-3 py-1.5">
                            {getGradeLevelLabel(grade)}
                          </td>
                          {PWD_FOURPS_CATEGORIES.map((c) => (
                            <Fragment key={c.value}>
                              <td
                                className="border px-2 py-1.5 text-center tabular-nums"
                              >
                                {counts[c.maleKey]}
                              </td>
                              <td
                                className="border px-2 py-1.5 text-center tabular-nums"
                              >
                                {counts[c.femaleKey]}
                              </td>
                            </Fragment>
                          ))}
                        </tr>
                      ))}
                      {gradeRows.length === 0 && (
                        <tr>
                          <td
                            colSpan={8}
                            className="border px-3 py-8 text-center text-sm text-muted-foreground"
                          >
                            No enrolment recorded for SY {schoolYear}.
                          </td>
                        </tr>
                      )}
                    </tbody>
                    {gradeRows.length > 0 && (
                      <tfoot>
                        <tr className="bg-muted/60 font-semibold">
                          <td className="border px-2 py-2" />
                          <td className="border px-3 py-2">TOTAL</td>
                          {PWD_FOURPS_CATEGORIES.map((c) => (
                            <Fragment key={c.value}>
                              <td
                                className="border px-2 py-2 text-center tabular-nums"
                              >
                                {totals[c.maleKey]}
                              </td>
                              <td
                                className="border px-2 py-2 text-center tabular-nums"
                              >
                                {totals[c.femaleKey]}
                              </td>
                            </Fragment>
                          ))}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </TabsContent>
            </Tabs>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
