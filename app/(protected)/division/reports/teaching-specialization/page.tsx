"use client";

import {
  DivisionReportShell,
  EmptyReportState,
  ReportTableCard,
} from "@/components/division-reports/DivisionReportShell";
import { SchoolTypeFilter } from "@/components/division-reports/SchoolTypeFilter";
import { SchoolYearFilter } from "@/components/division-reports/SchoolYearFilter";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSchoolTypeMap } from "@/hooks/useSchoolTypeMap";
import {
  LEARNING_AREAS,
  SCHOOL_TYPES,
  getLearningAreaLabel,
} from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import { exportCsv } from "@/lib/utils/exportCsv";
import { exportExcel } from "@/lib/utils/exportExcel";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

interface Row {
  school_id: number;
  school_name: string;
  school_type: string | null;
  learning_area: string;
  male: number;
  female: number;
  total: number;
  status: "draft" | "submitted" | "locked" | "missing";
  /** Where this school's figures came from. */
  source: "live" | "submitted";
}

export default function Page() {
  const [sy, setSy] = useState(getCurrentSchoolYear());
  const [schoolType, setSchoolType] = useState<string>("all");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const schoolTypeMap = useSchoolTypeMap();

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      // sms_users holds who works here NOW — it has no school year — so the
      // derived figures describe today's staff and can only stand in for the
      // CURRENT school year. For any past year the submitted form is the more
      // truthful record (migration 146).
      const canDerive = sy === getCurrentSchoolYear();

      const [liveRes, subRes] = await Promise.all([
        canDerive
          ? supabase.rpc("division_teaching_specialization_actual", {
              p_school_year: sy,
            })
          : Promise.resolve({ data: null, error: null }),
        supabase.rpc("division_teaching_specialization_summary", {
          p_school_year: sy,
        }),
      ]);
      if (!isMounted) return;

      // PGRST202 = migration 146 not applied yet; fall back entirely.
      if (liveRes.error && liveRes.error.code !== "PGRST202") {
        toast.error(liveRes.error.message);
      }
      if (subRes.error) {
        toast.error(subRes.error.message);
      }

      const live = ((liveRes.data as Row[] | null) || []).map((r) => ({
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
  }, [sy]);

  const filteredRows = useMemo(() => {
    if (schoolType === "all") return rows;
    return rows.filter((r) => {
      const t = r.school_type ?? schoolTypeMap.get(Number(r.school_id));
      return t === schoolType;
    });
  }, [rows, schoolType, schoolTypeMap]);

  const { schools, areasInUse, matrix, rowTotals, colTotals, grandTotal } =
    useMemo(() => {
      const schoolMap = new Map<
        number,
        { id: number; name: string; status: Row["status"] }
      >();
      const counts = new Map<string, number>();
      const areaSet = new Set<string>();

      for (const r of filteredRows) {
        schoolMap.set(Number(r.school_id), {
          id: Number(r.school_id),
          name: r.school_name,
          status: r.status,
        });
        if (r.learning_area) {
          areaSet.add(r.learning_area);
          const key = `${r.school_id}|${r.learning_area}`;
          counts.set(key, (counts.get(key) ?? 0) + Number(r.total || 0));
        }
      }

      const schools = Array.from(schoolMap.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      const areasInUse = LEARNING_AREAS.map((a) => a.code).filter((c) =>
        areaSet.has(c),
      );
      const matrix: number[][] = schools.map((s) =>
        areasInUse.map((a) => counts.get(`${s.id}|${a}`) ?? 0),
      );
      const rowTotals = matrix.map((row) => row.reduce((a, b) => a + b, 0));
      const colTotals = areasInUse.map((_, ci) =>
        matrix.reduce((sum, row) => sum + row[ci], 0),
      );
      const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

      return {
        schools,
        areasInUse,
        matrix,
        rowTotals,
        colTotals,
        grandTotal,
      };
    }, [filteredRows]);

  const exportRows = () =>
    schools.map((s, ri) => {
      const row: Record<string, string | number> = { School: s.name };
      areasInUse.forEach((a, ci) => {
        row[getLearningAreaLabel(a)] = matrix[ri][ci];
      });
      row.Total = rowTotals[ri];
      return row;
    });

  const headers = ["School", ...areasInUse.map(getLearningAreaLabel), "Total"];

  const statusBadge = (s: Row["status"]) => {
    if (s === "missing") return <Badge variant="outline">Not submitted</Badge>;
    if (s === "draft") return <Badge variant="outline">Draft</Badge>;
    if (s === "submitted") return <Badge>Submitted</Badge>;
    return <Badge variant="secondary">Locked</Badge>;
  };

  const activeFilters = [
    { label: `SY: ${sy}`, onClear: () => setSy(getCurrentSchoolYear()) },
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
      title="Teaching Specialization"
      description="Teachers per school by primary learning area (Filipino, English, Math, etc.)."
      loading={loading}
      recordCount={schools.length}
      exportDisabled={schools.length === 0}
      onExportCsv={() =>
        exportCsv(exportRows(), headers, `teaching_specialization_${sy}.csv`)
      }
      onExportExcel={() =>
        exportExcel(
          exportRows(),
          `teaching_specialization_${sy}.xlsx`,
          "Teaching Specialization",
        )
      }
      activeFilters={activeFilters}
      onClearFilters={() => {
        setSy(getCurrentSchoolYear());
        setSchoolType("all");
      }}
      filterBar={
        <>
          <SchoolYearFilter value={sy} onChange={setSy} />
          <SchoolTypeFilter value={schoolType} onChange={setSchoolType} />
        </>
      }
    >
      {schools.length === 0 || areasInUse.length === 0 ? (
        <EmptyReportState message="No schools have submitted Teaching Specialization data for this SY." />
      ) : (
        <ReportTableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>School</TableHead>
                <TableHead>Status</TableHead>
                {areasInUse.map((a) => (
                  <TableHead key={a} className="text-right">
                    {getLearningAreaLabel(a)}
                  </TableHead>
                ))}
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {schools.map((s, ri) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <Link
                      href={`/division/reports/schools/${s.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {s.name}
                    </Link>
                  </TableCell>
                  <TableCell>{statusBadge(s.status)}</TableCell>
                  {matrix[ri].map((v, ci) => (
                    <TableCell key={ci} className="text-right">
                      {v}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium">
                    {rowTotals[ri]}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 font-bold bg-muted/40">
                <TableCell>Division Total</TableCell>
                <TableCell />
                {colTotals.map((v, ci) => (
                  <TableCell key={ci} className="text-right">
                    {v}
                  </TableCell>
                ))}
                <TableCell className="text-right">{grandTotal}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </ReportTableCard>
      )}
    </DivisionReportShell>
  );
}
