"use client";

import { ManageMadrasahStudentsModal } from "@/app/(protected)/sections/ManageMadrasahStudentsModal";
import { TemporaryScheduleBadge } from "@/components/TemporaryScheduleBadge";
import { formatLrn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSchoolSettings } from "@/hooks/useSchoolSettings";
import {
  ALS_SECTION_TYPE,
  CRLA_GRADES,
  getGradeLevelLabel,
  getSubjectProgram,
  isAlsSectionType,
  getSubjectProgramShortLabel,
  isSelectiveProgram,
  isTerminalGrade,
  canEnrolLearners,
  PHILIRI_GRADES,
  RMA_GRADES,
} from "@/lib/constants";
import { CoreValuesEntryModal } from "../../components/CoreValuesEntryModal";
import { GeneratePortalCodeModal } from "../../components/GeneratePortalCodeModal";
import { PrintCardModal } from "../../components/PrintCardModal";
import { generateEccdCardPrint } from "@/lib/pdf/generateEccdCard";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { formatDays, formatTimeRange } from "@/lib/utils/scheduleConflicts";
import { Section, Student, Subject, SubjectSchedule } from "@/types";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart2,
  Calendar,
  ClipboardCheck,
  Download,
  FileBarChart,
  GraduationCap,
  Heart,
  KeyRound,
  Layers,
  MoreVertical,
  NotebookPen,
  Pencil,
  Printer,
  Star,
  UserCircle,
  UserX,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { PromoteStudentModal } from "../../components/PromoteStudentModal";
import { RetainNlisModal } from "../../components/RetainNlisModal";
import { TeacherEditStudentModal } from "../../components/TeacherEditStudentModal";
import { TransferOutModal } from "../../components/TransferOutModal";
import { ViewStudentGradesModal } from "../../components/ViewStudentGradesModal";

