"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import { getGradeLevelLabel } from "@/lib/constants";
import {
  CERTIFICATE_TITLES,
  generateCertificatesPrint,
  type CertificateLearner,
  type CertificateType,
} from "@/lib/pdf";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { cn, formatLrn } from "@/lib/utils";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import {
  ArrowLeft,
  Check,
  ChevronsUpDown,
  Loader2,
  Printer,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ReportAccessDenied, useCanViewReports } from "../components/ReportShell";

const ALL_STUDENTS = "all";

/**
 * Lifecycle statuses that no longer represent a learner of this school, so
 * they must never receive an enrollment / good moral certificate from here.
 */
const EXCLUDED_LIFECYCLE = new Set(["dropped", "transferred_out"]);

interface SectionOption {
  id: string;
  name: string;
  gradeLevel: number;
}

interface EnrollmentRow {
  enrollment_status: string | null;
  student: {
    id: string;
    lrn: string;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    suffix: string | null;
  } | null;
}

/** Learner plus the "Last, First" form used for on-screen listing and sorting. */
interface LearnerRow extends CertificateLearner {
  listName: string;
}

/** Certificate wording spells the name out in full: "Juan Perez Dela Cruz Jr." */
function buildFullName(s: NonNullable<EnrollmentRow["student"]>): string {
  return [s.first_name, s.middle_name, s.last_name, s.suffix]
    .filter(Boolean)
    .join(" ");
}

