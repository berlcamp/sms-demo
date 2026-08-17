"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SchoolYearFilter } from "@/components/division-reports/SchoolYearFilter";
import {
  getGradeLevelLabel,
  getLearningAreaLabel,
  getSchoolTypeLabel,
  getStrandLabel,
} from "@/lib/constants";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import {
  BookOpen,
  Building2,
  Facebook,
  GraduationCap,
  Instagram,
  Mail,
  MapPin,
  Phone,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

interface School {
  id: number;
  school_id: string;
  name: string;
  school_type: string | null;
  district: string | null;
  municipality_city: string | null;
  region: string | null;
  barangay: string | null;
  street: string | null;
  address: string | null;
  email: string | null;
  telephone_number: string | null;
  mobile_number: string | null;
  facebook_url: string | null;
  twitter_url: string | null;
  instagram_url: string | null;
  tiktok_url: string | null;
  principal_name: string | null;
  principal_email: string | null;
  principal_phone: string | null;
  user_count: number;
  teacher_count: number;
}

interface Submission {
  id: number;
  report_type: string;
  semester: number | null;
  status: "draft" | "submitted" | "locked";
  submitted_at: string | null;
}

interface EnrollmentByGrade {
  grade_level: number;
  male: number;
  female: number;
}

interface TrackStrandDetail {
  track: string;
  strand: string;
  grade_level: number;
  male: number;
  female: number;
  semester: number | null;
}

interface TeachingSpecDetail {
  learning_area: string;
  male: number;
  female: number;
}

const REPORT_LABELS: Record<string, string> = {
  enrollment: "Enrollment",
  track_strand: "Track & Strand",
  shs_specialization: "SHS Specialization",
  teaching_specialization: "Teaching Specialization",
};

export default function Page() {
  const params = useParams();
  const id = Number(params.id);
  const [sy, setSy] = useState(getCurrentSchoolYear());
  const [school, setSchool] = useState<School | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [enrollmentByGrade, setEnrollmentByGrade] = useState<
    EnrollmentByGrade[]
  >([]);
  const [trackStrandRows, setTrackStrandRows] = useState<TrackStrandDetail[]>(
    [],
  );
  const [teachingSpecRows, setTeachingSpecRows] = useState<
    TeachingSpecDetail[]
  >([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      // 1. School profile via division_school_list RPC + filter
      const { data: schoolList, error: slErr } = await supabase.rpc(
        "division_school_list",
      );
      if (slErr) throw slErr;
      const match = (schoolList as School[])?.find((s) => s.id === id) ?? null;
      setSchool(match);

      // 2. Submission headers for this SY
      const { data: subs, error: subErr } = await supabase
        .from("sms_division_report_submissions")
        .select("id, report_type, semester, status, submitted_at")
        .eq("school_id", id)
        .eq("school_year", sy)
        .order("report_type")
        .order("semester");
      if (subErr) throw subErr;
      setSubmissions((subs as Submission[]) || []);

      // 3. Enrollment by grade — derived live, not read from the submission.
      //    Same function the school's own Autofill uses, so the division sees
      //    what the school would see, whether or not it has filed the form.
      const { data: live, error: liveErr } = await supabase.rpc(
        "enrollment_autofill",
        { p_school_id: id, p_school_year: sy, p_semester: null },
      );
      if (liveErr) throw liveErr;
      setEnrollmentByGrade(
        ((live as EnrollmentByGrade[]) ?? []).map((r) => ({
          grade_level: Number(r.grade_level),
          male: Number(r.male || 0),
          female: Number(r.female || 0),
        })),
      );

      // 4. Track & Strand rows
      const trackStrandSubs = (subs as Submission[])?.filter(
        (s) => s.report_type === "track_strand",
      );
      if (trackStrandSubs && trackStrandSubs.length > 0) {
        const { data: tsr } = await supabase
          .from("sms_report_track_strand_rows")
          .select("submission_id, track, strand, grade_level, male, female")
          .in(
            "submission_id",
            trackStrandSubs.map((s) => s.id),
          );
        const semMap = new Map(
          trackStrandSubs.map((s) => [s.id, s.semester] as const),
        );
        const mapped: TrackStrandDetail[] =
          ((tsr as (TrackStrandDetail & { submission_id: number })[]) ?? []).map(
            (r) => ({
              track: r.track,
              strand: r.strand,
              grade_level: r.grade_level,
              male: r.male,
              female: r.female,
              semester: semMap.get(r.submission_id) ?? null,
            }),
          );
        setTrackStrandRows(mapped);
      } else {
        setTrackStrandRows([]);
      }

      // 5. Teaching specialization rows
      const tsIds = (subs as Submission[])
        ?.filter((s) => s.report_type === "teaching_specialization")
        .map((s) => s.id);
      if (tsIds && tsIds.length > 0) {
        const { data: tsrRows } = await supabase
          .from("sms_report_teaching_specialization_rows")
          .select("learning_area, male, female")
          .in("submission_id", tsIds);
        setTeachingSpecRows((tsrRows as TeachingSpecDetail[]) ?? []);
      } else {
        setTeachingSpecRows([]);
      }

      // No blanket reset when there are no submissions: enrollment by grade is
      // derived above and must survive a school that has filed nothing. The
      // submission-backed sections clear themselves in their own else branches.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id, sy]);

  useEffect(() => {
    load();
  }, [load]);

  const statusByKey = useMemo(() => {
    const m = new Map<string, Submission>();
    for (const s of submissions) {
      m.set(`${s.report_type}|${s.semester ?? 0}`, s);
    }
    return m;
  }, [submissions]);

  const statusBadge = (s: Submission | undefined) => {
    if (!s) return <Badge variant="outline">Not submitted</Badge>;
    if (s.status === "draft") return <Badge variant="outline">Draft</Badge>;
    if (s.status === "submitted") return <Badge>Submitted</Badge>;
    return <Badge variant="secondary">Locked</Badge>;
  };

  return (
    <div>
      <div className="app__title">
        <Link
          href="/division/reports/school-list"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← School List
        </Link>
        {loading && !school ? (
          <Skeleton className="h-8 w-64" />
        ) : school ? (
          <>
            <h1 className="app__title_text">{school.name}</h1>
            <p className="text-sm text-muted-foreground">
              {getSchoolTypeLabel(school.school_type)} · School ID{" "}
              {school.school_id}
              {school.district ? ` · ${school.district}` : ""}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">School not found.</p>
        )}
      </div>

      <div className="app__content space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SchoolYearFilter value={sy} onChange={setSy} />
        </div>

        {school && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> Location
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {school.street && <div>{school.street}</div>}
                {school.barangay && <div>Brgy. {school.barangay}</div>}
                <div>
                  {[school.municipality_city, school.region]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </div>
                {school.address && (
                  <div className="text-xs text-muted-foreground pt-1">
                    {school.address}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="h-4 w-4" /> Principal
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <div className="font-medium">
                  {school.principal_name || "—"}
                </div>
                {school.principal_email && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Mail className="h-3 w-3" /> {school.principal_email}
                  </div>
                )}
                {school.principal_phone && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" /> {school.principal_phone}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Contact</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {school.email && (
                  <div className="flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {school.email}
                  </div>
                )}
                {school.telephone_number && (
                  <div className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {school.telephone_number}
                  </div>
                )}
                {school.mobile_number && (
                  <div className="flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {school.mobile_number}
                  </div>
                )}
                <div className="flex gap-3 pt-2">
                  {school.facebook_url && (
                    <a
                      href={school.facebook_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Facebook className="h-4 w-4" />
                    </a>
                  )}
                  {school.instagram_url && (
                    <a
                      href={school.instagram_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Instagram className="h-4 w-4" />
                    </a>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {school && (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard
              label="Teachers"
              value={school.teacher_count}
              icon={<BookOpen className="h-4 w-4" />}
            />
            <StatCard
              label="Total Users"
              value={school.user_count}
              icon={<Users className="h-4 w-4" />}
            />
            <StatCard
              label="Submissions (this SY)"
              value={
                submissions.filter((s) => s.status !== "draft").length
              }
              icon={<GraduationCap className="h-4 w-4" />}
            />
            <StatCard
              label="Locked"
              value={submissions.filter((s) => s.status === "locked").length}
              icon={<Building2 className="h-4 w-4" />}
            />
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submission status ({sy})</CardTitle>
            <CardDescription>
              One row per report and semester where applicable.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Report</TableHead>
                      <TableHead>Semester</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[
                      { type: "enrollment", sem: null as number | null },
                      { type: "teaching_specialization", sem: null },
                      { type: "track_strand", sem: 1 as number | null },
                      { type: "track_strand", sem: 2 as number | null },
                      {
                        type: "shs_specialization",
                        sem: 1 as number | null,
                      },
                      {
                        type: "shs_specialization",
                        sem: 2 as number | null,
                      },
                    ].map((slot) => {
                      const s = statusByKey.get(
                        `${slot.type}|${slot.sem ?? 0}`,
                      );
                      return (
                        <TableRow key={`${slot.type}-${slot.sem ?? "x"}`}>
                          <TableCell className="font-medium">
                            {REPORT_LABELS[slot.type]}
                          </TableCell>
                          <TableCell>
                            {slot.sem ? `Sem ${slot.sem}` : "—"}
                          </TableCell>
                          <TableCell>{statusBadge(s)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {s?.submitted_at
                              ? new Date(s.submitted_at).toLocaleDateString()
                              : "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-3 text-xs">
              <Link
                href="/division/reports/enrollment"
                className="text-primary hover:underline"
              >
                View Enrollment report →
              </Link>
              <Link
                href="/division/reports/track-strand"
                className="text-primary hover:underline"
              >
                View Track &amp; Strand →
              </Link>
              <Link
                href="/division/reports/shs-specialization"
                className="text-primary hover:underline"
              >
                View SHS Specialization →
              </Link>
              <Link
                href="/division/reports/teaching-specialization"
                className="text-primary hover:underline"
              >
                View Teaching Specialization →
              </Link>
            </div>
          </CardContent>
        </Card>

        {enrollmentByGrade.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Enrollment by grade ({sy})
              </CardTitle>
              <CardDescription>
                Computed live from enrollment records — no submission required.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Grade Level</TableHead>
                      <TableHead className="text-right">Male</TableHead>
                      <TableHead className="text-right">Female</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enrollmentByGrade.map((r) => (
                      <TableRow key={r.grade_level}>
                        <TableCell>
                          {getGradeLevelLabel(r.grade_level)}
                        </TableCell>
                        <TableCell className="text-right">{r.male}</TableCell>
                        <TableCell className="text-right">{r.female}</TableCell>
                        <TableCell className="text-right font-medium">
                          {r.male + r.female}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="border-t-2 font-bold bg-muted/40">
                      <TableCell>Total</TableCell>
                      <TableCell className="text-right">
                        {enrollmentByGrade.reduce((s, r) => s + r.male, 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {enrollmentByGrade.reduce((s, r) => s + r.female, 0)}
                      </TableCell>
                      <TableCell className="text-right">
                        {enrollmentByGrade.reduce(
                          (s, r) => s + r.male + r.female,
                          0,
                        )}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {trackStrandRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Track &amp; Strand ({sy})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Strand</TableHead>
                      <TableHead>Sem</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead className="text-right">Male</TableHead>
                      <TableHead className="text-right">Female</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trackStrandRows.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell>{getStrandLabel(r.strand)}</TableCell>
                        <TableCell>{r.semester ?? "—"}</TableCell>
                        <TableCell>G{r.grade_level}</TableCell>
                        <TableCell className="text-right">{r.male}</TableCell>
                        <TableCell className="text-right">{r.female}</TableCell>
                        <TableCell className="text-right font-medium">
                          {r.male + r.female}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {teachingSpecRows.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Teaching Specialization ({sy})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Learning Area</TableHead>
                      <TableHead className="text-right">Male</TableHead>
                      <TableHead className="text-right">Female</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {teachingSpecRows.map((r) => (
                      <TableRow key={r.learning_area}>
                        <TableCell>
                          {getLearningAreaLabel(r.learning_area)}
                        </TableCell>
                        <TableCell className="text-right">{r.male}</TableCell>
                        <TableCell className="text-right">{r.female}</TableCell>
                        <TableCell className="text-right font-medium">
                          {r.male + r.female}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2">
          {icon}
          {label}
        </Label>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
