"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getGradeLevelLabel, isTeacherRole } from "@/lib/constants";
import {
  ENROLLMENT_STATUS_COLORS,
  ENROLLMENT_STATUS_LABELS,
  getCurrentSchoolYear,
} from "@/lib/dashboard-utils";
import { getSchoolYearOptions } from "@/lib/utils/schoolYear";
import {
  advisorshipWeeklyMinutes,
  aralWeeklyMinutes,
  fetchTeacherLoads,
  TeacherLoad,
  teacherWeeklyTotal,
  WEEKDAYS,
} from "@/lib/utils/teachingLoad";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import {
  ArrowRight,
  BookOpen,
  Building2,
  ClipboardList,
  Clock,
  FileText,
  GraduationCap,
  LayoutGrid,
  UserCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Form137Status {
  status: string;
  count: number;
}

interface QuickAction {
  title: string;
  desc: string;
  href: string;
  icon: typeof Building2;
  color: string;
}

interface SectionEnrollment {
  sectionId: string;
  sectionName: string;
  grade: number;
  count: number;
  male: number;
  female: number;
}

interface StaffBreakdown {
  teaching: number;
  nonTeaching: number;
  schoolHead: number;
  assistantSchoolHead: number;
}

export function SchoolDashboard() {
  const user = useAppSelector((state) => state.user.user);
  const [studentsCount, setStudentsCount] = useState(0);
  const [sectionsCount, setSectionsCount] = useState(0);
  const [staffCount, setStaffCount] = useState(0);
  const [enrollmentByStatus, setEnrollmentByStatus] = useState<
    { status: string; count: number }[]
  >([]);
  const [enrollmentByGrade, setEnrollmentByGrade] = useState<
    { grade: number; male: number; female: number }[]
  >([]);
  const [form137Status, setForm137Status] = useState<Form137Status[]>([]);
  const [sectionEnrollment, setSectionEnrollment] = useState<
    SectionEnrollment[]
  >([]);
  const [teacherLoads, setTeacherLoads] = useState<TeacherLoad[]>([]);
  const [loadsOutsideStaff, setLoadsOutsideStaff] = useState(0);
  const [advisory, setAdvisory] = useState<{
    withAdvisory: number;
    withoutAdvisory: number;
  }>({ withAdvisory: 0, withoutAdvisory: 0 });
  const [staffBreakdown, setStaffBreakdown] = useState<StaffBreakdown>({
    teaching: 0,
    nonTeaching: 0,
    schoolHead: 0,
    assistantSchoolHead: 0,
  });
  const [schoolYear, setSchoolYear] = useState(getCurrentSchoolYear());
  const schoolYearOptions = getSchoolYearOptions();
  const [loading, setLoading] = useState(true);
  const [schoolName, setSchoolName] = useState("");

  const schoolId = user?.school_id != null ? String(user.school_id) : null;

  const fetchDashboardData = useCallback(async () => {
    if (!schoolId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: school } = await supabase
        .from("sms_schools")
        .select("name")
        .eq("id", schoolId)
        .single();
      setSchoolName(school?.name ?? "Our School");

      const { count: sectionsCnt } = await supabase
        .from("sms_sections")
        .select("*", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .eq("school_year", schoolYear)
        .eq("is_active", true);
      setSectionsCount(sectionsCnt ?? 0);

      const { count: staffCnt } = await supabase
        .from("sms_users")
        .select("*", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .neq("type", "division_admin")
        .neq("type", "division_type");
      setStaffCount(staffCnt ?? 0);

      const { data: enrollments } = await supabase
        .from("sms_enrollments")
        .select(
          "grade_level, status, enrollment_status, section_id, student_id, student:sms_students!sms_enrollments_student_id_fkey(gender)",
        )
        .eq("school_id", schoolId)
        .eq("school_year", schoolYear);

      const statusCounts = new Map<string, number>();
      const sectionEnrollCounts = new Map<string, number>();
      // Per-section sex split. A learner whose sex is unrecorded counts in
      // `sectionEnrollCounts` but in neither column, so male + female may fall
      // short of the total — that gap is the un-encoded sex, not a lost learner.
      const sectionSexCounts = new Map<string, { male: number; female: number }>();
      const enrolledStudentIds = new Set<string>();
      const gradeCounts = Array.from({ length: 13 }, (_, i) => ({
        grade: i,
        male: 0,
        female: 0,
      }));
      enrollments?.forEach((e) => {
        if (e.status === "approved") {
          const ls = e.enrollment_status || "active";
          statusCounts.set(ls, (statusCounts.get(ls) || 0) + 1);

          if (e.student_id) enrolledStudentIds.add(String(e.student_id));

          const gender = (e.student as { gender?: string } | null)?.gender;

          if (e.section_id) {
            const sid = String(e.section_id);
            sectionEnrollCounts.set(sid, (sectionEnrollCounts.get(sid) || 0) + 1);
            const sex = sectionSexCounts.get(sid) ?? { male: 0, female: 0 };
            if (gender === "male") sex.male++;
            else if (gender === "female") sex.female++;
            sectionSexCounts.set(sid, sex);
          }

          const idx = e.grade_level;
          if (idx >= 0 && idx < 13) {
            if (gender === "male") gradeCounts[idx]!.male++;
            else if (gender === "female") gradeCounts[idx]!.female++;
          }
        }
      });
      setStudentsCount(enrolledStudentIds.size);
      setEnrollmentByStatus(
        Array.from(statusCounts.entries())
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count),
      );
      setEnrollmentByGrade(gradeCounts);

      const { data: form137 } = await supabase
        .from("sms_requests")
        .select("status")
        .eq("school_id", schoolId);
      const requestStatusCounts = new Map<string, number>();
      form137?.forEach((f) => {
        const s = f.status || "unknown";
        requestStatusCounts.set(s, (requestStatusCounts.get(s) || 0) + 1);
      });
      setForm137Status(
        Array.from(requestStatusCounts.entries())
          .map(([status, count]) => ({ status, count }))
          .sort((a, b) => b.count - a.count),
      );

      // Sections (current SY) → enrollment-per-section, advisers
      const { data: sectionsData } = await supabase
        .from("sms_sections")
        .select("id, name, grade_level, section_adviser_id")
        .eq("school_id", schoolId)
        .eq("school_year", schoolYear)
        .eq("is_active", true)
        .order("grade_level", { ascending: true })
        .order("name", { ascending: true });

      const adviserIds = new Set<string>();
      // Sections advised per teacher → advisorship load (60 min each).
      const advisoryCountByTeacher = new Map<string, number>();
      const secEnroll: SectionEnrollment[] = [];
      sectionsData?.forEach((s) => {
        if (s.section_adviser_id) {
          const aid = String(s.section_adviser_id);
          adviserIds.add(aid);
          advisoryCountByTeacher.set(
            aid,
            (advisoryCountByTeacher.get(aid) || 0) + 1,
          );
        }
        const sex = sectionSexCounts.get(String(s.id)) ?? { male: 0, female: 0 };
        secEnroll.push({
          sectionId: String(s.id),
          sectionName: s.name,
          grade: s.grade_level,
          count: sectionEnrollCounts.get(String(s.id)) || 0,
          male: sex.male,
          female: sex.female,
        });
      });
      setSectionEnrollment(secEnroll);

      // Staff → composition (teaching / non-teaching / school head / asst. head)
      const { data: staffData } = await supabase
        .from("sms_users")
        .select("id, name, type, position, is_active")
        .eq("school_id", schoolId)
        .neq("type", "division_admin")
        .neq("type", "division_type");

      const breakdown: StaffBreakdown = {
        teaching: 0,
        nonTeaching: 0,
        schoolHead: 0,
        assistantSchoolHead: 0,
      };
      // Names keyed by user id for the load table. Includes every staff type
      // (not just teachers) so ARAL tutors — who may be type "tutor" — resolve
      // to a name instead of "Unknown".
      const teacherNames = new Map<string, string>();
      const activeTeacherIds = new Set<string>();
      staffData?.forEach((u) => {
        teacherNames.set(String(u.id), u.name);
        // Volunteer teachers advise sections and carry a load, so they belong in
        // this school-facing tile. The DepEd personnel counts (071/112/118) stay
        // keyed to the plantilla `teacher` and deliberately exclude them.
        if (isTeacherRole(u.type)) {
          if (u.is_active) activeTeacherIds.add(String(u.id));
        }
        if (!u.is_active) return;
        const pos = (u.position || "").toLowerCase();
        const isAsstHead =
          u.type === "assistant_school_head" ||
          (pos.includes("assistant") &&
            (pos.includes("head") || pos.includes("principal")));
        if (isAsstHead) breakdown.assistantSchoolHead++;
        else if (u.type === "school_head") breakdown.schoolHead++;
        else if (isTeacherRole(u.type)) breakdown.teaching++;
        else breakdown.nonTeaching++;
      });
      setStaffBreakdown(breakdown);

      // Advisory: teachers with vs. without an advisory class
      const teacherAdvisers = Array.from(adviserIds).filter((id) =>
        activeTeacherIds.has(id),
      );
      const withAdvisory = teacherAdvisers.length;
      setAdvisory({
        withAdvisory,
        withoutAdvisory: Math.max(activeTeacherIds.size - withAdvisory, 0),
      });

      // Teaching load: minutes per teacher per weekday (current SY).
      // Shared with the Reports module — see lib/utils/teachingLoad.ts.
      const loadResult = await fetchTeacherLoads(schoolId, schoolYear);
      setTeacherLoads(loadResult.loads);
      setLoadsOutsideStaff(loadResult.outsideStaffCount);
    } catch (error) {
      console.error("Error fetching school dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, [schoolId, schoolYear]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const enrollmentTotal = enrollmentByStatus.reduce(
    (s, x) => s + x.count,
    0,
  );
  const maxEnrollmentGrade = Math.max(
    ...enrollmentByGrade.map((x) => Math.max(x.male, x.female)),
    1,
  );
  const totalForm137 = form137Status.reduce((s, f) => s + f.count, 0);
  const totalStaff =
    staffBreakdown.teaching +
    staffBreakdown.nonTeaching +
    staffBreakdown.schoolHead +
    staffBreakdown.assistantSchoolHead;
  const sectionGroups = sectionEnrollment.reduce<
    Record<number, SectionEnrollment[]>
  >((acc, s) => {
    (acc[s.grade] ??= []).push(s);
    return acc;
  }, {});
  // Sex split across every section — the school-wide footer of the by-sex card.
  const sectionSexTotals = sectionEnrollment.reduce(
    (acc, s) => ({
      male: acc.male + s.male,
      female: acc.female + s.female,
      total: acc.total + s.count,
    }),
    { male: 0, female: 0, total: 0 },
  );
  // School head, admin, registrar have similar dashboard access
  const hasSchoolManagementAccess =
    user?.type === "school_head" ||
    user?.type === "assistant_school_head" ||
    user?.type === "super admin" ||
    user?.type === "admin" ||
    user?.type === "registrar";

  const quickActions: QuickAction[] = [
    {
      title: "Enrollment",
      desc: "Manage student enrollments",
      href: "/enrollment",
      icon: ClipboardList,
      color: "text-blue-600 dark:text-blue-400",
    },
    {
      title: "Sections",
      desc: "Manage class sections",
      href: "/sections",
      icon: LayoutGrid,
      color: "text-violet-600 dark:text-violet-400",
    },
    {
      title: "Students",
      desc: "View student records",
      href: "/students",
      icon: GraduationCap,
      color: "text-emerald-600 dark:text-emerald-400",
    },
    {
      title: "Schedules",
      desc: "Class schedules",
      href: "/schedules",
      icon: BookOpen,
      color: "text-amber-600 dark:text-amber-400",
    },
  ];

  if (hasSchoolManagementAccess) {
    quickActions.push({
      title: "Requests",
      desc: "Manage record requests",
      href: "/manage-requests",
      icon: FileText,
      color: "text-rose-600 dark:text-rose-400",
    });
  }

  if (!schoolId) {
    return (
      <div className="space-y-8">
        <p className="text-sm text-muted-foreground">
          No school assigned. Please contact your administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Context line */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          {loading ? (
            <div className="h-4 w-56 rounded bg-muted animate-pulse" />
          ) : (
            <p className="text-sm text-muted-foreground">
              {schoolName} · SY {schoolYear}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">School Year</span>
          <Select value={schoolYear} onValueChange={setSchoolYear}>
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue placeholder="School Year" />
            </SelectTrigger>
            <SelectContent>
              {schoolYearOptions.map((sy) => (
                <SelectItem key={sy} value={sy}>
                  {sy}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {[
          {
            title: "Students",
            value: studentsCount,
            icon: GraduationCap,
            desc: `Enrolled · SY ${schoolYear}`,
            iconBg: "bg-violet-500/20 text-violet-400",
          },
          {
            title: "Staff",
            value: staffCount,
            icon: Users,
            desc: "Personnel",
            iconBg: "bg-blue-500/20 text-blue-400",
          },
          {
            title: "Sections",
            value: sectionsCount,
            icon: LayoutGrid,
            desc: `Active · SY ${schoolYear}`,
            iconBg: "bg-amber-500/20 text-amber-400",
          },
          {
            title: "Enrollments",
            value: enrollmentTotal,
            icon: ClipboardList,
            desc: `Approved · SY ${schoolYear}`,
            iconBg: "bg-rose-500/20 text-rose-400",
          },
        ].map((item) => (
          <Card
            key={item.title}
            className="overflow-hidden border-0 shadow-lg shadow-slate-200/50 dark:shadow-slate-900/30 transition-all duration-300 hover:shadow-xl hover:scale-[1.02]"
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {item.title}
                  </p>
                  <div className="mt-1 text-2xl font-bold tracking-tight">
                    {loading ? (
                      <Skeleton className="h-8 w-16" />
                    ) : (
                      item.value.toLocaleString()
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {item.desc}
                  </p>
                </div>
                <div className={`rounded-xl p-3 ${item.iconBg}`}>
                  <item.icon className="h-5 w-5" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Enrollment by Grade */}
        <Card className="overflow-hidden border-0 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BookOpen className="h-5 w-5" />
              Enrollment by Grade
            </CardTitle>
            <CardDescription>
              SY {schoolYear} — Enrollments per grade
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div
                className="grid gap-1 h-40 items-end"
                style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
              >
                {Array.from({ length: 13 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="w-full rounded-t"
                    style={{
                      height: `${60 + (i % 4) * 10}%`,
                    }}
                  />
                ))}
              </div>
            ) : enrollmentByGrade.some(
                (g) => g.male > 0 || g.female > 0,
              ) ? (
              <>
                <div className="flex items-center justify-end gap-4 mb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-blue-500" />
                    <span className="text-[10px] text-muted-foreground">
                      Male
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-2.5 w-2.5 rounded-sm bg-rose-500" />
                    <span className="text-[10px] text-muted-foreground">
                      Female
                    </span>
                  </div>
                </div>
                <div
                  className="grid gap-1 sm:gap-2 h-40"
                  style={{
                    gridTemplateColumns: "repeat(13, minmax(0, 1fr))",
                    gridTemplateRows: "1fr",
                  }}
                >
                  {enrollmentByGrade.map((g) => {
                    const malePct = (g.male / maxEnrollmentGrade) * 100;
                    const femalePct = (g.female / maxEnrollmentGrade) * 100;
                    return (
                      <div
                        key={g.grade}
                        className="flex flex-col items-center h-full group"
                      >
                        <div className="flex-1 w-full flex items-end gap-[2px]">
                          <div
                            className="flex-1 rounded-t-sm transition-all duration-300 hover:opacity-90 min-h-[4px]"
                            style={{
                              height: `${Math.max(malePct, 4)}%`,
                              backgroundColor: "rgb(59 130 246)",
                            }}
                            title={`${getGradeLevelLabel(g.grade)} Male: ${g.male}`}
                          />
                          <div
                            className="flex-1 rounded-t-sm transition-all duration-300 hover:opacity-90 min-h-[4px]"
                            style={{
                              height: `${Math.max(femalePct, 4)}%`,
                              backgroundColor: "rgb(244 63 94)",
                            }}
                            title={`${getGradeLevelLabel(g.grade)} Female: ${g.female}`}
                          />
                        </div>
                        <span className="text-[10px] font-medium text-muted-foreground mt-1">
                          {g.grade === 0 ? "K" : `G${g.grade}`}
                        </span>
                        <span className="text-[10px] font-semibold">
                          {g.male + g.female}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>

            ) : (
              <p className="text-sm text-muted-foreground py-12 text-center">
                No enrollment data for SY {schoolYear}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Requests - For school head, admin, registrar */}
        {hasSchoolManagementAccess && (
          <Card className="overflow-hidden border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileText className="h-5 w-5" />
                Requests
              </CardTitle>
              <CardDescription>Record requests for this school</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : form137Status.length > 0 ? (
                <div className="space-y-2">
                  {form137Status.map((f) => (
                    <div
                      key={f.status}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                    >
                      <span className="text-sm capitalize">{f.status}</span>
                      <span className="text-sm font-semibold">{f.count}</span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">
                    Total: {totalForm137} requests
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No requests
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Enrollment summary for admin and registrar */}
        {hasSchoolManagementAccess && (
          <Card className="overflow-hidden border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardList className="h-5 w-5" />
                Enrollment Summary
              </CardTitle>
              <CardDescription>
                SY {schoolYear} — By enrollment status
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : enrollmentByStatus.length > 0 ? (
                <div className="space-y-2">
                  {enrollmentByStatus.map((s) => (
                    <div
                      key={s.status}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-2">
                        <div
                          className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                          style={{
                            backgroundColor:
                              ENROLLMENT_STATUS_COLORS[s.status] ??
                              "rgb(156 163 175)",
                          }}
                        />
                        <span className="text-sm">
                          {ENROLLMENT_STATUS_LABELS[s.status] ?? s.status}
                        </span>
                      </div>
                      <span className="text-sm font-semibold">{s.count}</span>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-2">
                    Total: {enrollmentTotal} enrollments
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No enrollment data
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {hasSchoolManagementAccess && (
        <>
          {/* Staff composition + Advisory */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="overflow-hidden border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="h-5 w-5" />
                  Staff Composition
                </CardTitle>
                <CardDescription>
                  {loading ? "—" : `${totalStaff} active personnel`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[1, 2, 3, 4].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      {
                        label: "Teaching",
                        value: staffBreakdown.teaching,
                        cls: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
                      },
                      {
                        label: "Non-Teaching",
                        value: staffBreakdown.nonTeaching,
                        cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
                      },
                      {
                        label: "School Head",
                        value: staffBreakdown.schoolHead,
                        cls: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
                      },
                      {
                        label: "Asst. School Head",
                        value: staffBreakdown.assistantSchoolHead,
                        cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      },
                    ].map((s) => (
                      <div
                        key={s.label}
                        className={`rounded-lg p-4 ${s.cls}`}
                      >
                        <div className="text-2xl font-bold">{s.value}</div>
                        <div className="text-xs font-medium mt-0.5">
                          {s.label}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-0 shadow-lg">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <UserCheck className="h-5 w-5" />
                  Advisory Load
                </CardTitle>
                <CardDescription>
                  SY {schoolYear} — Teachers by advisory assignment
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="grid grid-cols-2 gap-3">
                    {[1, 2].map((i) => (
                      <Skeleton key={i} className="h-16 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg p-4 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <div className="text-2xl font-bold">
                        {advisory.withAdvisory}
                      </div>
                      <div className="text-xs font-medium mt-0.5">
                        With advisory class
                      </div>
                    </div>
                    <div className="rounded-lg p-4 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <div className="text-2xl font-bold">
                        {advisory.withoutAdvisory}
                      </div>
                      <div className="text-xs font-medium mt-0.5">
                        Without advisory class
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Enrollment per section, split by sex */}
          <Card className="overflow-hidden border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Users className="h-5 w-5" />
                Enrollment per Section by Sex
              </CardTitle>
              <CardDescription>
                SY {schoolYear} —{" "}
                {loading
                  ? "—"
                  : `${sectionSexTotals.male} male, ${sectionSexTotals.female} female across ${sectionEnrollment.length} sections`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : sectionEnrollment.length > 0 ? (
                <div className="space-y-5 max-h-96 overflow-y-auto pr-1">
                  {Object.entries(sectionGroups).map(([grade, sections]) => {
                    const gradeMale = sections.reduce((s, x) => s + x.male, 0);
                    const gradeFemale = sections.reduce(
                      (s, x) => s + x.female,
                      0,
                    );
                    const gradeTotal = sections.reduce(
                      (s, x) => s + x.count,
                      0,
                    );
                    return (
                      <div key={grade}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-semibold text-muted-foreground">
                            {getGradeLevelLabel(Number(grade))}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            M {gradeMale} · F {gradeFemale} · Total{" "}
                            {gradeTotal}
                          </p>
                        </div>
                        <div className="space-y-1">
                          {sections.map((s) => (
                            <div
                              key={s.sectionId}
                              className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-muted/50"
                            >
                              <span className="text-sm truncate flex-1">
                                {s.sectionName}
                              </span>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">
                                M {s.male}
                              </span>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-pink-500/10 text-pink-600 dark:text-pink-400 flex-shrink-0">
                                F {s.female}
                              </span>
                              <span className="text-sm font-semibold w-10 text-right flex-shrink-0">
                                {s.count}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <div className="flex items-center gap-2 py-2 px-3 rounded-lg border-t pt-3">
                    <span className="text-sm font-semibold flex-1">
                      All sections
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 flex-shrink-0">
                      M {sectionSexTotals.male}
                    </span>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-pink-500/10 text-pink-600 dark:text-pink-400 flex-shrink-0">
                      F {sectionSexTotals.female}
                    </span>
                    <span className="text-sm font-bold w-10 text-right flex-shrink-0">
                      {sectionSexTotals.total}
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No sections for SY {schoolYear}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Teaching load per teacher per day */}
          <Card className="overflow-hidden border-0 shadow-lg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Clock className="h-5 w-5" />
                Teaching Load (minutes per day)
              </CardTitle>
              <CardDescription>
                SY {schoolYear} — Daily teaching minutes per teacher
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : teacherLoads.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left font-medium py-2 pr-3">
                          Teacher
                        </th>
                        {WEEKDAYS.map((d) => (
                          <th
                            key={d.idx}
                            className="text-right font-medium py-2 px-2 w-14"
                          >
                            {d.label}
                          </th>
                        ))}
                        <th className="text-right font-medium py-2 px-2 w-20">
                          Advisorship
                        </th>
                        <th className="text-right font-medium py-2 px-2 w-16">
                          ARAL
                        </th>
                        <th className="text-right font-medium py-2 pl-2 w-16">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {teacherLoads.map((t) => {
                        const advisorshipMin = advisorshipWeeklyMinutes(t);
                        const aralMin = aralWeeklyMinutes(t);
                        const weekTotal = teacherWeeklyTotal(t);
                        return (
                          <tr
                            key={t.teacherId}
                            className="border-b last:border-0 hover:bg-muted/40"
                          >
                            <td className="py-2 pr-3 font-medium truncate max-w-[180px]">
                              {t.teacherName}
                            </td>
                            {WEEKDAYS.map((d) => {
                              const m = t.minutes[d.idx] || 0;
                              return (
                                <td
                                  key={d.idx}
                                  className={`text-right py-2 px-2 ${
                                    m === 0
                                      ? "text-muted-foreground/40"
                                      : ""
                                  }`}
                                >
                                  {m}
                                </td>
                              );
                            })}
                            <td
                              className={`text-right py-2 px-2 ${
                                advisorshipMin === 0
                                  ? "text-muted-foreground/40"
                                  : ""
                              }`}
                            >
                              {advisorshipMin}
                            </td>
                            <td
                              className={`text-right py-2 px-2 ${
                                aralMin === 0 ? "text-muted-foreground/40" : ""
                              }`}
                            >
                              {aralMin}
                            </td>
                            <td className="text-right py-2 pl-2 font-semibold">
                              {weekTotal}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-8 text-center">
                  No schedules for SY {schoolYear}
                </p>
              )}
              {!loading && loadsOutsideStaff > 0 && (
                <p className="text-xs text-amber-600 mt-3">
                  {loadsOutsideStaff === 1
                    ? "1 assignment references a staff member who no longer belongs to this school and is not counted above."
                    : `${loadsOutsideStaff} assignments reference staff who no longer belong to this school and are not counted above.`}{" "}
                  Check the subject schedules, section advisers, and ARAL tutors
                  for SY {schoolYear}.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((item) => (
            <Link key={item.title} href={item.href}>
              <Card className="group overflow-hidden border transition-all duration-300 hover:border-primary/50 hover:shadow-md">
                <CardContent className="p-5 flex items-center gap-4">
                  <div
                    className={`rounded-xl p-3 bg-muted ${item.color} group-hover:scale-105 transition-transform`}
                  >
                    <item.icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold">{item.title}</h3>
                    <p className="text-sm text-muted-foreground">{item.desc}</p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:translate-x-1 transition-transform flex-shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