export default function Page() {
  const params = useParams();
  const router = useRouter();
  const sectionId = params.id as string;
  const user = useAppSelector((state) => state.user.user);
  const canEnrol = canEnrolLearners(user?.type);
  const [section, setSection] = useState<Section | null>(null);
  const [enrollments, setEnrollments] = useState<
    Array<{
      id: string;
      student: Student;
      grade_level: number;
      enrollment_date: string;
      enrollment_status: string;
    }>
  >([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [schedules, setSchedules] = useState<SubjectSchedule[]>([]);
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [manageMadrasahOpen, setManageMadrasahOpen] = useState(false);
  const [selectedMadrasahSubject, setSelectedMadrasahSubject] =
    useState<Subject | null>(null);
  const [adviser, setAdviser] = useState<{ name: string } | null>(null);
  const [schoolName, setSchoolName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [genderFilter, setGenderFilter] = useState<"all" | "male" | "female">(
    "all",
  );
  const [printCardStudent, setPrintCardStudent] = useState<{
    studentId: string;
    studentName: string;
  } | null>(null);
  const [eccdPrintingId, setEccdPrintingId] = useState<string | null>(null);
  const [promoteStudent, setPromoteStudent] = useState<{
    student: Student;
    enrollmentId: string;
    gradeLevel: number;
  } | null>(null);
  const [editStudent, setEditStudent] = useState<Student | null>(null);
  const [portalCodeStudent, setPortalCodeStudent] = useState<Student | null>(
    null,
  );
  const [retainNlisStudent, setRetainNlisStudent] = useState<{
    student: Student;
    enrollmentId: string;
    gradeLevel: number;
  } | null>(null);
  const [transferOutStudent, setTransferOutStudent] = useState<{
    student: Student;
    enrollmentId: string;
    gradeLevel: number;
  } | null>(null);
  const [viewGradesStudent, setViewGradesStudent] = useState<{
    studentId: string;
    studentName: string;
  } | null>(null);
  const [coreValuesEntryStudent, setCoreValuesEntryStudent] = useState<{
    studentId: string;
    studentName: string;
  } | null>(null);

  const { settings: schoolSettings } = useSchoolSettings(true, user?.school_id);
  const isPromotionOverdue =
    !!schoolSettings.promotion_deadline &&
    new Date(schoolSettings.promotion_deadline + "T23:59:59") < new Date();

  const fetchSectionData = useCallback(async () => {
    if (!sectionId || !user?.system_user_id) return;

    setLoading(true);
    try {
      // Super admins can view any section in their active school; regular
      // teachers may only view sections they advise.
      const isSuperAdmin = user.type === "super admin";

      let sectionQuery = supabase
        .from("sms_sections")
        .select("*")
        .eq("id", sectionId)
        .eq("is_active", true);

      if (isSuperAdmin) {
        if (user.school_id != null) {
          sectionQuery = sectionQuery.eq("school_id", Number(user.school_id));
        }
      } else {
        sectionQuery = sectionQuery.eq(
          "section_adviser_id",
          user.system_user_id
        );
      }

      const { data: sectionData } = await sectionQuery.single();

      if (!sectionData) {
        router.replace("/teacher/sections");
        return;
      }

      setSection(sectionData);

      // Fetch school name (for printed list header)
      if (user?.school_id != null) {
        const { data: schoolData } = await supabase
          .from("sms_schools")
          .select("name")
          .eq("id", String(user.school_id))
          .single();
        if (schoolData?.name) setSchoolName(schoolData.name);
      }

      // Fetch adviser name
      if (sectionData.section_adviser_id) {
        const { data: adviserData } = await supabase
          .from("sms_users")
          .select("name")
          .eq("id", sectionData.section_adviser_id)
          .single();

        if (adviserData) {
          setAdviser({ name: adviserData.name });
        }
      }

      // Fetch enrolled students from sms_enrollments (approved enrollments)
      const { data: enrollmentsData } = await supabase
        .from("sms_enrollments")
        .select(
          `
          id,
          grade_level,
          enrollment_date,
          enrollment_status,
          student:sms_students!sms_enrollments_student_id_fkey(*)
        `,
        )
        .eq("section_id", sectionId)
        .eq("school_year", sectionData.school_year)
        .eq("status", "approved")
        .order("enrollment_date", { ascending: true });

      if (enrollmentsData) {
        const validEnrollments = enrollmentsData
          .filter((e) => {
            const student = Array.isArray(e.student) ? e.student[0] : e.student;
            return !!student;
          })
          .map((e) => {
            const student = Array.isArray(e.student)
              ? e.student[0]
              : (e.student as Student);
            return {
              id: e.id,
              student,
              grade_level: e.grade_level,
              enrollment_date: e.enrollment_date,
              enrollment_status:
                ((e as Record<string, unknown>).enrollment_status as string) ||
                "active",
            };
          })
          .sort(
            (a, b) =>
              a.student.last_name.localeCompare(b.student.last_name) ||
              a.student.first_name.localeCompare(b.student.first_name),
          );
        setEnrollments(validEnrollments);
      }

      // Fetch subjects for this grade level. ALS subjects belong to ALS
      // sections and nowhere else (migration 136).
      let subjectsQuery = supabase
        .from("sms_subjects")
        .select("*")
        .eq("grade_level", sectionData.grade_level)
        .eq("is_active", true)
        .order("code", { ascending: true });
      subjectsQuery = isAlsSectionType(sectionData.section_type)
        ? subjectsQuery.eq("program", ALS_SECTION_TYPE)
        : subjectsQuery.neq("program", ALS_SECTION_TYPE);
      if (user?.school_id != null) {
        subjectsQuery = subjectsQuery.eq("school_id", user.school_id);
      }
      const { data: subjectsData } = await subjectsQuery;
      setSubjects(subjectsData || []);

      // Fetch schedules with teacher and room names
      let schedulesQuery = supabase
        .from("sms_subject_schedules")
        .select(
          `
          *,
          teacher:teacher_id (id, name),
          room:room_id (id, name)
        `,
        )
        .eq("section_id", sectionId)
        .eq("school_year", sectionData.school_year)
        .order("start_time", { ascending: true });
      if (user?.school_id != null) {
        schedulesQuery = schedulesQuery.eq("school_id", user.school_id);
      }
      const { data: schedulesData } = await schedulesQuery;

      const tNames: Record<string, string> = {};
      const rNames: Record<string, string> = {};
      const cleanSchedules = (schedulesData || []).map((s) => {
        const teacher = s.teacher as { id: string; name: string } | null;
        const room = s.room as { id: string; name: string } | null;
        if (teacher) tNames[teacher.id] = teacher.name;
        if (room) rNames[room.id] = room.name;
        const { teacher: _t, room: _r, ...schedule } = s;
        return schedule as SubjectSchedule;
      });
      setSchedules(cleanSchedules);
      setTeacherNames(tNames);
      setRoomNames(rNames);
    } catch (error) {
      console.error("Error fetching section data:", error);
    } finally {
      setLoading(false);
    }
  }, [sectionId, user?.system_user_id, router]);

  useEffect(() => {
    if (sectionId && user?.system_user_id) {
      fetchSectionData();
    }
  }, [sectionId, user?.system_user_id, fetchSectionData]);

  const filteredEnrollments = useMemo(() => {
    if (genderFilter === "all") return enrollments;
    return enrollments.filter((e) => e.student.gender === genderFilter);
  }, [enrollments, genderFilter]);

  const exportToExcel = () => {
    const data = filteredEnrollments.map((enrollment, index) => ({
      "#": index + 1,
      "Last Name": enrollment.student.last_name,
      "First Name": enrollment.student.first_name,
      "Middle Name": enrollment.student.middle_name || "",
      LRN: enrollment.student.lrn,
      Gender: enrollment.student.gender
        ? enrollment.student.gender.charAt(0).toUpperCase() +
          enrollment.student.gender.slice(1)
        : "",
      "Grade Level": getGradeLevelLabel(enrollment.grade_level),
      "Enrollment Date": new Date(
        enrollment.enrollment_date,
      ).toLocaleDateString(),
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Students");
    const filterLabel = genderFilter === "all" ? "" : `_${genderFilter}`;
    XLSX.writeFile(
      wb,
      `${section?.name || "Section"}_Students${filterLabel}.xlsx`,
    );
  };

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const printStudentList = () => {
    if (!section || filteredEnrollments.length === 0) return;

    const genderLabel =
      genderFilter === "all"
        ? ""
        : ` (${genderFilter.charAt(0).toUpperCase() + genderFilter.slice(1)})`;

    const rows = filteredEnrollments
      .map((enrollment, index) => {
        const { last_name, first_name, middle_name } = enrollment.student;
        const fullName = [
          last_name,
          ", ",
          first_name,
          middle_name ? ` ${middle_name}` : "",
        ].join("");
        return `<tr><td class="num">${index + 1}</td><td>${escapeHtml(
          fullName,
        )}</td></tr>`;
      })
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Class List - ${escapeHtml(section.name)}</title>
<style>
  @page { size: A4 portrait; margin: 18mm; }
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  .header { text-align: center; margin-bottom: 18px; }
  .school { font-size: 20px; font-weight: 700; text-transform: uppercase; }
  .title { font-size: 16px; font-weight: 700; margin-top: 6px; }
  .meta { font-size: 13px; margin-top: 10px; line-height: 1.5; }
  .meta strong { font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  th, td { border: 1px solid #444; padding: 8px 10px; font-size: 14px; text-align: left; }
  th { background: #f0f0f0; text-transform: uppercase; font-size: 12px; }
  td.num, th.num { width: 48px; text-align: center; }
  tr { page-break-inside: avoid; }
  .footer { margin-top: 24px; font-size: 12px; text-align: right; }
</style>
</head>
<body>
  <div class="header">
    <div class="school">${escapeHtml(schoolName || "School")}</div>
    <div class="title">Section Class List${genderLabel}</div>
    <div class="meta">
      <div><strong>Section:</strong> ${escapeHtml(
        section.name,
      )} &nbsp;&nbsp; <strong>Grade Level:</strong> ${escapeHtml(
        getGradeLevelLabel(section.grade_level),
      )}</div>
      <div><strong>School Year:</strong> ${escapeHtml(
        section.school_year,
      )}${
        adviser
          ? ` &nbsp;&nbsp; <strong>Adviser:</strong> ${escapeHtml(adviser.name)}`
          : ""
      }</div>
      <div><strong>Total Students:</strong> ${filteredEnrollments.length}</div>
    </div>
  </div>
  <table>
    <thead>
      <tr><th class="num">#</th><th>Student Name</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const cleanup = () => {
      // Delay removal so the print dialog can finish reading the document
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    };

    iframe.onload = () => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        cleanup();
        return;
      }
      frameWindow.onafterprint = cleanup;
      frameWindow.focus();
      frameWindow.print();
    };

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      toast.error("Unable to prepare the printable list.");
      cleanup();
      return;
    }
    doc.open();
    doc.write(html);
    doc.close();
  };

  const handlePrintCard = async (studentId: string, studentName: string) => {
    if (!user?.school_id || !section) return;
    if (section.grade_level === 0) {
      setEccdPrintingId(studentId);
      try {
        await generateEccdCardPrint({
          schoolId: user.school_id as string,
          studentId,
          sectionId,
          schoolYear: section.school_year,
        });
      } catch (err) {
        console.error("Error generating ECCD card:", err);
        toast.error("Failed to generate ECCD card");
      } finally {
        setEccdPrintingId(null);
      }
    } else {
      setPrintCardStudent({ studentId, studentName });
    }
  };

  if (loading) {
    return (
      <div>
        <div className="app__title">
          <h1 className="app__title_text">Loading...</h1>
        </div>
        <div className="app__content">
          <div className="text-center py-8 text-muted-foreground">
            Loading section details...
          </div>
        </div>
      </div>
    );
  }

  if (!section) {
    return (
      <div>
        <div className="app__title">
          <h1 className="app__title_text">Section Not Found</h1>
        </div>
        <div className="app__content">
          <div className="app__empty_state">
            <p className="app__empty_state_title">Section not found</p>
            <Link href="/teacher/sections">
              <Button variant="outline">Back to Sections</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="app__title">
        <div className="flex items-center gap-4">
          <Link href="/teacher/sections">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <h1 className="app__title_text flex items-center gap-2">
            <Users className="h-5 w-5" />
            {section.name}
          </h1>
        </div>
        <div className="app__title_actions flex items-center gap-2">
          <Link
            href={`/teacher/school-forms?section=${sectionId}&school_year=${section.school_year}`}
          >
            <Button variant="outline" size="sm">
              <FileBarChart className="h-4 w-4 mr-2" />
              School Forms
            </Button>
          </Link>
          <Link
            href={`/attendance?section=${sectionId}&school_year=${section.school_year}`}
          >
            <Button variant="outline" size="sm">
              <ClipboardCheck className="h-4 w-4 mr-2" />
              Attendance
            </Button>
          </Link>
          <Link
            href={`/health?section=${sectionId}&school_year=${section.school_year}`}
          >
            <Button variant="outline" size="sm">
              <Heart className="h-4 w-4 mr-2" />
              Learners Health
            </Button>
          </Link>
          {section.grade_level === 0 && (
            <Link
              href={`/teacher/eccd?section=${sectionId}&school_year=${section.school_year}`}
            >
              <Button variant="outline" size="sm">
                <ClipboardCheck className="h-4 w-4 mr-2" />
                ECCD Checklist
              </Button>
            </Link>
          )}
        </div>
      </div>
      <div className="app__content space-y-6">
        {/* Section Info Summary */}
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="secondary"
            className="h-7 gap-1.5 rounded-full border-transparent px-3 py-0 text-xs font-normal shadow-none"
          >
            <Layers className="size-3 shrink-0 opacity-80" aria-hidden />
            <span className="text-muted-foreground">Grade</span>
            <span className="font-semibold text-foreground">
              {getGradeLevelLabel(section.grade_level)}
            </span>
          </Badge>
          <Badge
            variant="secondary"
            className="h-7 gap-1.5 rounded-full border-transparent px-3 py-0 text-xs font-normal shadow-none"
          >
            <Calendar className="size-3 shrink-0 opacity-80" aria-hidden />
            <span className="text-muted-foreground">Year</span>
            <span className="font-semibold text-foreground">
              {section.school_year}
            </span>
          </Badge>
          <Badge
            variant="secondary"
            className="h-7 gap-1.5 rounded-full border-transparent px-3 py-0 text-xs font-normal shadow-none"
          >
            <Users className="size-3 shrink-0 opacity-80" aria-hidden />
            <span className="text-muted-foreground">Students</span>
            <span className="font-semibold tabular-nums text-foreground">
              {enrollments.length}
            </span>
          </Badge>
          {adviser && (
            <Badge
              variant="secondary"
              className="h-auto min-h-7 max-w-full gap-1.5 whitespace-normal rounded-full border-transparent px-3 py-1.5 text-xs font-normal shadow-none sm:max-w-md"
            >
              <UserCircle
                className="size-3 shrink-0 self-center opacity-80"
                aria-hidden
              />
              <span className="shrink-0 text-muted-foreground">Adviser</span>
              <span className="min-w-0 break-words text-left font-semibold leading-snug text-foreground">
                {adviser.name}
              </span>
            </Badge>
          )}
        </div>

        {/* Students Card */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <GraduationCap className="h-5 w-5" />
                  Students ({filteredEnrollments.length}
                  {genderFilter !== "all" && ` of ${enrollments.length}`})
                </CardTitle>
                <CardDescription>
                  List of students enrolled in this section
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-md border bg-muted p-0.5">
                  {(["all", "male", "female"] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setGenderFilter(value)}
                      className={`px-3 py-1.5 text-sm font-medium rounded-sm transition-colors ${
                        genderFilter === value
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={printStudentList}
                  disabled={filteredEnrollments.length === 0}
                >
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportToExcel}
                  disabled={filteredEnrollments.length === 0}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {filteredEnrollments.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                {genderFilter === "all"
                  ? "No students enrolled in this section"
                  : `No ${genderFilter} students enrolled in this section`}
              </div>
            ) : (
              <div className="border rounded-md overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        #
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Student Name
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        LRN
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Gender
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Grade
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium">
                        Enrolled
                      </th>
                      <th className="px-4 py-3 text-center text-sm font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-center text-sm font-medium">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredEnrollments.map((enrollment, index) => (
                      <tr
                        key={enrollment.id}
                        className="hover:bg-muted/50 transition-colors"
                      >
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {index + 1}
                        </td>
                        <td className="px-4 py-3">
                          {enrollment.student.last_name},{" "}
                          {enrollment.student.first_name}
                          {enrollment.student.middle_name &&
                            ` ${enrollment.student.middle_name}`}
                        </td>
                        <td className="px-4 py-3 font-mono text-sm">
                          {formatLrn(enrollment.student.lrn)}
                        </td>
                        <td className="px-4 py-3 text-sm capitalize">
                          {enrollment.student.gender || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                            {getGradeLevelLabel(enrollment.grade_level)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {new Date(
                            enrollment.enrollment_date,
                          ).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {enrollment.enrollment_status === "active" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-blue-100 text-blue-800">
                              Active
                            </span>
                          ) : enrollment.enrollment_status === "promoted" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800">
                              Promoted
                            </span>
                          ) : enrollment.enrollment_status === "graduated" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-purple-100 text-purple-800">
                              Graduated
                            </span>
                          ) : enrollment.enrollment_status === "completed" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                              Completed
                            </span>
                          ) : enrollment.enrollment_status === "retained" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800">
                              Retained
                            </span>
                          ) : enrollment.enrollment_status === "dropped" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800">
                              NLIS/Dropped
                            </span>
                          ) : enrollment.enrollment_status ===
                            "transferred_out" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-orange-100 text-orange-800">
                              Transferred Out
                            </span>
                          ) : enrollment.enrollment_status ===
                            "pending_transfer" ? (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
                              Pending Transfer
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-800">
                              {enrollment.enrollment_status}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  aria-label="Student actions"
                                >
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  disabled={["promoted", "transferred_out", "graduated", "dropped", "completed"].includes(enrollment.enrollment_status)}
                                  onClick={() =>
                                    setEditStudent(enrollment.student)
                                  }
                                >
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  onClick={() =>
                                    setPortalCodeStudent(enrollment.student)
                                  }
                                >
                                  <KeyRound className="mr-2 h-4 w-4" />
                                  Portal Code
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  onClick={() =>
                                    setViewGradesStudent({
                                      studentId: String(enrollment.student.id),
                                      studentName: `${enrollment.student.last_name}, ${enrollment.student.first_name}`,
                                    })
                                  }
                                >
                                  <BarChart2 className="mr-2 h-4 w-4" />
                                  View Grades
                                </DropdownMenuItem>
                                {section.grade_level !== 0 && (
                                  <DropdownMenuItem
                                    className="cursor-pointer"
                                    onClick={() =>
                                      setCoreValuesEntryStudent({
                                        studentId: String(enrollment.student.id),
                                        studentName: `${enrollment.student.last_name}, ${enrollment.student.first_name}`,
                                      })
                                    }
                                  >
                                    <Star className="mr-2 h-4 w-4" />
                                    Core Values Entry
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="cursor-pointer"
                                  disabled={eccdPrintingId === String(enrollment.student.id)}
                                  onClick={() =>
                                    handlePrintCard(
                                      String(enrollment.student.id),
                                      `${enrollment.student.last_name}, ${enrollment.student.first_name}`,
                                    )
                                  }
                                >
                                  <Printer className="mr-2 h-4 w-4" />
                                  {eccdPrintingId === String(enrollment.student.id) ? "Printing..." : "Print Card"}
                                </DropdownMenuItem>
                                {(() => {
                                  const gl = section.grade_level;
                                  const types = [
                                    { key: "crla", label: "CRLA", show: CRLA_GRADES.includes(gl) },
                                    { key: "philiri", label: "Phil-IRI", show: PHILIRI_GRADES.includes(gl) },
                                    { key: "rma", label: "RMA", show: RMA_GRADES.includes(gl) },
                                  ].filter((t) => t.show);
                                  if (types.length === 0) return null;
                                  return (
                                    <DropdownMenuSub>
                                      <DropdownMenuSubTrigger className="cursor-pointer">
                                        <NotebookPen className="mr-2 h-4 w-4" />
                                        Assessments
                                      </DropdownMenuSubTrigger>
                                      <DropdownMenuSubContent>
                                        {types.map((t) => (
                                          <DropdownMenuItem
                                            key={t.key}
                                            className="cursor-pointer"
                                            onClick={() =>
                                              router.push(
                                                `/teacher/assessments/${t.key}?section=${sectionId}&student=${enrollment.student.id}&school_year=${encodeURIComponent(section.school_year)}`,
                                              )
                                            }
                                          >
                                            {t.label}
                                          </DropdownMenuItem>
                                        ))}
                                      </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                  );
                                })()}
                                {/* Promote / Retain / Transfer Out all rewrite
                                    the learner's enrollment row, which is the
                                    one thing a volunteer teacher may not do —
                                    RLS would refuse the write anyway, so the
                                    actions are not offered. */}
                                {enrollment.enrollment_status === "active" &&
                                  canEnrol && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="cursor-pointer"
                                      disabled={isPromotionOverdue}
                                      title={
                                        isPromotionOverdue
                                          ? `Promotion deadline (${schoolSettings.promotion_deadline}) has passed`
                                          : undefined
                                      }
                                      onClick={() =>
                                        setPromoteStudent({
                                          student: enrollment.student,
                                          enrollmentId: enrollment.id,
                                          gradeLevel: enrollment.grade_level,
                                        })
                                      }
                                    >
                                      {isTerminalGrade(
                                        enrollment.grade_level,
                                      ) ? (
                                        <>
                                          <GraduationCap className="mr-2 h-4 w-4" />
                                          Graduate
                                        </>
                                      ) : (
                                        <>
                                          <ArrowUpRight className="mr-2 h-4 w-4" />
                                          Promote
                                        </>
                                      )}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="cursor-pointer"
                                      onClick={() =>
                                        setRetainNlisStudent({
                                          student: enrollment.student,
                                          enrollmentId: enrollment.id,
                                          gradeLevel: enrollment.grade_level,
                                        })
                                      }
                                    >
                                      <UserX className="mr-2 h-4 w-4" />
                                      Retain/NLIS
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="cursor-pointer"
                                      onClick={() =>
                                        setTransferOutStudent({
                                          student: enrollment.student,
                                          enrollmentId: enrollment.id,
                                          gradeLevel: enrollment.grade_level,
                                        })
                                      }
                                    >
                                      <ArrowLeftRight className="mr-2 h-4 w-4" />
                                      Transfer Out
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Schedules Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Schedules ({subjects.length})
            </CardTitle>
            <CardDescription>
              Subject schedules for this section
            </CardDescription>
          </CardHeader>
          <CardContent>
            {subjects.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No subjects found for this section
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {subjects.map((subject) => {
                  const subjectSchedules = schedules.filter(
                    (s) => s.subject_id === subject.id,
                  );
                  const program = getSubjectProgram(subject);
                  return (
                    <div
                      key={subject.id}
                      className="border rounded-md p-4 space-y-2 hover:bg-muted/50"
                    >
                      <div className="font-medium text-base flex items-center gap-2">
                        {subject.code} - {subject.name}
                        {program !== "regular" && (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              program === "als"
                                ? "bg-purple-100 text-purple-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {getSubjectProgramShortLabel(program)}
                          </span>
                        )}
                      </div>
                      {isSelectiveProgram(program) &&
                        subjectSchedules.length > 0 && (
                          <div className="mt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className={
                                program === "als"
                                  ? "h-7 text-purple-700 border-purple-300 hover:bg-purple-50"
                                  : "h-7 text-amber-700 border-amber-300 hover:bg-amber-50"
                              }
                              onClick={() => {
                                setSelectedMadrasahSubject(subject);
                                setManageMadrasahOpen(true);
                              }}
                            >
                              Manage {getSubjectProgramShortLabel(program)}{" "}
                              Students
                            </Button>
                          </div>
                        )}
                      <div className="space-y-1 mt-2">
                        {subjectSchedules.length > 0 ? (
                          subjectSchedules.map((schedule) => (
                            <div
                              key={schedule.id}
                              className="text-sm pl-4 border-l-2 border-primary/20"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-medium">
                                  {formatDays(schedule.days_of_week)}
                                </span>
                                <span className="text-muted-foreground">
                                  {formatTimeRange(
                                    schedule.start_time,
                                    schedule.end_time,
                                  )}
                                </span>
                                {schedule.teacher_id == null ? (
                                  <TemporaryScheduleBadge />
                                ) : (
                                  <span className="text-muted-foreground">
                                    • {teacherNames[schedule.teacher_id] || "-"}
                                  </span>
                                )}
                                <span className="text-muted-foreground">
                                  • Room: {roomNames[schedule.room_id] || "-"}
                                </span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="text-sm text-muted-foreground italic pl-4 border-l-2 border-transparent">
                            No schedule assigned
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Promote Student Modal */}
      {promoteStudent && section && (
        <PromoteStudentModal
          isOpen={!!promoteStudent}
          onClose={() => setPromoteStudent(null)}
          student={promoteStudent.student}
          enrollmentId={promoteStudent.enrollmentId}
          gradeLevel={promoteStudent.gradeLevel}
          sectionId={sectionId}
          schoolYear={section.school_year}
          schoolId={user?.school_id != null ? String(user.school_id) : null}
          onPromoted={() => {
            fetchSectionData();
          }}
        />
      )}

      {/* Retain/NLIS Modal */}
      {retainNlisStudent && section && (
        <RetainNlisModal
          isOpen={!!retainNlisStudent}
          onClose={() => setRetainNlisStudent(null)}
          student={retainNlisStudent.student}
          enrollmentId={retainNlisStudent.enrollmentId}
          gradeLevel={retainNlisStudent.gradeLevel}
          sectionId={sectionId}
          schoolYear={section.school_year}
          schoolId={user?.school_id != null ? String(user.school_id) : null}
          onUpdated={() => {
            fetchSectionData();
          }}
        />
      )}

      {/* Transfer Out Modal */}
      {transferOutStudent && section && (
        <TransferOutModal
          isOpen={!!transferOutStudent}
          onClose={() => setTransferOutStudent(null)}
          student={transferOutStudent.student}
          enrollmentId={transferOutStudent.enrollmentId}
          gradeLevel={transferOutStudent.gradeLevel}
          schoolYear={section.school_year}
          schoolId={user?.school_id != null ? String(user.school_id) : null}
          onUpdated={() => {
            fetchSectionData();
          }}
        />
      )}

      {/* Edit Student Modal */}
      <TeacherEditStudentModal
        isOpen={!!editStudent}
        onClose={() => setEditStudent(null)}
        editData={editStudent}
        enrollmentStatus={enrollments.find((e) => String(e.student.id) === String(editStudent?.id))?.enrollment_status}
        onUpdated={(updatedStudent) => {
          setEnrollments((prev) =>
            prev.map((e) =>
              String(e.student.id) === String(updatedStudent.id)
                ? { ...e, student: updatedStudent }
                : e,
            ),
          );
        }}
      />

      {/* Student Portal Code Modal */}
      <GeneratePortalCodeModal
        isOpen={!!portalCodeStudent}
        onClose={() => setPortalCodeStudent(null)}
        student={portalCodeStudent}
        enrollmentStatus={
          enrollments.find(
            (e) => String(e.student.id) === String(portalCodeStudent?.id),
          )?.enrollment_status
        }
        onUpdated={(updatedStudent) => {
          setEnrollments((prev) =>
            prev.map((e) =>
              String(e.student.id) === String(updatedStudent.id)
                ? { ...e, student: updatedStudent }
                : e,
            ),
          );
          setPortalCodeStudent(updatedStudent);
        }}
      />

      {/* Core values (report card) */}
      {coreValuesEntryStudent && section && user?.school_id && (
        <CoreValuesEntryModal
          isOpen={!!coreValuesEntryStudent}
          onClose={() => setCoreValuesEntryStudent(null)}
          studentId={coreValuesEntryStudent.studentId}
          studentName={coreValuesEntryStudent.studentName}
          schoolId={String(user.school_id)}
          schoolYear={section.school_year}
        />
      )}

      {/* View grades (adviser) */}
      {viewGradesStudent && section && (
        <ViewStudentGradesModal
          isOpen={!!viewGradesStudent}
          onClose={() => setViewGradesStudent(null)}
          studentId={viewGradesStudent.studentId}
          studentName={viewGradesStudent.studentName}
          sectionId={sectionId}
          schoolYear={section.school_year}
          subjects={subjects}
        />
      )}

      {/* Print Card Modal */}
      {printCardStudent && section && user?.school_id && (
        <PrintCardModal
          isOpen={!!printCardStudent}
          onClose={() => setPrintCardStudent(null)}
          studentId={printCardStudent.studentId}
          studentName={printCardStudent.studentName}
          schoolId={String(user.school_id)}
          sectionId={sectionId}
          schoolYear={section.school_year}
        />
      )}

      {/* Manage Madrasah Students Modal */}
      {section && (
        <ManageMadrasahStudentsModal
          isOpen={manageMadrasahOpen}
          onClose={() => {
            setManageMadrasahOpen(false);
            setSelectedMadrasahSubject(null);
          }}
          subject={selectedMadrasahSubject}
          section={section}
          onSuccess={fetchSectionData}
        />
      )}
    </div>
  );
}
