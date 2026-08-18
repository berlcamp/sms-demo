"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase/client";
import {
  ENROLLMENT_STATUS_COLORS,
  ENROLLMENT_STATUS_LABELS,
  getCurrentSchoolYear,
} from "@/lib/dashboard-utils";
import { TEST_SCHOOL_ID_FILTER } from "@/lib/constants/landing";
import {
  PUBLIC_GRADE_LEVELS,
  fetchPublicEnrollmentCounts,
} from "@/lib/utils/publicEnrollment";
import { useAppSelector } from "@/lib/redux/hook";
import {
  Building2,
  ClipboardList,
  FileBarChart,
  GraduationCap,
  LayoutGrid,
  School,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

interface SchoolStudentCount {
  school_id: string;
  school_name: string;
  count: number;
}

interface StaffByType {
  type: string;
  count: number;
  label: string;
}

interface Form137Status {
  status: string;
  count: number;
}

const STAFF_TYPE_LABELS: Record<string, string> = {
  teacher: "Teachers",
  school_head: "School Heads",
  assistant_school_head: "Assistant School Principals",
  registrar: "Registrars",
  admin: "Admins",
  librarian: "Librarians",
  guidance_counselor: "Guidance Counselors",
  school_nurse: "School Nurses",
  accounting: "Accounting",
};

const STAFF_PIE_COLORS = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
];

function getGradeLabel(grade: number): string {
  if (grade === -1) return "SNED";
  if (grade === 0) return "K";
  return `G${grade}`;
}

/**
 * Lifecycle statuses charted in the status breakdown. Counted one exact query
 * each rather than by tallying rows in the browser — see fetchDashboardData.
 */
const LIFECYCLE_STATUSES = Object.keys(ENROLLMENT_STATUS_COLORS);

/** School-level staff types the pie breaks down; division roles are excluded. */
const STAFF_TYPES = Object.keys(STAFF_TYPE_LABELS);

/** Head-count query for school-level staff, shared by the total and each slice. */
function buildStaffQuery() {
  return supabase
    .from("sms_users")
    .select("*", { count: "exact", head: true })
    .neq("type", "division_admin")
    .neq("type", "division_type")
    .neq("type", "super admin");
}

