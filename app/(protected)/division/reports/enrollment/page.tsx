"use client";

import {
  DivisionReportShell,
  EmptyReportState,
  ReportTableCard,
} from "@/components/division-reports/DivisionReportShell";
import { SchoolTypeFilter } from "@/components/division-reports/SchoolTypeFilter";
import { SchoolYearFilter } from "@/components/division-reports/SchoolYearFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getGradeLevelLabel, SCHOOL_TYPES } from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import { exportCsv } from "@/lib/utils/exportCsv";
import { exportExcel } from "@/lib/utils/exportExcel";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

type Category =
  | "enrollment"
  | "transfer_in"
  | "transfer_out"
  | "dropout"
  | "promotee"
  | "repeater"
  | "balik_aral"
  | "fourps";

type Modality = "all" | "face_to_face" | "blended" | "modular" | "online";

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "enrollment", label: "Enrollment (Total)" },
  { value: "transfer_in", label: "Transfer In" },
  { value: "transfer_out", label: "Transfer Out" },
  { value: "dropout", label: "Dropout" },
  { value: "promotee", label: "Promotee" },
  { value: "repeater", label: "Repeater" },
  { value: "balik_aral", label: "Balik-Aral" },
  { value: "fourps", label: "4Ps" },
];

const MODALITIES: { value: Modality; label: string }[] = [
  { value: "all", label: "All / Combined" },
  { value: "face_to_face", label: "Face-to-Face" },
  { value: "blended", label: "Blended" },
  { value: "modular", label: "Modular" },
  { value: "online", label: "Online" },
];

interface Row {
  school_id: number;
  school_name: string;
  school_type: string | null;
  grade_level: number;
  male: number;
  female: number;
  total: number;
  status: "draft" | "submitted" | "locked" | "missing";
}

interface SchoolTotals {
  school_id: number;
  school_name: string;
  status: Row["status"];
  male: number;
  female: number;
  total: number;
  byGrade: Map<number, Row>;
}

