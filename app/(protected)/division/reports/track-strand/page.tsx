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
import { useSchoolTypeMap } from "@/hooks/useSchoolTypeMap";
import { SCHOOL_TYPES, SHS_STRANDS, getStrandLabel } from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import { exportCsv } from "@/lib/utils/exportCsv";
import { exportExcel } from "@/lib/utils/exportExcel";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { ChevronDown, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

interface Row {
  school_id: number;
  school_name: string;
  school_type: string | null;
  track?: string; // submitted rows only; the live RPC derives it from the strand
  strand: string;
  grade_level: number;
  male: number;
  female: number;
  total: number;
  status: "draft" | "submitted" | "locked" | "missing";
  /** Where this school's figures came from. */
  source: "live" | "submitted";
}

interface SchoolAgg {
  school_id: number;
  school_name: string;
  status: Row["status"];
  male: number;
  female: number;
  total: number;
  byStrand: Map<string, { male: number; female: number; total: number }>;
  byStrandGrade: Map<string, Row>;
  source: Row["source"];
}

export default function Page() {
  const [sy, setSy] = useState(getCurrentSchoolYear());
  const [semester, setSemester] = useState<1 | 2>(1);
  const [schoolType, setSchoolType] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const schoolTypeMap = useSchoolTypeMap();

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      const args = {
        p_school_year: sy,
        p_semester: semester,
        p_grade_level: null,
      };

      // Derived figures where the school has recorded its section strands
      // (migration 145), the submitted form where it has not. Preference is
      // per school, so the report stays usable through a rollout in which
      // some schools have filled the strands in and others have not yet.
      const [liveRes, subRes] = await Promise.all([
        supabase.rpc("division_track_strand_actual", args),
        supabase.rpc("division_track_strand_summary", args),
      ]);
      if (!isMounted) return;

      // PGRST202 = migration 145 not applied yet; fall back entirely.
      if (liveRes.error && liveRes.error.code !== "PGRST202") {
        toast.error(liveRes.error.message);
      }
      if (subRes.error) {
        toast.error(subRes.error.message);
      }

      const live = ((liveRes.data as Row[]) || []).map((r) => ({
        ...r,
        source: "live" as const,
      }));
      const schoolsWithLive = new Set(live.map((r) => Number(r.school_id)));
      const submitted = ((subRes.data as Row[]) || [])
        .filter((r) => !schoolsWithLive.has(Number(r.school_id)))
        .map((r) => ({ ...r, source: "submitted" as const }));

      setRows([...live, ...submitted]);
      setLoading(false);
    };
    fetch();
    return () => {
      isMounted = false;
    };
  }, [sy, semester]);

  const filteredRows = useMemo(() => {
    if (schoolType === "all") return rows;
    return rows.filter((r) => {
      const t = r.school_type ?? schoolTypeMap.get(Number(r.school_id));
      return t === schoolType;
    });
  }, [rows, schoolType, schoolTypeMap]);

  const { schools, strandsInUse } = useMemo(() => {
    const map = new Map<number, SchoolAgg>();
    const strandSet = new Set<string>();

    for (const r of filteredRows) {
      const id = Number(r.school_id);
      let agg = map.get(id);
      if (!agg) {
        agg = {
          school_id: id,
          school_name: r.school_name,
          status: r.status,
          male: 0,
          female: 0,
          total: 0,
          byStrand: new Map(),
          byStrandGrade: new Map(),
          source: r.source,
        };
        map.set(id, agg);
      }
      if (r.strand) {
        strandSet.add(r.strand);
        agg.male += Number(r.male || 0);
        agg.female += Number(r.female || 0);
        agg.total += Number(r.total || 0);
        const prev = agg.byStrand.get(r.strand) ?? {
          male: 0,
          female: 0,
          total: 0,
        };
        prev.male += Number(r.male || 0);
        prev.female += Number(r.female || 0);
        prev.total += Number(r.total || 0);
        agg.byStrand.set(r.strand, prev);
        agg.byStrandGrade.set(`${r.strand}|${r.grade_level}`, r);
      }
    }

    const schools = Array.from(map.values()).sort((a, b) =>
      a.school_name.localeCompare(b.school_name),
    );
    const strandsInUse = SHS_STRANDS.map((s) => s.code).filter((c) =>
      strandSet.has(c),
    );
    return { schools, strandsInUse };
  }, [filteredRows]);

  const grandTotals = useMemo(() => {
    const byStrand = new Map<string, number>();
    let grand = 0;
    for (const s of schools) {
      for (const code of strandsInUse) {
        const v = s.byStrand.get(code)?.total ?? 0;
        byStrand.set(code, (byStrand.get(code) ?? 0) + v);
      }
      grand += s.total;
    }
    return { byStrand, grand };
  }, [schools, strandsInUse]);

  const exportRows = () =>
    schools.map((s) => {
      const row: Record<string, string | number> = { School: s.school_name };
      for (const code of strandsInUse) {
        row[getStrandLabel(code)] = s.byStrand.get(code)?.total ?? 0;
      }
      row.Total = s.total;
      return row;
    });

  const headers = ["School", ...strandsInUse.map(getStrandLabel), "Total"];

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // "Live" means the school has recorded strands on its SHS sections and the
  // figures are derived; otherwise this falls back to the submitted form, and
  // the badge says which state that submission is in.
  const sourceBadge = (s: SchoolAgg) =>
    s.source === "live" ? <Badge>Live</Badge> : statusBadge(s.status);

  const statusBadge = (s: Row["status"]) => {
    if (s === "missing") return <Badge variant="outline">Not submitted</Badge>;
    if (s === "draft") return <Badge variant="outline">Draft</Badge>;
    if (s === "submitted") return <Badge>Submitted</Badge>;
    return <Badge variant="secondary">Locked</Badge>;
  };

  const activeFilters = [
    { label: `SY: ${sy}`, onClear: () => setSy(getCurrentSchoolYear()) },
    { label: `Sem ${semester}`, onClear: () => setSemester(1) },
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
      title="Track & Strand"
      description="SHS learners per school, grouped by strand. Derived live from section strands where a school has recorded them, otherwise from its submitted form. Click a school to expand Grade 11 / Grade 12 breakdown."
      loading={loading}
      recordCount={schools.length}
      exportDisabled={schools.length === 0}
      onExportCsv={() =>
        exportCsv(exportRows(), headers, `track_strand_${sy}_sem${semester}.csv`)
      }
      onExportExcel={() =>
        exportExcel(
          exportRows(),
          `track_strand_${sy}_sem${semester}.xlsx`,
          "Track & Strand",
        )
      }
      activeFilters={activeFilters}
      onClearFilters={() => {
        setSy(getCurrentSchoolYear());
        setSemester(1);
        setSchoolType("all");
      }}
      filterBar={
        <>
          <SchoolYearFilter value={sy} onChange={setSy} />
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Semester</Label>
            <Select
              value={String(semester)}
              onValueChange={(v) => setSemester(Number(v) as 1 | 2)}
            >
              <SelectTrigger className="h-9 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Sem 1</SelectItem>
                <SelectItem value="2">Sem 2</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <SchoolTypeFilter value={schoolType} onChange={setSchoolType} />
        </>
      }
    >
      {schools.length === 0 || strandsInUse.length === 0 ? (
        <EmptyReportState message="No schools have submitted Track & Strand data for this semester." />
      ) : (
        <ReportTableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>School</TableHead>
                <TableHead>Source</TableHead>
                {strandsInUse.map((code) => (
                  <TableHead key={code} className="text-right">
                    {getStrandLabel(code)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.map((s) => (
                <Fragment key={s.school_id}>
                  <TableRow>
                    <TableCell>
                      {s.total > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => toggle(s.school_id)}
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
                    <TableCell>{sourceBadge(s)}</TableCell>
                    {strandsInUse.map((code) => (
                      <TableCell key={code} className="text-right">
                        {s.byStrand.get(code)?.total ?? 0}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-medium">
                      {s.total}
                    </TableCell>
                  </TableRow>
                  {expanded.has(s.school_id) && (
                    <TableRow className="bg-muted/20">
                      <TableCell />
                      <TableCell colSpan={3 + strandsInUse.length}>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Strand</TableHead>
                              <TableHead>Grade</TableHead>
                              <TableHead className="text-right">Male</TableHead>
                              <TableHead className="text-right">
                                Female
                              </TableHead>
                              <TableHead className="text-right">Total</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {strandsInUse.flatMap((code) =>
                              [11, 12].map((gl) => {
                                const r = s.byStrandGrade.get(`${code}|${gl}`);
                                if (!r || r.total === 0) return null;
                                return (
                                  <TableRow key={`${code}-${gl}`}>
                                    <TableCell>{getStrandLabel(code)}</TableCell>
                                    <TableCell>G{gl}</TableCell>
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
                              }),
                            )}
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
                <TableCell />
                {strandsInUse.map((code) => (
                  <TableCell key={code} className="text-right">
                    {grandTotals.byStrand.get(code) ?? 0}
                  </TableCell>
                ))}
                <TableCell className="text-right">{grandTotals.grand}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ReportTableCard>
      )}
    </DivisionReportShell>
  );
}
