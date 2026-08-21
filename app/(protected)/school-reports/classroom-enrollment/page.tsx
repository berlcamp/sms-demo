"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { getGradeLevelLabel } from "@/lib/constants";
import { generateClassroomEnrollmentPrint } from "@/lib/pdf";
import { useAppSelector } from "@/lib/redux/hook";
import {
  ClassroomEnrollmentRow,
  fetchClassroomEnrollment,
} from "@/lib/utils/classroomEnrollment";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import {
  ReportAccessDenied,
  ReportShell,
  useCanViewReports,
} from "../components/ReportShell";

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const canView = useCanViewReports();
  const schoolId = user?.school_id;

  // The report is always the current school year — there is no year filter.
  const schoolYear = getCurrentSchoolYear();

  const [rows, setRows] = useState<ClassroomEnrollmentRow[]>([]);
  const [loading, setLoading] = useState(false);

  const { settings } = useSchoolSettings(Boolean(schoolId), schoolId);

  useEffect(() => {
    let isMounted = true;
    if (!canView || !schoolId) {
      setRows([]);
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const data = await fetchClassroomEnrollment(schoolId, schoolYear);
        if (!isMounted) return;
        setRows(data);
      } catch (err) {
        console.error("Error loading classroom enrollment:", err);
        if (!isMounted) return;
        toast.error("Failed to load report");
        setRows([]);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [canView, schoolId, schoolYear]);

  const totals = useMemo(
    () => ({
      enrollees: rows.reduce((sum, r) => sum + r.enrollees, 0),
      capacity: rows.reduce((sum, r) => sum + (r.capacity ?? 0), 0),
    }),
    [rows],
  );

  const unassigned = useMemo(
    () => rows.filter((r) => !r.roomName).length,
    [rows],
  );

  const handlePrint = async () => {
    if (!schoolId) return;
    try {
      await generateClassroomEnrollmentPrint({
        schoolId,
        schoolYear,
        rows,
        preparedBy: user?.name ?? "",
        principalName: settings.principal_name,
        principalTitle: settings.principal_title,
      });
    } catch (err) {
      console.error("Error printing classroom enrollment:", err);
      toast.error("Failed to generate PDF");
    }
  };

  if (!canView) return <ReportAccessDenied />;

  return (
    <ReportShell
      title="Classroom Enrollment and Size"
      description={`SY ${schoolYear} — classroom size and actual enrollees per section`}
      onPrint={handlePrint}
      printDisabled={loading || rows.length === 0}
      filters={
        <p className="text-sm text-muted-foreground">
          Active sections for SY {schoolYear}. Classroom size and capacity come
          from the room assigned to the section — set the room on{" "}
          <span className="font-medium">Sections</span> and its dimension on{" "}
          <span className="font-medium">Rooms</span>.
          {unassigned > 0 && (
            <>
              {" "}
              <span className="text-amber-700">
                {unassigned} section{unassigned === 1 ? " has" : "s have"} no
                classroom assigned.
              </span>
            </>
          )}
        </p>
      }
    >
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No sections found for SY {schoolYear}.
        </p>
      ) : (
        <div className="app__table_shell">
          <div className="app__table_wrapper">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left font-medium w-8">#</th>
                  <th className="text-left font-medium">Grade Level</th>
                  <th className="text-left font-medium">
                    Classroom Size
                  </th>
                  <th className="text-left font-medium">
                    Section Name
                  </th>
                  <th className="text-right font-medium">Enrollees</th>
                  <th className="text-right font-medium">Capacity</th>
                  <th className="text-left font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.sectionId}>
                    <td className="text-muted-foreground">{i + 1}</td>
                    <td>
                      {getGradeLevelLabel(r.gradeLevel)}
                    </td>
                    <td>
                      {r.classroomSize || (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {r.roomName && (
                        <span className="text-muted-foreground">
                          {" "}
                          ({r.roomName})
                        </span>
                      )}
                    </td>
                    <td className="font-medium">{r.sectionName}</td>
                    <td className="text-right">{r.enrollees}</td>
                    <td className="text-right">{r.capacity ?? "—"}</td>
                    <td className="text-muted-foreground">
                      {r.remarks}
                    </td>
                  </tr>
                ))}
                <tr className="bg-muted/40 font-semibold">
                  <td colSpan={4}>
                    Total ({rows.length} section{rows.length === 1 ? "" : "s"})
                  </td>
                  <td className="text-right">{totals.enrollees}</td>
                  <td className="text-right">
                    {totals.capacity > 0 ? totals.capacity : "—"}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ReportShell>
  );
}
