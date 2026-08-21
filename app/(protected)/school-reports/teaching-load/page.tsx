"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { generateTeachingLoadPrint } from "@/lib/pdf";
import { useAppSelector } from "@/lib/redux/hook";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import {
  advisorshipWeeklyMinutes,
  aralWeeklyMinutes,
  fetchTeacherLoads,
  TeacherLoad,
  teacherWeeklyTotal,
  WEEKDAYS,
} from "@/lib/utils/teachingLoad";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ALL_TEACHERS, ReportFilters } from "../components/ReportFilters";
import {
  ReportAccessDenied,
  ReportShell,
  useCanViewReports,
} from "../components/ReportShell";

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const canView = useCanViewReports();
  const schoolId = user?.school_id;

  const [schoolYear, setSchoolYear] = useState(getCurrentSchoolYear());
  const [teacherId, setTeacherId] = useState(ALL_TEACHERS);
  const [loads, setLoads] = useState<TeacherLoad[]>([]);
  const [outsideStaffCount, setOutsideStaffCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const { settings } = useSchoolSettings(Boolean(schoolId), schoolId);

  useEffect(() => {
    let isMounted = true;
    if (!canView || !schoolId) {
      setLoads([]);
      setOutsideStaffCount(0);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const { loads: data, outsideStaffCount } = await fetchTeacherLoads(
          schoolId,
          schoolYear,
        );
        if (!isMounted) return;
        setLoads(data);
        setOutsideStaffCount(outsideStaffCount);
      } catch (err) {
        console.error("Error loading teaching load:", err);
        if (!isMounted) return;
        toast.error("Failed to load report");
        setLoads([]);
        setOutsideStaffCount(0);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [canView, schoolId, schoolYear]);

  // The teacher filter only offers names that actually carry load.
  const teacherOptions = useMemo(
    () =>
      loads
        .map((t) => ({ id: t.teacherId, name: t.teacherName }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [loads],
  );

  const visibleLoads = useMemo(
    () =>
      teacherId === ALL_TEACHERS
        ? loads
        : loads.filter((t) => t.teacherId === teacherId),
    [loads, teacherId],
  );

  const teacherLabel =
    teacherId === ALL_TEACHERS
      ? "All Teachers"
      : (teacherOptions.find((t) => t.id === teacherId)?.name ??
        "All Teachers");

  const handlePrint = async () => {
    if (!schoolId) return;
    try {
      await generateTeachingLoadPrint({
        schoolId,
        schoolYear,
        teacherLabel,
        loads: visibleLoads,
        preparedBy: user?.name ?? "",
        principalName: settings.principal_name,
        principalTitle: settings.principal_title,
      });
    } catch (err) {
      console.error("Error printing teaching load:", err);
      toast.error("Failed to generate PDF");
    }
  };

  if (!canView) return <ReportAccessDenied />;

  return (
    <ReportShell
      title="Teaching Load (minutes per day)"
      description={`SY ${schoolYear} — daily teaching minutes per teacher`}
      onPrint={handlePrint}
      printDisabled={loading || visibleLoads.length === 0}
      filters={
        <ReportFilters
          schoolYear={schoolYear}
          onSchoolYearChange={setSchoolYear}
          teacherId={teacherId}
          onTeacherChange={setTeacherId}
          teacherOptions={teacherOptions}
        />
      }
    >
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : visibleLoads.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No teaching load found for SY {schoolYear}.
        </p>
      ) : (
        <>
          <div className="app__table_shell">
            <div className="app__table_wrapper">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left font-medium">Teacher</th>
                    {WEEKDAYS.map((d) => (
                      <th
                        key={d.idx}
                        className="text-right font-medium w-14"
>
                        {d.label}
                      </th>
                    ))}
                    <th className="text-right font-medium w-24">
                      Advisorship
                    </th>
                    <th className="text-right font-medium w-16">
                      ARAL
                    </th>
                    <th className="text-right font-medium w-20">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleLoads.map((t) => {
                    const advisorshipMin = advisorshipWeeklyMinutes(t);
                    const aralMin = aralWeeklyMinutes(t);
                    const weekTotal = teacherWeeklyTotal(t);
                    return (
                      <tr key={t.teacherId}>
                        <td className="font-medium">
                          {t.teacherName}
                        </td>
                        {WEEKDAYS.map((d) => {
                          const m = t.minutes[d.idx] || 0;
                          return (
                            <td
                              key={d.idx}
                              className={`text-right ${
                                m === 0 ? "text-muted-foreground/40" : ""
                              }`}
>
                              {m}
                            </td>
                          );
                        })}
                        <td
                          className={`text-right ${
                            advisorshipMin === 0 ? "text-muted-foreground/40" : ""
                          }`}
>
                          {advisorshipMin}
                        </td>
                        <td
                          className={`text-right ${
                            aralMin === 0 ? "text-muted-foreground/40" : ""
                          }`}
>
                          {aralMin}
                        </td>
                        <td className="text-right font-semibold">
                          {weekTotal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-muted-foreground italic">
            Advisorship = 60 min/day × 5 days per advisory class. ARAL = 30
            min/day × 5 days per assigned group. All figures in minutes.
          </p>
        </>
      )}
      {!loading && outsideStaffCount > 0 && (
        <p className="text-xs text-amber-600 mt-2">
          {outsideStaffCount === 1
            ? "1 assignment references a staff member who no longer belongs to this school and is not counted above."
            : `${outsideStaffCount} assignments reference staff who no longer belong to this school and are not counted above.`}{" "}
          Check the subject schedules, section advisers, and ARAL tutors for SY{" "}
          {schoolYear}.
        </p>
      )}
    </ReportShell>
  );
}
