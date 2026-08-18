"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ORG_NAME } from "@/lib/constants/branding";
import { TEST_SCHOOL_ID_FILTER } from "@/lib/constants/landing";
import { supabase } from "@/lib/supabase/client";
import {
  fetchPublicEnrollmentCounts,
  gradeBand,
} from "@/lib/utils/publicEnrollment";
import { Calendar, GraduationCap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";

interface SchoolLearnerRow {
  school_id: string;
  school_name: string;
  total_kinder: number;
  total_elementary: number;
  total_junior_high: number;
  total_senior_high: number;
}

function getSchoolYearOptions(): string[] {
  const now = new Date();
  const year = now.getFullYear();
  const options: string[] = [];
  for (let i = -2; i <= 2; i++) {
    const startYear = year + i;
    options.push(`${startYear}-${startYear + 1}`);
  }
  return options;
}

const getDefaultSchoolYear = getCurrentSchoolYear;

export default function LearnersPage() {
  const [schoolYear, setSchoolYear] = useState(getDefaultSchoolYear);
  const [district, setDistrict] = useState<string>("all");
  const [districts, setDistricts] = useState<string[]>([]);
  const [rows, setRows] = useState<SchoolLearnerRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDistricts = useCallback(async () => {
    const { data } = await supabase
      .from("sms_schools")
      .select("district")
      .not("id", "in", TEST_SCHOOL_ID_FILTER)
      .eq("is_active", true)
      .not("district", "is", null);

    const unique = [
      ...new Set(
        (data || []).map((d) => d.district as string).filter(Boolean),
      ),
    ].sort();
    setDistricts(unique);
  }, []);

  const fetchLearners = useCallback(async () => {
    setLoading(true);
    try {
      let schoolQuery = supabase
        .from("sms_schools")
        .select("id, school_id, name, district")
        .not("id", "in", TEST_SCHOOL_ID_FILTER)
        .eq("is_active", true);

      if (district && district !== "all") {
        schoolQuery = schoolQuery.eq("district", district);
      }

      const { data: schools, error: schoolError } = await schoolQuery.order(
        "name",
      );

      if (schoolError || !schools || schools.length === 0) {
        setRows([]);
        setLoading(false);
        return;
      }

      const counts = await fetchPublicEnrollmentCounts(schoolYear);

      const schoolMap = new Map<string, { school_id: string; name: string }>();
      schools.forEach((s) => {
        schoolMap.set(String(s.id), {
          school_id: s.school_id,
          name: s.name,
        });
      });

      const countsBySchool = new Map<
        string,
        { kinder: number; elem: number; jhs: number; shs: number }
      >();

      for (const e of counts) {
        const sid = String(e.school_id);
        if (!countsBySchool.has(sid)) {
          countsBySchool.set(sid, {
            kinder: 0,
            elem: 0,
            jhs: 0,
            shs: 0,
          });
        }
        const c = countsBySchool.get(sid)!;
        const learners = e.male + e.female;

        const band = gradeBand(e.grade_level);
        if (band === "kinder") c.kinder += learners;
        else if (band === "elementary") c.elem += learners;
        else if (band === "juniorHigh") c.jhs += learners;
        else if (band === "seniorHigh") c.shs += learners;
      }

      const result: SchoolLearnerRow[] = schools.map((s) => {
        const info = schoolMap.get(String(s.id)) ?? {
          school_id: s.school_id,
          name: s.name,
        };
        const counts = countsBySchool.get(String(s.id)) ?? {
          kinder: 0,
          elem: 0,
          jhs: 0,
          shs: 0,
        };
        return {
          school_id: info.school_id,
          school_name: info.name,
          total_kinder: counts.kinder,
          total_elementary: counts.elem,
          total_junior_high: counts.jhs,
          total_senior_high: counts.shs,
        };
      });

      setRows(result);
    } catch (err) {
      console.error("Learners fetch error:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [schoolYear, district]);

  useEffect(() => {
    fetchDistricts();
  }, [fetchDistricts]);

  useEffect(() => {
    fetchLearners();
  }, [fetchLearners]);

  const totalLearners = rows.reduce(
    (acc, r) =>
      acc +
      r.total_kinder +
      r.total_elementary +
      r.total_junior_high +
      r.total_senior_high,
    0,
  );

  return (
    <div className="paper-ground paper-grain font-ui relative min-h-screen pb-20 text-[var(--ink-2)]">
      {/* Masthead */}
      <header className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-28 sm:px-6 sm:pb-16 sm:pt-36 lg:px-8">
          <div className="animate-fade-up">
            <p className="label-data flex items-center gap-3 text-[var(--brass)]">
              <GraduationCap className="h-3.5 w-3.5" strokeWidth={1.75} />
              {ORG_NAME}
            </p>
            <h1 className="font-display mt-4 text-4xl leading-[1.05] tracking-tight text-[var(--ink)] sm:text-5xl">
              Learners by School
            </h1>
            <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-[var(--ink-2)]">
              Approved enrollment per grade band for every school in the
              division, for the school year selected.
            </p>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        {/* Filters */}
        <div className="mb-8 flex flex-wrap items-end gap-x-8 gap-y-5 border-b border-[var(--rule)] pb-6">
          <div className="flex flex-col gap-2">
            <label className="label-data flex items-center gap-2 text-[var(--ink-3)]">
              <Calendar className="h-3 w-3" strokeWidth={1.75} />
              School year
            </label>
            <Select value={schoolYear} onValueChange={setSchoolYear}>
              <SelectTrigger className="font-data w-[160px] rounded-sm border-[var(--rule)] bg-[var(--paper-raised)] text-[13px] text-[var(--ink)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-sm border-[var(--rule)] bg-[var(--paper-raised)]">
                {getSchoolYearOptions().map((sy) => (
                  <SelectItem key={sy} value={sy} className="font-data text-[13px]">
                    {sy}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <label className="label-data text-[var(--ink-3)]">District</label>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger className="w-[190px] rounded-sm border-[var(--rule)] bg-[var(--paper-raised)] text-[13px] text-[var(--ink)]">
                <SelectValue placeholder="All districts" />
              </SelectTrigger>
              <SelectContent className="rounded-sm border-[var(--rule)] bg-[var(--paper-raised)]">
                <SelectItem value="all" className="text-[13px]">
                  All districts
                </SelectItem>
                {districts.map((d) => (
                  <SelectItem key={d} value={d} className="text-[13px]">
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!loading && rows.length > 0 && (
            <div className="ml-auto text-right">
              <p className="label-data text-[var(--ink-3)]">Total learners</p>
              <p className="font-data mt-1 text-2xl leading-none text-[var(--ink)]">
                {totalLearners.toLocaleString()}
              </p>
            </div>
          )}
        </div>

        {/* Table */}
        {loading ? (
          <div className="border-t border-[var(--rule)]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-4 border-b border-[var(--rule)] py-4"
              >
                <Skeleton className="h-4 w-20 rounded-sm bg-[var(--rule-faint)]" />
                <Skeleton className="h-4 flex-1 rounded-sm bg-[var(--rule-faint)]" />
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton
                    key={j}
                    className="h-4 w-14 rounded-sm bg-[var(--rule-faint)]"
                  />
                ))}
              </div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="border border-dashed border-[var(--rule)] py-20 text-center">
            <p className="font-display text-lg text-[var(--ink)]">
              Nothing matches these filters
            </p>
            <p className="font-data mt-2 text-[11px] text-[var(--ink-3)]">
              Try another school year or district.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border-t-2 border-[var(--ink)]">
            <Table>
              <TableHeader>
                <TableRow className="border-[var(--rule)] hover:bg-transparent">
                  <TableHead className="label-data h-auto py-3 text-[var(--ink-3)]">
                    School ID
                  </TableHead>
                  <TableHead className="label-data h-auto py-3 text-[var(--ink-3)]">
                    School Name
                  </TableHead>
                  {["SNED / Kinder", "Elementary", "Junior High", "Senior High"].map(
                    (h) => (
                      <TableHead
                        key={h}
                        className="label-data h-auto py-3 text-right text-[var(--ink-3)]"
                      >
                        {h}
                      </TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow
                    key={`${r.school_id}-${i}`}
                    className="border-[var(--rule)] transition-colors hover:bg-[var(--paper-raised)]/70"
                  >
                    <TableCell className="font-data py-4 text-[13px] text-[var(--brass)]">
                      {r.school_id}
                    </TableCell>
                    <TableCell className="font-display py-4 text-[15px] text-[var(--ink)]">
                      {r.school_name}
                    </TableCell>
                    {[
                      r.total_kinder,
                      r.total_elementary,
                      r.total_junior_high,
                      r.total_senior_high,
                    ].map((n, j) => (
                      <TableCell
                        key={j}
                        className="font-data py-4 text-right text-[14px] text-[var(--ink)]"
                      >
                        {n === 0 ? (
                          <span className="text-[var(--ink-3)]">—</span>
                        ) : (
                          n.toLocaleString()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
