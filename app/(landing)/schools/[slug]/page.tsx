"use client";

import { getGradeLevelLabel } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/lib/supabase/client";
import {
  fetchPublicEnrollmentCounts,
  gradeBand,
  PUBLIC_GRADE_LEVELS,
} from "@/lib/utils/publicEnrollment";
import {
  BookOpen,
  GraduationCap,
  LogIn,
  MapPin,
  School,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface EnrollmentStats {
  male: number;
  female: number;
  total: number;
  elementary: { male: number; female: number; total: number };
  juniorHigh: { male: number; female: number; total: number };
  seniorHigh: { male: number; female: number; total: number };
  byGradeLevel: { grade: number; count: number }[];
}

interface SchoolInfo {
  id: string;
  school_id: string;
  slug: string;
  name: string;
  school_type: string | null;
  address: string | null;
  district: string | null;
}

function getDefaultSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
}

function SchoolPageSignIn({ href }: { href: string }) {
  return (
    <div className="fixed top-4 right-4 z-50">
      <Button
        asChild
        size="sm"
        className="bg-white text-slate-900 hover:bg-white/90 font-semibold h-9 px-4 rounded-lg shadow-lg border border-slate-200/80"
      >
        <Link href={href}>
          <LogIn className="h-4 w-4 mr-1.5" />
          Sign in
        </Link>
      </Button>
    </div>
  );
}

function StatCardSkeleton() {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-6 h-48">
      <Skeleton className="h-10 w-10 rounded-xl bg-gray-100" />
      <Skeleton className="h-4 w-24 mt-4 bg-gray-100" />
      <Skeleton className="h-3 w-16 mt-2 bg-gray-50" />
      <div className="flex gap-4 mt-5">
        <Skeleton className="h-8 w-16 bg-gray-50" />
        <Skeleton className="h-8 w-16 bg-gray-50" />
      </div>
    </div>
  );
}

