"use client";

import { Badge } from "@/components/ui/badge";
import { formatLrn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import {
  getSubjectProgramShortLabel,
  type SubjectProgram,
} from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import {
  getCurrentSchoolYear,
  getGradingPeriods,
  isTermBasedSchoolYear,
} from "@/lib/utils/schoolYear";
import { Student } from "@/types";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface SubjectOption {
  id: string;
  name: string;
  section_id: string;
  section_name: string;
  program: SubjectProgram;
}

interface UserWithSystemId {
  system_user_id?: number;
}

interface TeacherGradeEntryTableProps {
  schoolYear: string;
  setSchoolYear: (value: string) => void;
  subjects: SubjectOption[];
  selectedSubject: string;
  setSelectedSubject: (value: string) => void;
  schoolYearOptions: string[];
  teacherId: number;
  user: UserWithSystemId | null;
}


export function TeacherGradeEntryTable({
  schoolYear,
  setSchoolYear,
  subjects,
  selectedSubject,
  setSelectedSubject,
  schoolYearOptions,
  teacherId,
  user,
}: TeacherGradeEntryTableProps) {
  const [subjectId, sectionId] = selectedSubject
    ? selectedSubject.split("_")
    : ["", ""];
  // 3 terms for MATATAG (SY 2026-2027+), otherwise 4 quarters.
  const gradingPeriods = getGradingPeriods(schoolYear);
  const [students, setStudents] = useState<Student[]>([]);
  const [enrollmentStatusMap, setEnrollmentStatusMap] = useState<Record<string, string>>({});
  const [grades, setGrades] = useState<
    Record<string, Record<number, number>>
  >({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isValidAssignment, setIsValidAssignment] = useState(false);
  const [isValidating, setIsValidating] = useState(true);

  const fullUser = useAppSelector((state) => state.user.user);
  const isPreviousYear = schoolYear !== getCurrentSchoolYear();
  const { settings, isLoading: settingsLoading } = useSchoolSettings(true, fullUser?.school_id);
  const yearLocked = isPreviousYear && !settings.allow_edit_previous_school_year;
  // For term-based SYs (MATATAG 2026-2027+) grades are computed and posted from
  // the Class Record, so manual entry here is read-only to avoid conflicting writes.
  const termManaged = isTermBasedSchoolYear(schoolYear);
  const editingDisabled = yearLocked || termManaged;

  // Validate assignment and fetch data when props change
  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!sectionId || !subjectId || !teacherId || !schoolYear) {
        setIsValidAssignment(false);
        setIsValidating(false);
        return;
      }

      setIsValidating(true);
      setIsValidAssignment(false);
      setStudents([]);
      setEnrollmentStatusMap({});
      setGrades({});

      const isValid = await validateAssignment();
      if (!isMounted) return;

      setIsValidAssignment(isValid);
      setIsValidating(false);

      if (isValid) {
        await fetchStudents();
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [sectionId, subjectId, schoolYear, teacherId]);

  const validateAssignment = async (): Promise<boolean> => {
    if (!sectionId || !subjectId || !teacherId || !schoolYear) {
      return false;
    }

    // `.limit(1)` before `.maybeSingle()`: a subject that meets in several
    // time blocks is several `sms_subject_schedules` rows, and maybeSingle on
    // its own errors (PGRST116) on more than one — which read as "not
    // assigned" for exactly the teachers who are most assigned.
    const { data, error } = await supabase
      .from("sms_subject_schedules")
      .select("id")
      .eq("teacher_id", teacherId)
      .eq("subject_id", subjectId)
      .eq("section_id", sectionId)
      .eq("school_year", schoolYear)
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      const { data: sectionData } = await supabase
        .from("sms_sections")
        .select("section_adviser_id")
        .eq("id", sectionId)
        .eq("section_adviser_id", teacherId)
        .eq("school_year", schoolYear)
        .single();

      return !!sectionData;
    }

    return true;
  };

  const fetchStudents = async () => {
    if (!sectionId || !schoolYear) return;

    setLoading(true);
    try {
      // Check whether this subject is selectively enrolled (MEP or ALS — the
      // flag is derived from program by migration 133) by querying the database
      // directly (cannot rely on subjects prop due to timing — it may not be
      // populated yet)
      const { data: subjectData } = await supabase
        .from("sms_subjects")
        .select("is_madrasah")
        .eq("id", subjectId)
        .single();
      const isMadrasah = subjectData?.is_madrasah ?? false;

      let studentIds: string[];

      if (isMadrasah) {
        // Madrasah: fetch only selectively enrolled students
        const { data: studentSubjects, error: studentSubjectsError } =
          await supabase
            .from("sms_student_subjects")
            .select("student_id")
            .eq("subject_id", subjectId)
            .eq("section_id", sectionId)
            .eq("school_year", schoolYear);

        if (studentSubjectsError) {
          console.error(
            "Error fetching Madrasah enrollments:",
            studentSubjectsError
          );
          toast.error("Failed to load Madrasah enrollments");
          setStudents([]);
          setGrades({});
          return;
        }

        studentIds = (studentSubjects || []).map((ss) => ss.student_id);
      } else {
        // Regular: fetch approved and promoted enrollments
        const { data: enrollments, error: enrollmentError } = await supabase
          .from("sms_enrollments")
          .select("student_id, status, enrollment_status")
          .eq("section_id", sectionId)
          .eq("school_year", schoolYear)
          .eq("status", "approved")
          .in("enrollment_status", ["active", "promoted", "graduated", "retained", "completed"]);

        if (enrollmentError) {
          console.error("Error fetching enrollments:", enrollmentError);
          toast.error("Failed to load enrollments");
          setStudents([]);
          setGrades({});
          return;
        }

        const statusMap: Record<string, string> = {};
        (enrollments || []).forEach((e) => {
          statusMap[String(e.student_id)] = e.enrollment_status;
        });
        setEnrollmentStatusMap(statusMap);

        studentIds = (enrollments || []).map(
          (enrollment) => enrollment.student_id
        );
      }

      if (studentIds.length > 0) {
        const { data, error: studentsError } = await supabase
          .from("sms_students")
          .select("*")
          .in("id", studentIds)
          .order("last_name")
          .order("first_name");

        if (studentsError) {
          console.error("Error fetching students:", studentsError);
          toast.error("Failed to load students");
          setStudents([]);
          setGrades({});
          return;
        }

        if (data) {
          setStudents(data);
          const initialGrades: Record<string, Record<number, number>> = {};
          data.forEach((student) => {
            initialGrades[student.id] = {
              1: 0,
              2: 0,
              3: 0,
              4: 0,
            };
          });
          setGrades(initialGrades);

          const idsToFetch = data.map((s) => s.id);
          await fetchGrades(idsToFetch);
        }
      } else {
        setStudents([]);
        setGrades({});
      }
    } catch (error) {
      console.error("Error fetching students:", error);
      toast.error("Failed to load students");
      setStudents([]);
      setGrades({});
    } finally {
      setLoading(false);
    }
  };

  const fetchGrades = async (studentIdsToFetch?: string[]) => {
    const idsToUse = studentIdsToFetch || students.map((s) => s.id);

    if (!sectionId || !subjectId || !idsToUse.length) return;

    try {
      const { data, error } = await supabase
        .from("sms_grades")
        .select("*")
        .eq("section_id", sectionId)
        .eq("subject_id", subjectId)
        .in("grading_period", [1, 2, 3, 4])
        .eq("school_year", schoolYear)
        .in("student_id", idsToUse);

      if (error) {
        console.error("Error fetching grades:", error);
        return;
      }

      if (data && data.length > 0) {
        setGrades((prev) => {
          const next = { ...prev };
          data.forEach((grade) => {
            if (!next[grade.student_id]) {
              next[grade.student_id] = { 1: 0, 2: 0, 3: 0, 4: 0 };
            }
            next[grade.student_id] = {
              ...next[grade.student_id],
              [grade.grading_period]: grade.grade,
            };
          });
          return next;
        });
      }
    } catch (error) {
      console.error("Error fetching grades:", error);
    }
  };

  const handleGradeChange = (
    studentId: string,
    gradingPeriod: number,
    value: string
  ) => {
    const numValue = Math.round(parseFloat(value)) || 0;
    if (numValue >= 0 && numValue <= 100) {
      setGrades((prev) => ({
        ...prev,
        [studentId]: {
          ...prev[studentId],
          [gradingPeriod]: numValue,
        },
      }));
    }
  };

  const handleSave = async () => {
    if (!user?.system_user_id) {
      toast.error("User not authenticated");
      return;
    }

    if (!isValidAssignment) {
      toast.error("You are not assigned to this subject-section combination");
      return;
    }

    if (yearLocked) {
      toast.error("Editing previous school year records is disabled");
      return;
    }

    if (termManaged) {
      toast.error("Grades for this school year are managed in the Class Record");
      return;
    }

    setSaving(true);
    try {
      const editableStudents = students.filter((student) => {
        const status = enrollmentStatusMap[String(student.id)];
        const isPromoted = status === "promoted";
        return !(isPromoted && !settings.allow_edit_promoted_student_grades);
      });

      const gradeEntries: Array<{
        student_id: string;
        subject_id: string;
        section_id: string;
        grading_period: number;
        school_year: string;
        grade: number;
        remarks: string;
        teacher_id: number;
      }> = [];

      editableStudents.forEach((student) => {
        const studentGrades = grades[student.id] || { 1: 0, 2: 0, 3: 0, 4: 0 };
        gradingPeriods.forEach(({ value: period }) => {
          const grade = Math.round(studentGrades[period] ?? 0);
          gradeEntries.push({
            student_id: student.id,
            subject_id: subjectId,
            section_id: sectionId,
            grading_period: period,
            school_year: schoolYear,
            grade,
            remarks: grade >= 75 ? "Passed" : "Failed",
            teacher_id: user.system_user_id!,
          });
        });
      });

      const editableIds = editableStudents.map((s) => s.id);

      if (editableIds.length > 0) {
        await supabase
          .from("sms_grades")
          .delete()
          .eq("section_id", sectionId)
          .eq("subject_id", subjectId)
          .eq("school_year", schoolYear)
          .in("student_id", editableIds);
      }

      const { error } = editableIds.length > 0
        ? await supabase.from("sms_grades").insert(gradeEntries)
        : { error: null };

      if (error) throw error;

      toast.success("Grades saved successfully!");
    } catch (err) {
      console.error("Error saving grades:", err);
      toast.error("Failed to save grades");
    } finally {
      setSaving(false);
    }
  };

  if (isValidating) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Validating assignment...
      </div>
    );
  }

  if (!selectedSubject) {
    return (
      <div className="space-y-4">
        <div className="sticky top-0 z-10 bg-card border-b px-4 py-4 shadow-sm">
          <div className="flex items-end justify-between gap-4">
            <div className="grid grid-cols-2 gap-4 flex-1 max-w-md">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  School Year
                </label>
                <Select value={schoolYear} onValueChange={setSchoolYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select school year" />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolYearOptions.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Subject
                </label>
                <Select
                  value={selectedSubject}
                  onValueChange={setSelectedSubject}
                  disabled={!schoolYear}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => (
                      <SelectItem
                        key={`${subject.id}_${subject.section_id}`}
                        value={`${subject.id}_${subject.section_id}`}
                      >
                        {subject.name} - {subject.section_name}
                        {subject.program !== "regular"
                          ? ` (${getSubjectProgramShortLabel(subject.program)})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        <div className="text-center py-8 text-muted-foreground">
          Select a subject to enter grades
        </div>
      </div>
    );
  }

  if (!isValidAssignment) {
    return (
      <div className="space-y-4">
        <div className="sticky top-0 z-10 bg-card border-b px-4 py-4 shadow-sm">
          <div className="flex items-end justify-between gap-4">
            <div className="grid grid-cols-2 gap-4 flex-1 max-w-md">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  School Year
                </label>
                <Select value={schoolYear} onValueChange={setSchoolYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select school year" />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolYearOptions.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Subject
                </label>
                <Select
                  value={selectedSubject}
                  onValueChange={setSelectedSubject}
                  disabled={!schoolYear}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => (
                      <SelectItem
                        key={`${subject.id}_${subject.section_id}`}
                        value={`${subject.id}_${subject.section_id}`}
                      >
                        {subject.name} - {subject.section_name}
                        {subject.program !== "regular"
                          ? ` (${getSubjectProgramShortLabel(subject.program)})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        <div className="text-center py-8 text-muted-foreground">
          You are not assigned to this subject-section combination for the
          selected school year.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="sticky top-0 z-10 bg-card border-b px-4 py-4 shadow-sm">
          <div className="flex items-end justify-between gap-4">
            <div className="grid grid-cols-2 gap-4 flex-1 max-w-md">
              <div>
                <label className="text-sm font-medium mb-2 block">
                  School Year
                </label>
                <Select value={schoolYear} onValueChange={setSchoolYear}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select school year" />
                  </SelectTrigger>
                  <SelectContent>
                    {schoolYearOptions.map((year) => (
                      <SelectItem key={year} value={year}>
                        {year}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">
                  Subject
                </label>
                <Select
                  value={selectedSubject}
                  onValueChange={setSelectedSubject}
                  disabled={!schoolYear}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjects.map((subject) => (
                      <SelectItem
                        key={`${subject.id}_${subject.section_id}`}
                        value={`${subject.id}_${subject.section_id}`}
                      >
                        {subject.name} - {subject.section_name}
                        {subject.program !== "regular"
                          ? ` (${getSubjectProgramShortLabel(subject.program)})`
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
        <div className="text-center py-8">Loading students...</div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      <div className="sticky top-0 z-10 bg-card border-b shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-4 pb-3">
          <div className="grid grid-cols-2 gap-4 flex-1 min-w-64 max-w-md">
            <div>
              <label className="text-sm font-medium mb-2 block">
                School Year
              </label>
              <Select value={schoolYear} onValueChange={setSchoolYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Select school year" />
                </SelectTrigger>
                <SelectContent>
                  {schoolYearOptions.map((year) => (
                    <SelectItem key={year} value={year}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium mb-2 block">
                Subject
              </label>
              <Select
                value={selectedSubject}
                onValueChange={setSelectedSubject}
                disabled={!schoolYear}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((subject) => (
                    <SelectItem
                      key={`${subject.id}_${subject.section_id}`}
                      value={`${subject.id}_${subject.section_id}`}
                    >
                      {subject.name} - {subject.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleSave} disabled={saving || editingDisabled || settingsLoading} className="shrink-0">
            {saving ? "Saving..." : "Save Grades"}
          </Button>
        </div>
        {/* Lock/read-only notices sit on their own row: as flex siblings of the
            filters they squeezed the selects and overlapped them on narrow
            viewports. */}
        {(yearLocked ||
          termManaged ||
          (!settings.allow_edit_promoted_student_grades &&
            Object.values(enrollmentStatusMap).some((s) => s === "promoted"))) && (
          <div className="px-4 pb-3 space-y-1">
            {yearLocked && (
              <p className="text-sm text-muted-foreground">
                Editing records from previous school years is disabled.
              </p>
            )}
            {termManaged && (
              <p className="text-sm text-muted-foreground">
                Read-only — term grades are posted from the{" "}
                <strong>Class Record</strong>.
              </p>
            )}
            {!settings.allow_edit_promoted_student_grades &&
              Object.values(enrollmentStatusMap).some((s) => s === "promoted") && (
                <p className="text-sm text-muted-foreground">
                  Grades for promoted students are locked.
                </p>
              )}
          </div>
        )}
        <div className="overflow-auto max-h-[calc(100vh-280px)]">
          <table className="w-full">
            <thead className="sticky top-0 z-[9] bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium">
                  Student
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium">LRN</th>
                {gradingPeriods.map(({ value, label }) => (
                  <th
                    key={value}
                    className="px-4 py-3 text-left text-sm font-medium w-28"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {students.map((student) => {
                const studentGrades = grades[student.id] || {
                  1: 0,
                  2: 0,
                  3: 0,
                  4: 0,
                };
                const enrollmentStatus = enrollmentStatusMap[String(student.id)] ?? "active";
                const isPromoted = enrollmentStatus === "promoted";
                const promotedLocked = isPromoted && !settings.allow_edit_promoted_student_grades;
                return (
                  <tr key={student.id} className={`hover:bg-muted/50 ${promotedLocked ? "opacity-60" : ""}`}>
                    <td className="px-4 py-3">
                      <span>{student.last_name}, {student.first_name}</span>
                      {enrollmentStatus !== "active" && (
                        <Badge
                          variant={isPromoted ? "secondary" : "outline"}
                          className="ml-2 text-[10px] px-1.5 py-0"
                        >
                          {enrollmentStatus.replace(/_/g, " ")}
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-sm">{formatLrn(student.lrn)}</td>
                    {gradingPeriods.map(({ value }) => {
                      const grade = studentGrades[value] ?? 0;
                      return (
                        <td key={value} className="px-4 py-3">
                          <Input
                            type="number"
                            min="60"
                            max="100"
                            step="1"
                            value={grade ? Math.round(grade) : ""}
                            onChange={(e) =>
                              handleGradeChange(
                                student.id,
                                value,
                                e.target.value
                              )
                            }
                            onWheel={(e) => e.currentTarget.blur()}
                            disabled={editingDisabled || settingsLoading || promotedLocked}
                            className="w-full"
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
