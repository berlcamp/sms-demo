"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { getGradeLevelLabel } from "@/lib/constants";
import { APP_NAME, ORG_FOOTER, ORG_NAME } from "@/lib/constants/branding";
import { supabase } from "@/lib/supabase/client";
import { ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Band {
  male: number;
  female: number;
  total: number;
}

interface EnrollmentStats {
  male: number;
  female: number;
  total: number;
  elementary: Band;
  juniorHigh: Band;
  seniorHigh: Band;
  byGradeLevel: { grade: number; count: number }[];
}

function getDefaultSchoolYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const startYear = month >= 6 ? year : year - 1;
  return `${startYear}-${startYear + 1}`;
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

function AnimatedNumber({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) {
      setDisplay(0);
      return;
    }
    const duration = 900;
    const steps = 32;
    const increment = value / steps;
    let step = 0;
    const timer = setInterval(() => {
      step++;
      setDisplay(Math.min(Math.round(increment * step), value));
      if (step >= steps) clearInterval(timer);
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);

  return <>{display.toLocaleString()}</>;
}

/** Section heading: mono eyebrow over a serif title, closed with a hairline. */
function SectionHead({
  index,
  eyebrow,
  title,
  aside,
}: {
  index: string;
  eyebrow: string;
  title: string;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-8 border-b border-[var(--rule)] pb-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="label-data flex items-center gap-2.5 text-[var(--brass)]">
            <span>{index}</span>
            <span className="h-px w-6 bg-[var(--brass)]/45" />
            <span className="text-[var(--ink-3)]">{eyebrow}</span>
          </p>
          <h2 className="font-display mt-2.5 text-[26px] font-normal leading-tight tracking-tight text-[var(--ink)] sm:text-3xl">
            {title}
          </h2>
        </div>
        {aside}
      </div>
    </div>
  );
}

export default function LandingHomePage() {
  const [schoolYear, setSchoolYear] = useState(getDefaultSchoolYear);
  const [stats, setStats] = useState<EnrollmentStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const { data: enrollments, error } = await supabase
        .from("sms_enrollments")
        .select(
          `
          grade_level,
          student:sms_students!sms_enrollments_student_id_fkey(gender)
        `,
        )
        .eq("status", "approved")
        .eq("school_year", schoolYear);

      if (error) {
        console.error("Enrollment fetch error:", error);
        setStats(null);
        return;
      }

      type EnrollmentRecord = {
        grade_level: number;
        student: { gender: string } | null;
      };
      const records = ((enrollments || []) as unknown[]).filter(
        (e): e is EnrollmentRecord =>
          e != null &&
          typeof (e as { grade_level?: unknown }).grade_level === "number",
      );

      let male = 0;
      let female = 0;
      const elem = { male: 0, female: 0, total: 0 };
      const jhs = { male: 0, female: 0, total: 0 };
      const shs = { male: 0, female: 0, total: 0 };
      const byGrade = Array.from({ length: 13 }, (_, i) => ({
        grade: i,
        count: 0,
      }));

      for (const r of records) {
        const g = r.student?.gender?.toLowerCase() ?? "";
        const gl = r.grade_level;

        if (g === "male") {
          male++;
        } else if (g === "female") {
          female++;
        }

        if (gl >= 0 && gl <= 6) {
          if (g === "male") elem.male++;
          else if (g === "female") elem.female++;
          elem.total++;
        } else if (gl >= 7 && gl <= 10) {
          if (g === "male") jhs.male++;
          else if (g === "female") jhs.female++;
          jhs.total++;
        } else if (gl >= 11 && gl <= 12) {
          if (g === "male") shs.male++;
          else if (g === "female") shs.female++;
          shs.total++;
        }

        if (gl >= 0 && gl <= 12) {
          byGrade[gl]!.count++;
        }
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
  }, [schoolYear]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const ledger = [
    {
      key: "elementary",
      no: "01",
      label: "Elementary",
      range: "Kindergarten – Grade 6",
      color: "var(--band-elem)",
      data: stats?.elementary ?? null,
    },
    {
      key: "juniorHigh",
      no: "02",
      label: "Junior High School",
      range: "Grades 7 – 10",
      color: "var(--band-jhs)",
      data: stats?.juniorHigh ?? null,
    },
    {
      key: "seniorHigh",
      no: "03",
      label: "Senior High School",
      range: "Grades 11 – 12",
      color: "var(--band-shs)",
      data: stats?.seniorHigh ?? null,
    },
  ];

  const services = [
    {
      no: "01",
      href: "/schools",
      title: "School Directory",
      desc: "Every public school in the division, with district, type and address.",
    },
    {
      no: "02",
      href: "/learners",
      title: "Learner Counts",
      desc: "Enrollment by school and grade band for any school year on record.",
    },
    {
      no: "03",
      href: "/requests",
      title: "Document Requests",
      desc: "Request Form 137 and other school records, then track the request online.",
    },
    {
      no: "04",
      href: "/student-portal",
      title: "Student Portal",
      desc: "Learners sign in with their LRN to view grades and academic records.",
    },
  ];

  const gradeBandColor = (grade: number) => {
    if (grade <= 6) return "var(--band-elem)";
    if (grade <= 10) return "var(--band-jhs)";
    return "var(--band-shs)";
  };

  const share = (n: number) =>
    stats && stats.total > 0 ? (n / stats.total) * 100 : 0;

  return (
    <div className="paper-ground paper-grain font-ui relative min-h-screen text-[var(--ink-2)]">
      {/* ================================================================
          MASTHEAD
          ================================================================ */}
      <header className="relative border-b border-[var(--rule)]">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-32 sm:px-6 sm:pb-24 sm:pt-40 lg:px-8">
          <div className="grid grid-cols-1 gap-x-12 gap-y-14 lg:grid-cols-12">
            {/* Statement */}
            <div className="lg:col-span-7">
              <p
                className="label-data flex items-center gap-3 text-[var(--brass)] animate-fade-up"
                aria-label={ORG_NAME}
              >
                <span className="h-px w-8 bg-[var(--brass)]/50" />
                {ORG_NAME}
              </p>

              <h1
                className="font-display mt-6 text-[2.75rem] font-normal leading-[1.02] tracking-[-0.02em] text-[var(--ink)] animate-fade-up sm:text-6xl lg:text-[4.5rem]"
                style={{ animationDelay: "0.05s" }}
              >
                A single record
                <br />
                for every{" "}
                <span className="italic text-[var(--brass)]">learner</span>
              </h1>

              <div
                className="mt-8 h-px w-24 bg-[var(--ink)]/25 animate-rule-draw"
                style={{ animationDelay: "0.25s" }}
              />

              <p
                className="mt-8 max-w-xl text-[15px] leading-relaxed text-[var(--ink-2)] animate-fade-up sm:text-base"
                style={{ animationDelay: "0.15s" }}
              >
                Enrollment, academic records, attendance, learner health and the
                official DepEd School Forms — kept in one place for every school
                in the division, and published here for the public.
              </p>

              <div
                className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-4 animate-fade-up"
                style={{ animationDelay: "0.22s" }}
              >
                <Link
                  href="/schools"
                  className="group inline-flex h-11 items-center gap-2.5 rounded-sm bg-[var(--ink)] px-6 text-[13px] font-medium tracking-tight text-[var(--paper)] transition-colors hover:bg-[var(--ink-2)]"
                >
                  Browse the school directory
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                    strokeWidth={1.75}
                  />
                </Link>
                <Link
                  href="/requests"
                  className="group inline-flex items-center gap-1.5 border-b border-[var(--ink)]/25 pb-0.5 text-[13px] font-medium tracking-tight text-[var(--ink)] transition-colors hover:border-[var(--brass)] hover:text-[var(--brass)]"
                >
                  Request a school record
                  <ArrowUpRight
                    className="h-3.5 w-3.5 transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                    strokeWidth={1.75}
                  />
                </Link>
              </div>
            </div>

            {/* Register strip — the masthead's counterweight */}
            <div className="lg:col-span-5 lg:pl-6">
              <div
                className="border-t-2 border-[var(--ink)] bg-[var(--paper-raised)] shadow-sm shadow-[var(--ink)]/5 animate-fade-up"
                style={{ animationDelay: "0.3s" }}
              >
                <div className="flex items-baseline justify-between border-b border-[var(--rule)] px-5 py-3.5">
                  <span className="label-data text-[var(--ink-3)]">
                    Division at a glance
                  </span>
                  <span className="font-data text-[11px] text-[var(--ink-3)]">
                    SY {schoolYear}
                  </span>
                </div>

                <div className="px-5 py-7">
                  <p className="label-data text-[var(--ink-3)]">
                    Learners enrolled
                  </p>
                  {loading ? (
                    <Skeleton className="mt-3 h-14 w-48 rounded-sm bg-[var(--rule-faint)]" />
                  ) : (
                    <p className="font-data mt-2 text-5xl font-normal leading-none tracking-tight text-[var(--ink)] sm:text-6xl">
                      <AnimatedNumber value={stats?.total ?? 0} />
                    </p>
                  )}
                </div>

                <dl className="grid grid-cols-2 border-t border-[var(--rule)]">
                  {[
                    { label: "Male", value: stats?.male ?? 0 },
                    { label: "Female", value: stats?.female ?? 0 },
                  ].map((row, i) => (
                    <div
                      key={row.label}
                      className={`px-5 py-4 ${
                        i === 0 ? "border-r border-[var(--rule)]" : ""
                      }`}
                    >
                      <dt className="label-data text-[var(--ink-3)]">
                        {row.label}
                      </dt>
                      <dd className="font-data mt-1.5 text-xl text-[var(--ink)]">
                        {loading ? (
                          <Skeleton className="h-6 w-16 rounded-sm bg-[var(--rule-faint)]" />
                        ) : (
                          row.value.toLocaleString()
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              <p className="font-data mt-3 text-[10px] leading-relaxed text-[var(--ink-3)]">
                Figures cover approved enrollments across all schools in the
                division for the school year shown.
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* ================================================================
          ENROLLMENT LEDGER
          ================================================================ */}
      <section className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <SectionHead
            index="I"
            eyebrow="Enrollment"
            title="Learners by grade band"
            aside={
              <label className="flex items-center gap-3">
                <span className="label-data text-[var(--ink-3)]">
                  School year
                </span>
                <span className="relative">
                  <select
                    value={schoolYear}
                    onChange={(e) => setSchoolYear(e.target.value)}
                    className="font-data cursor-pointer appearance-none rounded-sm border border-[var(--rule)] bg-[var(--paper-raised)] py-2 pl-3 pr-9 text-[13px] text-[var(--ink)] outline-none transition-colors hover:border-[var(--ink-3)] focus:border-[var(--ink)]"
                  >
                    {getSchoolYearOptions().map((sy) => (
                      <option key={sy} value={sy}>
                        {sy}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ink-3)]"
                    strokeWidth={1.75}
                  />
                </span>
              </label>
            }
          />

          <div className="border-t border-[var(--rule)]">
            {ledger.map((row, i) => (
              <div
                key={row.key}
                className="group grid grid-cols-12 items-center gap-4 border-b border-[var(--rule)] py-6 transition-colors hover:bg-[var(--paper-raised)]/60 animate-fade-up"
                style={{ animationDelay: `${0.1 + i * 0.08}s` }}
              >
                {/* Index + name */}
                <div className="col-span-12 flex items-baseline gap-4 sm:col-span-4">
                  <span className="font-data text-[11px] text-[var(--ink-3)]">
                    {row.no}
                  </span>
                  <div>
                    <p className="font-display text-lg leading-tight text-[var(--ink)]">
                      {row.label}
                    </p>
                    <p className="label-data mt-1 text-[10px] text-[var(--ink-3)]">
                      {row.range}
                    </p>
                  </div>
                </div>

                {/* Proportional rule */}
                <div className="col-span-12 sm:col-span-4">
                  {loading ? (
                    <Skeleton className="h-1.5 w-full rounded-none bg-[var(--rule-faint)]" />
                  ) : (
                    <div
                      className="h-1.5 w-full bg-[var(--rule-faint)]"
                      role="img"
                      aria-label={`${row.label}: ${Math.round(
                        share(row.data?.total ?? 0),
                      )} percent of enrollment`}
                    >
                      <div
                        className="h-full origin-left animate-bar-grow"
                        style={{
                          width: `${share(row.data?.total ?? 0)}%`,
                          backgroundColor: row.color,
                          animationDelay: `${0.2 + i * 0.1}s`,
                          transformOrigin: "left",
                        }}
                      />
                    </div>
                  )}
                </div>

                {/* Split */}
                <div className="col-span-7 sm:col-span-2">
                  {loading ? (
                    <Skeleton className="h-4 w-24 rounded-sm bg-[var(--rule-faint)]" />
                  ) : (
                    <p className="font-data text-[11px] text-[var(--ink-3)]">
                      {(row.data?.male ?? 0).toLocaleString()} M
                      <span className="px-1.5 text-[var(--rule)]">/</span>
                      {(row.data?.female ?? 0).toLocaleString()} F
                    </p>
                  )}
                </div>

                {/* Total */}
                <div className="col-span-5 text-right sm:col-span-2">
                  {loading ? (
                    <Skeleton className="ml-auto h-7 w-20 rounded-sm bg-[var(--rule-faint)]" />
                  ) : (
                    <p className="font-data text-2xl leading-none text-[var(--ink)]">
                      {(row.data?.total ?? 0).toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            ))}

            {/* Ledger foot */}
            <div className="grid grid-cols-12 items-center gap-4 border-b-2 border-[var(--ink)] py-5">
              <div className="col-span-7 sm:col-span-8">
                <p className="label-data text-[var(--ink)]">Total enrollment</p>
              </div>
              <div className="col-span-5 text-right sm:col-span-4">
                {loading ? (
                  <Skeleton className="ml-auto h-7 w-24 rounded-sm bg-[var(--rule-faint)]" />
                ) : (
                  <p className="font-data text-2xl leading-none text-[var(--ink)]">
                    {(stats?.total ?? 0).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================
          DISTRIBUTION
          ================================================================ */}
      <section className="border-b border-[var(--rule)]">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <SectionHead
            index="II"
            eyebrow={`School year ${schoolYear}`}
            title="Distribution by grade level"
            aside={
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                {[
                  { label: "Elementary", color: "var(--band-elem)" },
                  { label: "Junior High", color: "var(--band-jhs)" },
                  { label: "Senior High", color: "var(--band-shs)" },
                ].map((l) => (
                  <span key={l.label} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5"
                      style={{ backgroundColor: l.color }}
                    />
                    <span className="label-data text-[var(--ink-3)]">
                      {l.label}
                    </span>
                  </span>
                ))}
              </div>
            }
          />

          {loading ? (
            <div className="flex h-64 items-end gap-2 sm:gap-3">
              {[62, 48, 74, 40, 86, 58, 70, 45, 80, 55, 66, 50, 38].map(
                (pct, i) => (
                  <div key={i} className="flex-1">
                    <Skeleton
                      className="w-full rounded-none bg-[var(--rule-faint)]"
                      style={{ height: `${pct}%` }}
                    />
                  </div>
                ),
              )}
            </div>
          ) : stats && stats.byGradeLevel.some((g) => g.count > 0) ? (
            <>
              <div className="flex h-64 items-end gap-1.5 sm:gap-3">
                {stats.byGradeLevel.map((g, i) => {
                  const max = Math.max(
                    ...stats.byGradeLevel.map((x) => x.count),
                    1,
                  );
                  const pct = (g.count / max) * 100;
                  return (
                    <div
                      key={g.grade}
                      className="group/bar flex h-full flex-1 flex-col justify-end"
                      title={`${getGradeLevelLabel(g.grade)}: ${g.count.toLocaleString()} learners`}
                    >
                      <span className="font-data mb-2 text-center text-[10px] text-[var(--ink-2)] opacity-0 transition-opacity duration-200 group-hover/bar:opacity-100">
                        {g.count.toLocaleString()}
                      </span>
                      <div
                        className="w-full animate-bar-grow transition-opacity duration-200 group-hover/bar:opacity-80"
                        style={{
                          height: `${Math.max(pct, 1.5)}%`,
                          backgroundColor: gradeBandColor(g.grade),
                          animationDelay: `${0.15 + i * 0.04}s`,
                        }}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Baseline + axis */}
              <div className="h-px w-full bg-[var(--ink)]/30" />
              <div className="flex gap-1.5 pt-2.5 sm:gap-3">
                {stats.byGradeLevel.map((g) => (
                  <span
                    key={g.grade}
                    className="font-data flex-1 text-center text-[10px] text-[var(--ink-3)]"
                  >
                    {g.grade === 0 ? "K" : g.grade}
                  </span>
                ))}
              </div>
              <p className="label-data mt-4 text-center text-[10px] text-[var(--ink-3)]">
                Grade level
              </p>
            </>
          ) : (
            <div className="border border-dashed border-[var(--rule)] py-20 text-center">
              <p className="font-display text-lg text-[var(--ink)]">
                No enrollment on record
              </p>
              <p className="font-data mt-2 text-[11px] text-[var(--ink-3)]">
                Nothing has been approved for SY {schoolYear} yet.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ================================================================
          SERVICES
          ================================================================ */}
      <section>
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <SectionHead index="III" eyebrow="Public access" title="Services" />

          <div className="border-t border-[var(--rule)]">
            {services.map((s, i) => (
              <Link
                key={s.href}
                href={s.href}
                className="group grid grid-cols-12 items-baseline gap-x-4 gap-y-2 border-b border-[var(--rule)] py-7 transition-colors hover:bg-[var(--paper-raised)]/60 animate-fade-up"
                style={{ animationDelay: `${0.08 + i * 0.07}s` }}
              >
                <span className="font-data col-span-2 text-[11px] text-[var(--ink-3)] sm:col-span-1">
                  {s.no}
                </span>
                <h3 className="font-display col-span-10 text-xl leading-tight text-[var(--ink)] transition-colors group-hover:text-[var(--brass)] sm:col-span-4">
                  {s.title}
                </h3>
                <p className="col-span-12 col-start-3 text-[14px] leading-relaxed text-[var(--ink-2)] sm:col-span-6 sm:col-start-6">
                  {s.desc}
                </p>
                <span className="col-span-12 col-start-3 flex sm:col-span-1 sm:justify-end">
                  <ArrowRight
                    className="h-4 w-4 text-[var(--ink-3)] transition-all duration-300 group-hover:translate-x-1 group-hover:text-[var(--brass)]"
                    strokeWidth={1.75}
                  />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================
          COLOPHON
          ================================================================ */}
      <footer className="border-t-2 border-[var(--ink)]">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-display text-base text-[var(--ink)]">
                {APP_NAME}
              </p>
              <p className="label-data mt-1.5 text-[var(--ink-3)]">
                {ORG_FOOTER}
              </p>
            </div>
            <nav className="flex flex-wrap gap-x-8 gap-y-2">
              {[
                { href: "/schools", label: "Schools" },
                { href: "/learners", label: "Learners" },
                { href: "/requests", label: "Requests" },
                { href: "/student-portal", label: "Student Portal" },
                { href: "/login", label: "Staff Sign In" },
              ].map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="text-[13px] text-[var(--ink-3)] transition-colors hover:text-[var(--ink)]"
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