function buildListName(s: NonNullable<EnrollmentRow["student"]>): string {
  const given = [s.first_name, s.middle_name].filter(Boolean).join(" ");
  const family = [s.last_name, s.suffix].filter(Boolean).join(" ");
  return `${family}, ${given}`;
}

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const canView = useCanViewReports();
  const schoolId = user?.school_id;

  const [schoolYear, setSchoolYear] = useState(getCurrentSchoolYear());
  const [gradeLevel, setGradeLevel] = useState<string>("");
  const [sectionId, setSectionId] = useState<string>("");
  const [studentId, setStudentId] = useState<string>(ALL_STUDENTS);

  const [sections, setSections] = useState<SectionOption[]>([]);
  const [learners, setLearners] = useState<LearnerRow[]>([]);
  const [loadingSections, setLoadingSections] = useState(false);
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [generating, setGenerating] = useState<CertificateType | null>(null);
  const [studentOpen, setStudentOpen] = useState(false);

  const { settings } = useSchoolSettings(Boolean(schoolId), schoolId);

  // Sections for the school year drive both the grade level and section filters.
  useEffect(() => {
    let isMounted = true;
    if (!canView || !schoolId) {
      setSections([]);
      return;
    }

    const load = async () => {
      setLoadingSections(true);
      try {
        const { data, error } = await supabase
          .from("sms_sections")
          .select("id, name, grade_level")
          .eq("school_id", schoolId)
          .eq("school_year", schoolYear)
          .eq("is_active", true)
          .order("grade_level")
          .order("name");
        if (error) throw error;
        if (!isMounted) return;
        setSections(
          (data || []).map((s) => ({
            id: String(s.id),
            name: s.name as string,
            gradeLevel: s.grade_level as number,
          })),
        );
      } catch (err) {
        console.error("Error loading sections:", err);
        if (!isMounted) return;
        toast.error("Failed to load sections");
        setSections([]);
      } finally {
        if (isMounted) setLoadingSections(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [canView, schoolId, schoolYear]);

  // Reset the dependent filters whenever an upstream filter changes.
  useEffect(() => {
    setGradeLevel("");
    setSectionId("");
    setStudentId(ALL_STUDENTS);
  }, [schoolYear]);

  useEffect(() => {
    setSectionId("");
    setStudentId(ALL_STUDENTS);
  }, [gradeLevel]);

  useEffect(() => {
    setStudentId(ALL_STUDENTS);
  }, [sectionId]);

  const gradeLevelOptions = useMemo(
    () => [...new Set(sections.map((s) => s.gradeLevel))].sort((a, b) => a - b),
    [sections],
  );

  const sectionOptions = useMemo(
    () =>
      gradeLevel === ""
        ? []
        : sections.filter((s) => s.gradeLevel === Number(gradeLevel)),
    [sections, gradeLevel],
  );

  const selectedSection = useMemo(
    () => sections.find((s) => s.id === sectionId) ?? null,
    [sections, sectionId],
  );

  // Learners of the selected section — the pool the certificates are cut from.
  useEffect(() => {
    let isMounted = true;
    if (!canView || !schoolId || !selectedSection) {
      setLearners([]);
      return;
    }

    const load = async () => {
      setLoadingLearners(true);
      try {
        const { data, error } = await supabase
          .from("sms_enrollments")
          .select(
            `enrollment_status,
             student:sms_students!sms_enrollments_student_id_fkey(id, lrn, first_name, middle_name, last_name, suffix)`,
          )
          .eq("school_id", schoolId)
          .eq("section_id", selectedSection.id)
          .eq("school_year", schoolYear)
          .eq("status", "approved");
        if (error) throw error;
        if (!isMounted) return;

        const rows = (data || []) as unknown as EnrollmentRow[];
        const list = rows
          .filter(
            (r) =>
              r.student &&
              !EXCLUDED_LIFECYCLE.has(r.enrollment_status ?? ""),
          )
          .map((r) => {
            const s = r.student!;
            return {
              studentId: String(s.id),
              fullName: buildFullName(s),
              listName: buildListName(s),
              lrn: s.lrn,
              gradeLevel: selectedSection.gradeLevel,
              sectionName: selectedSection.name,
            };
          })
          .sort((a, b) => a.listName.localeCompare(b.listName));

        setLearners(list);
      } catch (err) {
        console.error("Error loading learners:", err);
        if (!isMounted) return;
        toast.error("Failed to load learners");
        setLearners([]);
      } finally {
        if (isMounted) setLoadingLearners(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [canView, schoolId, schoolYear, selectedSection]);

  const studentOptions = useMemo(
    () =>
      learners.map((l) => ({
        id: l.studentId,
        label: `${l.listName} — ${l.lrn}`,
        searchValue: `${l.listName} ${l.lrn} ${formatLrn(l.lrn)}`,
      })),
    [learners],
  );

  const selectedLearners = useMemo(
    () =>
      studentId === ALL_STUDENTS
        ? learners
        : learners.filter((l) => l.studentId === studentId),
    [learners, studentId],
  );

  const studentLabel =
    studentId === ALL_STUDENTS
      ? "All students in section"
      : (studentOptions.find((s) => s.id === studentId)?.label ??
        "All students in section");

  const handleGenerate = async (type: CertificateType) => {
    if (!schoolId || selectedLearners.length === 0) return;
    try {
      setGenerating(type);
      await generateCertificatesPrint({
        schoolId,
        type,
        schoolYear,
        learners: selectedLearners,
        preparedBy: user?.name ?? "",
        preparedByTitle: null,
        principalName: settings.principal_name,
        principalTitle: settings.principal_title,
      });
      toast.success(
        `${CERTIFICATE_TITLES[type]} generated. Use the print dialog to save as PDF.`,
      );
    } catch (err) {
      console.error("Error generating certificate:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to generate certificate",
      );
    } finally {
      setGenerating(null);
    }
  };

  if (!canView) return <ReportAccessDenied />;

  const canGenerate =
    Boolean(sectionId) && selectedLearners.length > 0 && !loadingLearners;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <Link
        href="/school-reports"
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Reports
      </Link>

      <Card className="border-0 shadow-lg">
        <CardHeader>
          <CardTitle className="text-lg">
            Enrollment and Good Moral Certificates
          </CardTitle>
          <CardDescription>
            Select a section to print certificates for the whole class, or pick
            a single learner.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5 w-full sm:w-48">
              <Label className="text-xs text-muted-foreground">
                School Year
              </Label>
              <Select value={schoolYear} onValueChange={setSchoolYear}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="School Year" />
                </SelectTrigger>
                <SelectContent>
                  {getSchoolYearOptions().map((sy) => (
                    <SelectItem key={sy} value={sy}>
                      {sy}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 w-full sm:w-48">
              <Label className="text-xs text-muted-foreground">
                Grade Level
              </Label>
              <Select
                value={gradeLevel}
                onValueChange={setGradeLevel}
                disabled={loadingSections || gradeLevelOptions.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select grade level" />
                </SelectTrigger>
                <SelectContent>
                  {gradeLevelOptions.map((gl) => (
                    <SelectItem key={gl} value={String(gl)}>
                      {getGradeLevelLabel(gl)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 w-full sm:w-56">
              <Label className="text-xs text-muted-foreground">Section</Label>
              <Select
                value={sectionId}
                onValueChange={setSectionId}
                disabled={sectionOptions.length === 0}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
                <SelectContent>
                  {sectionOptions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 w-full sm:w-80">
              <Label className="text-xs text-muted-foreground">
                Student (optional)
              </Label>
              <Popover open={studentOpen} onOpenChange={setStudentOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={studentOpen}
                    disabled={!sectionId || learners.length === 0}
                    className="w-full justify-between font-normal"
                  >
                    <span className="truncate">{studentLabel}</span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search student..." />
                    <CommandList>
                      <CommandEmpty>No student found.</CommandEmpty>
                      <CommandGroup>
                        <CommandItem
                          value="All students in section"
                          onSelect={() => {
                            setStudentId(ALL_STUDENTS);
                            setStudentOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              studentId === ALL_STUDENTS
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          All students in section
                        </CommandItem>
                        {studentOptions.map((s) => (
                          <CommandItem
                            key={s.id}
                            // searchValue carries the LRN in both spellings so a
                            // paste of the dashed display form still matches.
                            value={s.searchValue}
                            onSelect={() => {
                              setStudentId(s.id);
                              setStudentOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                studentId === s.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {s.label}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!canGenerate || generating !== null}
              onClick={() => handleGenerate("enrollment")}
            >
              {generating === "enrollment" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 mr-2" />
              )}
              Enrollment Certificate
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canGenerate || generating !== null}
              onClick={() => handleGenerate("good_moral")}
            >
              {generating === "good_moral" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Printer className="h-4 w-4 mr-2" />
              )}
              Good Moral Certificate
            </Button>
          </div>

          {!sectionId ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Select a school year, grade level and section to begin.
            </p>
          ) : loadingLearners ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : selectedLearners.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No enrolled learners found for this section in SY {schoolYear}.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {selectedLearners.length} certificate
                {selectedLearners.length === 1 ? "" : "s"} will be generated —
                one page per learner.
              </p>
              <div className="app__table_shell">
                <div className="app__table_wrapper">
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left font-medium w-8">#</th>
                        <th className="text-left font-medium">
                          Learner
                        </th>
                        <th className="text-left font-medium">LRN</th>
                        <th className="text-left font-medium">Grade</th>
                        <th className="text-left font-medium">
                          Section
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedLearners.map((l, i) => (
                        <tr key={l.studentId}>
                          <td className="text-muted-foreground">
                            {i + 1}
                          </td>
                          <td className="font-medium">{l.listName}</td>
                          <td>{l.lrn}</td>
                          <td>
                            {getGradeLevelLabel(l.gradeLevel)}
                          </td>
                          <td>{l.sectionName}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