export default function SchoolDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const schoolDbId = school?.id ?? null;
  const schoolYear = getDefaultSchoolYear();
  const [stats, setStats] = useState<EnrollmentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [heroImageUrl, setHeroImageUrl] = useState<string | null>(null);
  const loginHref = slug ? `/schools/${slug}/login` : "/schools";

  const fetchSchool = useCallback(async () => {
    if (!slug) return;
    const { data, error } = await supabase
      .from("sms_schools")
      .select("id, school_id, slug, name, school_type, address, district")
      .eq("slug", slug)
      .eq("is_active", true)
      .maybeSingle();

    if (error || !data) {
      setSchool(null);
      setNotFound(true);
      return;
    }
    setSchool(data as SchoolInfo);
  }, [slug]);

  const fetchStats = useCallback(async () => {
    if (!schoolDbId) return;
    setLoading(true);
    try {
      // schoolDbId is the sms_schools.id PK, typed string here but BIGINT in
      // the database — the RPC keys on the number.
      const counts = await fetchPublicEnrollmentCounts(
        schoolYear,
        Number(schoolDbId),
      );

      let male = 0;
      let female = 0;
      const elem = { male: 0, female: 0, total: 0 };
      const jhs = { male: 0, female: 0, total: 0 };
      const shs = { male: 0, female: 0, total: 0 };
      const byGrade = PUBLIC_GRADE_LEVELS.map((grade) => ({ grade, count: 0 }));
      const byGradeIndex = new Map(byGrade.map((g) => [g.grade, g]));

      for (const c of counts) {
        const learners = c.male + c.female;

        male += c.male;
        female += c.female;

        // Elementary here is labelled "SNED / Kinder – Grade 6", so it takes
        // both the kinder and elementary bands.
        const band = gradeBand(c.grade_level);
        const bucket =
          band === "kinder" || band === "elementary"
            ? elem
            : band === "juniorHigh"
              ? jhs
              : band === "seniorHigh"
                ? shs
                : null;

        if (bucket) {
          bucket.male += c.male;
          bucket.female += c.female;
          bucket.total += learners;
        }

        const gradeEntry = byGradeIndex.get(c.grade_level);
        if (gradeEntry) gradeEntry.count += learners;
      }

      setStats({
        male,
        female,
        total: male + female,
        elementary: elem,
        juniorHigh: jhs,
        seniorHigh: shs,
        byGradeLevel: byGrade,
      });
    } catch (err) {
      console.error("Stats fetch error:", err);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [schoolDbId, schoolYear]);

  useEffect(() => {
    fetchSchool();
  }, [fetchSchool]);

  useEffect(() => {
    if (!schoolDbId) return;
    let cancelled = false;
    (async () => {
      // Function lives in `public`; default client uses procurements for .from()
      const { data, error } = await supabase.schema("public").rpc(
        "get_school_landing_hero",
        { p_school_id: String(schoolDbId) },
      );
      if (cancelled) return;
      if (error) {
        console.warn("Landing hero URL:", error.message);
        setHeroImageUrl(null);
        return;
      }
      if (typeof data === "string" && data.trim().length > 0) {
        setHeroImageUrl(data.trim());
      } else {
        setHeroImageUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schoolDbId]);

  useEffect(() => {
    if (school) {
      fetchStats();
    } else if (!slug) {
      setLoading(false);
    }
  }, [school, fetchStats, slug]);

  const statCards = [
    {
      key: "total",
      icon: Users,
      label: "Total Enrollment",
      sub: "All grade levels",
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
      data: stats
        ? { male: stats.male, female: stats.female, total: stats.total }
        : null,
    },
    {
      key: "elementary",
      icon: BookOpen,
      label: "Elementary",
      sub: "SNED / Kinder – Grade 6",
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
      data: stats ? stats.elementary : null,
    },
    {
      key: "juniorHigh",
      icon: School,
      label: "Junior High",
      sub: "Grades 7–10",
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
      data: stats ? stats.juniorHigh : null,
    },
    {
      key: "seniorHigh",
      icon: GraduationCap,
      label: "Senior High",
      sub: "Grades 11–12",
      iconBg: "bg-violet-50",
      iconColor: "text-violet-600",
      data: stats ? stats.seniorHigh : null,
    },
  ];

  if (!slug || notFound) {
    return (
      <div className="bg-gradient-to-b from-slate-50 via-white to-slate-50 min-h-screen pb-16 relative">
        <SchoolPageSignIn href={loginHref} />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
          <div className="rounded-3xl bg-white border border-gray-100 shadow-sm p-12 text-center">
            <p className="text-gray-700 text-lg">School not found.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!school) {
    return (
      <div className="bg-gradient-to-b from-slate-50 via-white to-slate-50 min-h-screen pb-16 relative">
        <SchoolPageSignIn href={loginHref} />
        <Skeleton className="w-full h-[60vh] min-h-[380px] max-h-[640px] rounded-none bg-gray-200/80" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10">
          <div className="flex justify-center py-12">
            <Skeleton className="h-12 w-64 rounded-xl bg-gray-100" />
          </div>
        </div>
      </div>
    );
  }

  const gradeAxisLabel = (grade: number) => {
    if (grade === -1) return "S";
    if (grade === 0) return "K";
    return String(grade);
  };

  const gradeBarColor = (grade: number) => {
    if (grade <= 6) return "from-amber-400 to-orange-400";
    if (grade <= 10) return "from-emerald-400 to-teal-400";
    return "from-violet-400 to-purple-400";
  };

  return (
    <div className="bg-gradient-to-b from-slate-50 via-white to-slate-50 min-h-screen pb-16 relative">
      <SchoolPageSignIn href={loginHref} />

      <section
        className={`relative w-full h-[60vh] min-h-[380px] max-h-[640px] overflow-hidden ${
          heroImageUrl
            ? "bg-slate-900"
            : "bg-gradient-to-br from-slate-800 via-slate-700 to-slate-900"
        }`}
      >
        {heroImageUrl && (
          <div
            className="absolute inset-0 opacity-60"
            style={{
              backgroundImage: `url(${heroImageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
            aria-hidden
          />
        )}
        {/* Dark gradient + vignette for legibility */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-slate-950/30"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,0,0,0)_0%,_rgba(2,6,23,0.55)_100%)]"
        />

        <div className="relative z-10 h-full flex flex-col justify-end">
          <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pb-12 sm:pb-16 lg:pb-24">
            <div className="max-w-4xl space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md border border-white/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white/85">
                <School className="h-3.5 w-3.5" />
                School profile
              </div>
              <h1 className="text-4xl sm:text-6xl lg:text-7xl xl:text-8xl font-bold text-white tracking-tight drop-shadow-lg leading-[1.02]">
                {school.name}
              </h1>
              {school.address && (
                <div className="flex items-start gap-2 text-white/85 max-w-3xl">
                  <MapPin className="h-5 w-5 mt-1 shrink-0 text-white/70" />
                  <p className="text-base sm:text-lg lg:text-xl font-medium drop-shadow-sm">
                    {school.address}
                  </p>
                </div>
              )}
              <div className="pt-2 flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                <span className="inline-flex items-center rounded-full bg-white/12 backdrop-blur-md border border-white/20 px-3 py-1.5 text-white/90 font-medium">
                  School ID {school.school_id}
                </span>
                {school.district && (
                  <span className="inline-flex items-center rounded-full bg-white/12 backdrop-blur-md border border-white/20 px-3 py-1.5 text-white/90 font-medium">
                    {school.district}
                  </span>
                )}
                <span className="inline-flex items-center rounded-full bg-white/12 backdrop-blur-md border border-white/20 px-3 py-1.5 text-white/90 font-medium">
                  SY {schoolYear}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 sm:pt-12">

        {/* Stat cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5 mb-12">
          {loading ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            statCards.map((card) => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  className="group rounded-2xl bg-white/80 backdrop-blur-sm border border-gray-100 shadow-sm p-6 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-gray-200"
                >
                  <div
                    className={`inline-flex p-2.5 rounded-xl ${card.iconBg} mb-4`}
                  >
                    <Icon className={`h-5 w-5 ${card.iconColor}`} />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-0.5">
                    {card.label}
                  </h3>
                  <p className="text-xs text-gray-400 mb-4">{card.sub}</p>
                  {card.data ? (
                    <div>
                      <div className="text-3xl font-bold text-gray-900 mb-3 tabular-nums">
                        {card.data.total.toLocaleString()}
                      </div>
                      <div className="flex gap-4 text-xs">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-blue-500" />
                          <span className="text-gray-500">Male</span>
                          <span className="font-semibold text-gray-700">
                            {card.data.male.toLocaleString()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2 h-2 rounded-full bg-pink-500" />
                          <span className="text-gray-500">Female</span>
                          <span className="font-semibold text-gray-700">
                            {card.data.female.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-sm">No data</p>
                  )}
                </div>
              );
            })
          )}
        </section>

        {/* Chart */}
        <section>
          <div className="rounded-3xl bg-white/80 backdrop-blur-sm border border-gray-100 shadow-sm p-6 sm:p-8">
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-gray-900 tracking-tight">
                  Enrollment by Grade Level
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  Distribution of approved enrollments · SY {schoolYear}
                </p>
              </div>
              <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Elementary
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  JHS
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-violet-400" />
                  SHS
                </span>
              </div>
            </div>
            {loading ? (
              <div className="grid grid-cols-12 gap-2 sm:gap-3 items-end h-56">
                {[70, 55, 80, 45, 90, 65, 75, 50, 85, 60, 70, 55].map(
                  (pct, i) => (
                    <div
                      key={i}
                      className="flex flex-col items-center gap-2 h-full justify-end"
                    >
                      <Skeleton
                        className="w-full rounded-lg min-h-[16px] bg-gray-100"
                        style={{ height: `${pct}%` }}
                      />
                      <Skeleton className="h-3 w-6 bg-gray-100" />
                    </div>
                  ),
                )}
              </div>
            ) : stats && stats.byGradeLevel.some((g) => g.count > 0) ? (
              <div className="grid gap-2 sm:gap-3 items-end h-56 sm:h-64 [grid-template-columns:repeat(14,minmax(0,1fr))]">
                {stats.byGradeLevel.map((g) => {
                  const max = Math.max(
                    ...stats.byGradeLevel.map((x) => x.count),
                    1,
                  );
                  const pct = (g.count / max) * 100;
                  return (
                    <div
                      key={g.grade}
                      className="flex flex-col items-center gap-1.5 h-full justify-end group"
                    >
                      <span className="text-xs font-bold text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                        {g.count}
                      </span>
                      <div
                        className={`w-full rounded-lg bg-gradient-to-t ${gradeBarColor(g.grade)} transition-all duration-300 group-hover:brightness-110 group-hover:shadow-md min-h-[4px]`}
                        style={{ height: `${Math.max(pct, 3)}%` }}
                        title={`${getGradeLevelLabel(g.grade)}: ${g.count} students`}
                      />
                      <span className="text-[10px] sm:text-xs font-semibold text-gray-400 group-hover:text-gray-700 transition-colors">
                        {gradeAxisLabel(g.grade)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-16 text-gray-400 text-sm rounded-xl bg-gray-50">
                No enrollment data for this school year
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