export function DivisionDashboard() {
  const user = useAppSelector((state) => state.user.user);
  const [schoolsCount, setSchoolsCount] = useState(0);
  const [usersCount, setUsersCount] = useState(0);
  const [studentsCount, setStudentsCount] = useState(0);
  const [sectionsCount, setSectionsCount] = useState(0);
  const [studentsBySchool, setStudentsBySchool] = useState<SchoolStudentCount[]>(
    [],
  );
  const [staffByType, setStaffByType] = useState<StaffByType[]>([]);
  const [enrollmentByStatus, setEnrollmentByStatus] = useState<
    { status: string; count: number }[]
  >([]);
  const [enrollmentByGrade, setEnrollmentByGrade] = useState<
    { grade: number; label: string; Male: number; Female: number }[]
  >([]);
  const [form137Status, setForm137Status] = useState<Form137Status[]>([]);
  const [schoolYear] = useState(getCurrentSchoolYear());
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      // Test schools are dropped here as well. TEST_SCHOOL_IDS' own comment
      // says they belong in no dashboard statistic, and the learner counts
      // below come from an RPC that already excludes them (141) — leaving them
      // in the school count would make this card describe a different set of
      // schools from every other figure on the page.
      const { count: schoolsCnt } = await supabase
        .from("sms_schools")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true)
        .not("id", "in", TEST_SCHOOL_ID_FILTER);
      setSchoolsCount(schoolsCnt ?? 0);

      const { data: schools } = await supabase
        .from("sms_schools")
        .select("id, name")
        .eq("is_active", true)
        .not("id", "in", TEST_SCHOOL_ID_FILTER);
      const schoolMap = new Map<string, string>();
      schools?.forEach((s) => schoolMap.set(String(s.id), s.name));

      // Exact counts, one query per staff type. The previous version pulled the
      // rows and tallied them, so the pie was built from the first 1000 staff
      // and undercounted every type once the division passed that — the same
      // row-cap trap as the learner figures. `usersCnt` was always exact, which
      // is why the headline total and the pie disagreed with each other.
      const staffCount = async (
        apply: (
          q: ReturnType<typeof buildStaffQuery>,
        ) => ReturnType<typeof buildStaffQuery>,
      ) => (await apply(buildStaffQuery())).count ?? 0;

      const [usersCnt, ...typeCounts] = await Promise.all([
        staffCount((q) => q),
        ...STAFF_TYPES.map((type) =>
          staffCount((q) => q.eq("type", type)),
        ),
      ]);
      setUsersCount(usersCnt);

      const known: StaffByType[] = STAFF_TYPES.map((type, i) => ({
        type,
        count: typeCounts[i] ?? 0,
        label: STAFF_TYPE_LABELS[type] || type,
      })).filter((t) => t.count > 0);

      // Anything not in the label map still exists and still belongs in the
      // total, so it is shown rather than silently dropped.
      const other = usersCnt - known.reduce((sum, t) => sum + t.count, 0);
      setStaffByType(
        [
          ...known,
          ...(other > 0 ? [{ type: "other", count: other, label: "Other" }] : []),
        ].sort((a, b) => b.count - a.count),
      );

      // Learner figures come from the SAME source as the public landing page —
      // `public_enrollment_counts` (migration 141) via fetchPublicEnrollmentCounts
      // — so the two cannot disagree. Reading sms_students here was wrong four
      // ways at once: the response is subject to PostgREST's row cap so
      // `students.length` silently stopped at 1000 while the division has
      // ~12,000 learners; it counted every learner ever recorded rather than
      // those enrolled this school year; it keyed on sms_students.school_id
      // rather than where the learner actually is (migration 109); and it
      // included the test schools the landing page drops.
      const counts = await fetchPublicEnrollmentCounts(schoolYear);

      const countsBySchool = new Map<string, number>();
      const gradeTotals = new Map<number, { Male: number; Female: number }>();
      let learnerTotal = 0;

      for (const c of counts) {
        const learners = c.male + c.female;
        learnerTotal += learners;

        const sid = String(c.school_id);
        countsBySchool.set(sid, (countsBySchool.get(sid) || 0) + learners);

        const bucket = gradeTotals.get(c.grade_level) ?? { Male: 0, Female: 0 };
        bucket.Male += c.male;
        bucket.Female += c.female;
        gradeTotals.set(c.grade_level, bucket);
      }

      setStudentsCount(learnerTotal);
      setStudentsBySchool(
        Array.from(countsBySchool.entries())
          .map(([schoolId, count]) => ({
            school_id: schoolId,
            school_name: schoolMap.get(schoolId) || schoolId,
            count,
          }))
          .sort((a, b) => b.count - a.count),
      );
      // PUBLIC_GRADE_LEVELS, not 0..12: SNED (-1) carries real learners and the
      // landing page charts it, so omitting it here was a second way the two
      // disagreed.
      setEnrollmentByGrade(
        PUBLIC_GRADE_LEVELS.map((grade) => ({
          grade,
          label: getGradeLabel(grade),
          Male: gradeTotals.get(grade)?.Male ?? 0,
          Female: gradeTotals.get(grade)?.Female ?? 0,
        })),
      );

      const { count: sectionsCnt } = await supabase
        .from("sms_sections")
        .select("*", { count: "exact", head: true })
        .eq("is_active", true)
        .not("school_id", "in", TEST_SCHOOL_ID_FILTER);
      setSectionsCount(sectionsCnt ?? 0);

      // One exact count per lifecycle status. Tallying the rows in the browser
      // capped this at 1000 like everything else above, so the pie showed the
      // shape of the first page of enrolments rather than of the division.
      //
      // `semester is null or semester = 1` collapses an SHS learner's two
      // semester rows (migration 028) to one head. The residual trade is a
      // learner who enrolled only in the second semester, who is not counted
      // — unavoidable from a row count, and the reason the learner totals
      // above go through the RPC instead.
      const statusResults = await Promise.all(
        LIFECYCLE_STATUSES.map(async (status) => {
          const { count } = await supabase
            .from("sms_enrollments")
            .select("*", { count: "exact", head: true })
            .eq("status", "approved")
            .eq("school_year", schoolYear)
            .eq("enrollment_status", status)
            .or("semester.is.null,semester.eq.1")
            .not("school_id", "in", TEST_SCHOOL_ID_FILTER);
          return { status, count: count ?? 0 };
        }),
      );
      setEnrollmentByStatus(
        statusResults
          .filter((s) => s.count > 0)
          .sort((a, b) => b.count - a.count),
      );

      const { data: form137 } = await supabase
        .from("sms_requests")
        .select("status");
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
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  }, [schoolYear]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData]);

  const totalStaffForPie = staffByType.reduce((s, t) => s + t.count, 0);
  const totalForm137 = form137Status.reduce((s, f) => s + f.count, 0);
  const enrollmentTotal = enrollmentByStatus.reduce(
    (s, x) => s + x.count,
    0,
  );

  const topStudentsBySchool = studentsBySchool.slice(0, 8).map((s) => ({
    ...s,
    displayName:
      s.school_name.length > 22
        ? s.school_name.slice(0, 20) + "…"
        : s.school_name,
  }));

  const kpiTiles = [
    {
      title: "Schools",
      value: schoolsCount,
      icon: Building2,
      desc: "Active schools in division",
      iconWrap: "bg-emerald-50 text-emerald-600 ring-emerald-100",
    },
    {
      title: "Personnel",
      value: usersCount,
      icon: Users,
      desc: "Teaching & non-teaching",
      iconWrap: "bg-blue-50 text-blue-600 ring-blue-100",
    },
    {
      title: "Learners",
      value: studentsCount,
      icon: GraduationCap,
      desc: "Enrolled across schools",
      iconWrap: "bg-violet-50 text-violet-600 ring-violet-100",
    },
    {
      title: "Sections",
      value: sectionsCount,
      icon: LayoutGrid,
      desc: "Active class sections",
      iconWrap: "bg-amber-50 text-amber-600 ring-amber-100",
    },
  ];

  return (
    <div className="space-y-8">
      {/* Hero strip */}
      <div className="flex flex-col gap-1.5 pb-2">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <FileBarChart className="h-3.5 w-3.5" />
          Division Office
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-slate-900">
          {user?.name ? `Welcome, ${user.name}` : "Division Dashboard"}
        </h1>
        <p className="text-sm text-slate-600">
          Division-wide overview for School Year {schoolYear}.
        </p>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
        {kpiTiles.map((item) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.title}
              className="overflow-hidden border border-slate-200/80 bg-white shadow-sm hover:shadow-md transition-shadow"
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      {item.title}
                    </p>
                    <div className="mt-1.5 text-3xl font-bold tracking-tight text-slate-900">
                      {loading ? (
                        <Skeleton className="h-9 w-20" />
                      ) : (
                        item.value.toLocaleString()
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500 truncate">
                      {item.desc}
                    </p>
                  </div>
                  <div
                    className={`rounded-xl p-2.5 ring-1 flex-shrink-0 ${item.iconWrap}`}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Enrollment by grade — full width */}
      <Card className="border border-slate-200/80 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900">
            Enrollment by Grade Level
          </CardTitle>
          <CardDescription>
            SY {schoolYear} · approved enrollments, by gender
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[280px] w-full" />
          ) : enrollmentByGrade.some((g) => g.Male > 0 || g.Female > 0) ? (
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={enrollmentByGrade}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="#e2e8f0"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    tickLine={false}
                    axisLine={{ stroke: "#e2e8f0" }}
                  />
                  <YAxis
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                    width={40}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "white",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    cursor={{ fill: "#f1f5f9" }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
                    iconType="circle"
                  />
                  <Bar dataKey="Male" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Female" stackId="a" fill="#ec4899" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-slate-500 py-16 text-center">
              No enrollment data for SY {schoolYear}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Two-column: Students by school + Staff by role */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-3 border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <School className="h-4 w-4 text-slate-500" />
              Learners by School
            </CardTitle>
            <CardDescription>
              Top 8 schools by enrolled learners
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : topStudentsBySchool.length > 0 ? (
              <div className="h-[300px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={topStudentsBySchool}
                    layout="vertical"
                    margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#e2e8f0"
                      horizontal={false}
                    />
                    <XAxis
                      type="number"
                      tick={{ fill: "#64748b", fontSize: 11 }}
                      tickLine={false}
                      axisLine={{ stroke: "#e2e8f0" }}
                    />
                    <YAxis
                      type="category"
                      dataKey="displayName"
                      tick={{ fill: "#334155", fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={140}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      cursor={{ fill: "#f1f5f9" }}
                      formatter={(value) => [
                        Number(value).toLocaleString(),
                        "Learners",
                      ]}
                      labelFormatter={(label, payload) => {
                        const row = payload?.[0]?.payload as
                          | SchoolStudentCount
                          | undefined;
                        return row?.school_name ?? String(label);
                      }}
                    />
                    <Bar
                      dataKey="count"
                      fill="#6366f1"
                      radius={[0, 6, 6, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-16 text-center">
                No learner data available
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Users className="h-4 w-4 text-slate-500" />
              Personnel by Role
            </CardTitle>
            <CardDescription>
              {totalStaffForPie.toLocaleString()} staff across the division
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : staffByType.length > 0 ? (
              <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={staffByType}
                      dataKey="count"
                      nameKey="label"
                      innerRadius={55}
                      outerRadius={90}
                      paddingAngle={2}
                    >
                      {staffByType.map((_, idx) => (
                        <Cell
                          key={idx}
                          fill={
                            STAFF_PIE_COLORS[idx % STAFF_PIE_COLORS.length]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "white",
                        border: "1px solid #e2e8f0",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value) => Number(value).toLocaleString()}
                    />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-16 text-center">
                No personnel data
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Two-column: Enrollment status + Requests */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <ClipboardList className="h-4 w-4 text-slate-500" />
              Enrollment Status
            </CardTitle>
            <CardDescription>
              SY {schoolYear} · {enrollmentTotal.toLocaleString()} total
              enrollments
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2.5">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : enrollmentByStatus.length > 0 ? (
              <div className="space-y-2">
                {enrollmentByStatus.map((s) => {
                  const pct = enrollmentTotal
                    ? Math.round((s.count / enrollmentTotal) * 100)
                    : 0;
                  const color =
                    ENROLLMENT_STATUS_COLORS[s.status] ?? "rgb(148 163 184)";
                  return (
                    <div
                      key={s.status}
                      className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5"
                    >
                      <div className="flex items-center justify-between gap-3 mb-1.5">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-sm font-medium text-slate-700 truncate">
                            {ENROLLMENT_STATUS_LABELS[s.status] ?? s.status}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-2 flex-shrink-0">
                          <span className="text-sm font-semibold text-slate-900">
                            {s.count.toLocaleString()}
                          </span>
                          <span className="text-xs text-slate-500">
                            {pct}%
                          </span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-slate-200/70 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-12 text-center">
                No enrollment data
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <ClipboardList className="h-4 w-4 text-slate-500" />
              Document Requests
            </CardTitle>
            <CardDescription>
              {totalForm137.toLocaleString()} total Form 137 / record requests
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2.5">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-11 w-full" />
                ))}
              </div>
            ) : form137Status.length > 0 ? (
              <div className="space-y-2">
                {form137Status.map((f) => (
                  <div
                    key={f.status}
                    className="flex items-center justify-between py-2.5 px-3 rounded-lg border border-slate-100 bg-slate-50/60"
                  >
                    <span className="text-sm font-medium text-slate-700 capitalize">
                      {f.status}
                    </span>
                    <span className="text-sm font-semibold text-slate-900">
                      {f.count.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 py-12 text-center">
                No document requests recorded
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
