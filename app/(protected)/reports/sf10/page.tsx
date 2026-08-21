"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { generateSf10Print } from "@/lib/pdf/generateSf10";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { escapeIlikePattern, formatLrn } from "@/lib/utils";
import { ArrowLeft, ClipboardEdit, FileText, Loader2, Printer, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";

interface SchoolOption {
  id: string;
  name: string;
}

interface StudentResult {
  id: string;
  lrn: string;
  fullName: string;
  gradeLevel: number | null;
  sectionName: string;
}

function getFormType(gradeLevel: number | null): string {
  if (gradeLevel === null) return "—";
  if (gradeLevel <= 6) return "SF10-ES";
  if (gradeLevel <= 10) return "SF10-JHS";
  return "SF10-SHS";
}

function gradeLevelLabel(gl: number | null): string {
  if (gl === null) return "—";
  if (gl === 0) return "Kindergarten";
  if (gl <= 6) return `Grade ${gl} (Elementary)`;
  if (gl <= 10) return `Grade ${gl} (JHS)`;
  return `Grade ${gl} (SHS)`;
}

export default function Sf10Page() {
  const user = useAppSelector((state) => state.user.user);
  const router = useRouter();
  const isDivisionAdmin =
    user?.type === "division_admin" || user?.type === "division_type";

  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [schoolId, setSchoolId] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [results, setResults] = useState<StudentResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [printing, setPrinting] = useState<string | null>(null);
  const [loadingSchools, setLoadingSchools] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveSchoolId = isDivisionAdmin
    ? schoolId
    : ((user?.school_id as string | undefined) ?? "");

  useEffect(() => {
    if (!isDivisionAdmin) return;
    setLoadingSchools(true);
    supabase
      .from("sms_schools")
      .select("id, name")
      .eq("is_active", true)
      .order("name")
      .then(({ data }) => {
        setSchools(data || []);
        setLoadingSchools(false);
      });
  }, [isDivisionAdmin]);

  const doSearch = useCallback(
    async (q: string, sid: string) => {
      if (!q.trim() || q.trim().length < 2) {
        setResults([]);
        return;
      }
      if (!sid) {
        setResults([]);
        return;
      }
      setSearching(true);
      try {
        const escaped = escapeIlikePattern(q.trim());
        const { data: students } = await supabase
          .from("sms_students")
          .select(
            "id, lrn, first_name, middle_name, last_name, suffix, grade_level, current_section_id",
          )
          .eq("school_id", sid)
          .or(
            `last_name.ilike.%${escaped}%,first_name.ilike.%${escaped}%`,
          )
          .order("last_name")
          .order("first_name")
          .limit(30);

        if (!students || students.length === 0) {
          setResults([]);
          return;
        }

        // Fetch section names for current_section_id
        const sectionIds = [
          ...new Set(
            students
              .map((s) => s.current_section_id)
              .filter((id): id is string => !!id),
          ),
        ];

        const sectionMap = new Map<string, { name: string; grade_level: number }>();
        if (sectionIds.length > 0) {
          const { data: sections } = await supabase
            .from("sms_sections")
            .select("id, name, grade_level")
            .in("id", sectionIds);
          (sections || []).forEach((s) => sectionMap.set(s.id, s));
        }

        const mapped: StudentResult[] = students.map((s) => {
          const section = s.current_section_id
            ? sectionMap.get(s.current_section_id)
            : null;
          const gradeLevel = section?.grade_level ?? s.grade_level ?? null;
          return {
            id: s.id,
            lrn: s.lrn,
            fullName:
              `${s.last_name}, ${s.first_name} ${s.middle_name || ""} ${s.suffix || ""}`.trim(),
            gradeLevel,
            sectionName: section?.name ?? "",
          };
        });

        setResults(mapped);
      } finally {
        setSearching(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      doSearch(query, effectiveSchoolId);
    }, 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, effectiveSchoolId, doSearch]);

  const handlePrint = async (studentId: string, studentName: string) => {
    try {
      setPrinting(studentId);
      await generateSf10Print({ studentId });
      toast.success(
        `SF10 for ${studentName} generated. Use browser print (Ctrl/Cmd+P) to save as PDF.`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to generate SF10",
      );
    } finally {
      setPrinting(null);
    }
  };

  const hasSchool = !!effectiveSchoolId;

  return (
    <div>
      <div className="app__title">
        <h1 className="app__title_text flex items-center gap-2">
          <FileText className="h-5 w-5" />
          SF10 – Learner&apos;s Permanent Academic Record
        </h1>
      </div>

      <div className="app__content space-y-5">
        {/* Back link */}
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Reports
        </Link>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle>Search Student</CardTitle>
            <CardDescription>
              Search by last name or first name to find a student and print
              their SF10 permanent academic record.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4 items-end">
              {isDivisionAdmin && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">School</label>
                  <Select
                    value={schoolId}
                    onValueChange={(v) => {
                      setSchoolId(v);
                      setResults([]);
                    }}
                    disabled={loadingSchools}
                  >
                    <SelectTrigger className="w-[280px]">
                      <SelectValue placeholder="Select school" />
                    </SelectTrigger>
                    <SelectContent>
                      {schools.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-col gap-2 flex-1 min-w-[240px]">
                <label className="text-sm font-medium">Student Name</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-9"
                    placeholder="Type last name or first name…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={!hasSchool}
                  />
                </div>
                {!hasSchool && isDivisionAdmin && (
                  <p className="text-xs text-muted-foreground">
                    Select a school first.
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Search Results</CardTitle>
            {results.length > 0 && (
              <CardDescription>
                {results.length} student{results.length !== 1 ? "s" : ""} found
              </CardDescription>
            )}
          </CardHeader>
          <CardContent className="p-0 app__table_dress">
            {searching ? (
              <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            ) : query.trim().length >= 2 && results.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                No students found matching &quot;{query}&quot;.
              </div>
            ) : query.trim().length < 2 ? (
              <div className="text-center py-12 text-muted-foreground text-sm">
                Enter at least 2 characters to search.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student Name</TableHead>
                    <TableHead>LRN</TableHead>
                    <TableHead>Grade Level</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Form Type</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="font-medium">{s.fullName}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-sm">
                        {formatLrn(s.lrn)}
                      </TableCell>
                      <TableCell>{gradeLevelLabel(s.gradeLevel)}</TableCell>
                      <TableCell>{s.sectionName || "—"}</TableCell>
                      <TableCell>
                        <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                          {getFormType(s.gradeLevel)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            router.push(
                              `/reports/sf10/historical?studentId=${s.id}`,
                            )
                          }
                        >
                          <ClipboardEdit className="mr-1.5 h-3.5 w-3.5" />
                          Encode Historical
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handlePrint(s.id, s.fullName)}
                          disabled={!!printing}
                        >
                          {printing === s.id ? (
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Printer className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          Print SF10
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Info note */}
        <p className="text-xs text-muted-foreground">
          The form type is determined automatically based on the student&apos;s current
          grade level: <strong>SF10-ES</strong> (K–Grade 6),{" "}
          <strong>SF10-JHS</strong> (Grade 7–10), <strong>SF10-SHS</strong>{" "}
          (Grade 11–12). The printed record covers all years on file.
        </p>
      </div>
    </div>
  );
}