export default function Page() {
  const [sy, setSy] = useState(getCurrentSchoolYear());
  const [category, setCategory] = useState<Category>("enrollment");
  const [modality, setModality] = useState<Modality>("all");
  const [schoolType, setSchoolType] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Only "Enrollment (Total)" at modality "All" can be derived from live
  // enrollment records — the same single combination the school-side autofill
  // supports. Every other category (transfer in/out, dropout, promotee,
  // repeater, balik-aral, 4Ps) and every specific modality has no operational
  // source, so those still read what the school submitted.
  const isLive = category === "enrollment" && modality === "all";

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      const fetchSubmitted = () =>
        supabase.rpc("division_enrollment_summary", {
          p_school_year: sy,
          p_semester: null,
          p_category: category,
          p_modality: modality,
          p_school_type: schoolType === "all" ? null : schoolType,
        });

      let { data, error } = isLive
        ? await supabase.rpc("division_enrollment_actual", {
            p_school_year: sy,
            p_semester: null,
            p_school_type: schoolType === "all" ? null : schoolType,
          })
        : await fetchSubmitted();

      // PGRST202 = no such function. Migration 140 may not be applied yet;
      // fall back to the submitted figures so the page still renders.
      if (isLive && error?.code === "PGRST202") {
        ({ data, error } = await fetchSubmitted());
      }

      if (!isMounted) return;
      if (error) {
        toast.error(error.message);
        setRows([]);
      } else {
        setRows((data as Row[]) || []);
      }
      setLoading(false);
    };
    fetch();
    return () => {
      isMounted = false;
    };
  }, [sy, category, modality, schoolType, isLive]);

  const { schoolRows, grades, grandTotals } = useMemo(() => {
    const schoolMap = new Map<number, SchoolTotals>();
    const gradeSet = new Set<number>();

    for (const r of rows) {
      const id = Number(r.school_id);
      let agg = schoolMap.get(id);
      if (!agg) {
        agg = {
          school_id: id,
          school_name: r.school_name,
          status: r.status,
          male: 0,
          female: 0,
          total: 0,
          byGrade: new Map(),
        };
        schoolMap.set(id, agg);
      }
      if (r.grade_level !== -99) {
        agg.male += Number(r.male || 0);
        agg.female += Number(r.female || 0);
        agg.total += Number(r.total || 0);
        agg.byGrade.set(r.grade_level, r);
        gradeSet.add(r.grade_level);
      }
    }

    const sortedSchools = Array.from(schoolMap.values()).sort((a, b) =>
      a.school_name.localeCompare(b.school_name),
    );
    const sortedGrades = Array.from(gradeSet).sort((a, b) => a - b);

    const grandTotals = sortedSchools.reduce(
      (acc, s) => ({
        male: acc.male + s.male,
        female: acc.female + s.female,
        total: acc.total + s.total,
      }),
      { male: 0, female: 0, total: 0 },
    );

    return { schoolRows: sortedSchools, grades: sortedGrades, grandTotals };
  }, [rows]);

  // The Submission badge describes where the figures came from, so it belongs
  // only on the submission-backed categories. On the live categories the
  // numbers come from enrollment records and the badge would be describing
  // something else entirely — whether the school also filed the DepEd form,
  // which is what /division/reports/schools/[id] is for.
  const exportRows = () =>
    schoolRows.map((s) => ({
      School: s.school_name,
      ...(isLive ? {} : { Submission: s.status }),
      Male: s.male,
      Female: s.female,
      Total: s.total,
    }));

  const headers = isLive
    ? ["School", "Male", "Female", "Total"]
    : ["School", "Submission", "Male", "Female", "Total"];

  const toggleExpand = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const statusBadge = (s: Row["status"]) => {
    if (s === "missing") return <Badge variant="outline">Not submitted</Badge>;
    if (s === "draft") return <Badge variant="outline">Draft</Badge>;
    if (s === "submitted") return <Badge>Submitted</Badge>;
    return <Badge variant="secondary">Locked</Badge>;
  };

  const activeFilters = [
    { label: `SY: ${sy}`, onClear: () => setSy(getCurrentSchoolYear()) },
    ...(category !== "enrollment"
      ? [
          {
            label: `Category: ${
              CATEGORIES.find((c) => c.value === category)?.label ?? category
            }`,
            onClear: () => setCategory("enrollment"),
          },
        ]
      : []),
    ...(modality !== "all"
      ? [
          {
            label: `Modality: ${
              MODALITIES.find((m) => m.value === modality)?.label ?? modality
            }`,
            onClear: () => setModality("all"),
          },
        ]
      : []),
    ...(schoolType !== "all"
      ? [
          {
            label: `Type: ${
              SCHOOL_TYPES.find((t) => t.value === schoolType)?.label ??
              schoolType
            }`,
            onClear: () => setSchoolType("all"),
          },
        ]
      : []),
  ];

  return (
    <DivisionReportShell
      title="Enrollment"
      description={
        isLive
          ? "Per-school learner counts by grade level and sex, computed live from enrollment records. No school submission required. To see which schools have filed the DepEd form, open a school."
          : "Per-school learner counts by grade level, category, and modality, as submitted by each school."
      }
      loading={loading}
      recordCount={schoolRows.length}
      exportDisabled={schoolRows.length === 0}
      onExportCsv={() =>
        exportCsv(exportRows(), headers, `enrollment_${sy}.csv`)
      }
      onExportExcel={() =>
        exportExcel(exportRows(), `enrollment_${sy}.xlsx`, "Enrollment")
      }
      activeFilters={activeFilters}
      onClearFilters={() => {
        setSy(getCurrentSchoolYear());
        setCategory("enrollment");
        setModality("all");
        setSchoolType("all");
      }}
      filterBar={
        <>
          <SchoolYearFilter value={sy} onChange={setSy} />
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as Category)}
            >
              <SelectTrigger className="h-9 w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Modality</Label>
            <Select
              value={modality}
              onValueChange={(v) => setModality(v as Modality)}
            >
              <SelectTrigger className="h-9 w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODALITIES.map((m) => (
                  <SelectItem key={m.value} value={m.value}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <SchoolTypeFilter value={schoolType} onChange={setSchoolType} />
        </>
      }
    >
      {schoolRows.length === 0 ? (
        <EmptyReportState message="No schools match the current filter." />
      ) : (
        <ReportTableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>School</TableHead>
                {!isLive && <TableHead>Submission</TableHead>}
                <TableHead className="text-right">Male</TableHead>
                <TableHead className="text-right">Female</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schoolRows.map((s) => (
                <Fragment key={s.school_id}>
                  <TableRow>
                    <TableCell>
                      {s.total > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => toggleExpand(s.school_id)}
                        >
                          {expanded.has(s.school_id) ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/division/reports/schools/${s.school_id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.school_name}
                      </Link>
                    </TableCell>
                    {!isLive && <TableCell>{statusBadge(s.status)}</TableCell>}
                    <TableCell className="text-right">{s.male}</TableCell>
                    <TableCell className="text-right">{s.female}</TableCell>
                    <TableCell className="text-right font-medium">
                      {s.total}
                    </TableCell>
                  </TableRow>
                  {expanded.has(s.school_id) && s.total > 0 && (
                    <TableRow
                      key={`${s.school_id}-expanded`}
                      className="bg-muted/20"
                    >
                      <TableCell />
                      <TableCell colSpan={isLive ? 4 : 5}>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Grade Level</TableHead>
                              <TableHead className="text-right">Male</TableHead>
                              <TableHead className="text-right">
                                Female
                              </TableHead>
                              <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {grades.map((gl) => {
                              const r = s.byGrade.get(gl);
                              if (!r) return null;
                              return (
                                <TableRow key={gl}>
                                  <TableCell>
                                    {getGradeLevelLabel(gl)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {r.male}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {r.female}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {r.total}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
              <TableRow className="border-t-2 font-bold bg-muted/40">
                <TableCell />
                <TableCell>Division Total</TableCell>
                {!isLive && <TableCell />}
                <TableCell className="text-right">{grandTotals.male}</TableCell>
                <TableCell className="text-right">
                  {grandTotals.female}
                </TableCell>
                <TableCell className="text-right">{grandTotals.total}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ReportTableCard>
      )}
    </DivisionReportShell>
  );
}
