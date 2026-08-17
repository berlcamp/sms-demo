"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isTeacherRole } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { ClipboardCheck, CalendarDays } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MonthlyAttendanceModal } from "./components/MonthlyAttendanceModal";

interface SchoolOption {
  id: string;
  name: string;
}

interface SectionOption {
  id: string;
  name: string;
  grade_level: number;
  school_id?: string | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getMonthOptions(schoolYear: string): { value: string; label: string }[] {
  const [startYear, endYear] = schoolYear.split("-").map(Number);
  if (!startYear || !endYear) return [];
  // School year runs June of startYear through May of endYear
  const options: { value: string; label: string }[] = [];
  for (let m = 6; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    options.push({ value: `${startYear}-${mm}`, label: `${MONTH_NAMES[m - 1]} ${startYear}` });
  }
  for (let m = 1; m <= 5; m++) {
    const mm = String(m).padStart(2, "0");
    options.push({ value: `${endYear}-${mm}`, label: `${MONTH_NAMES[m - 1]} ${endYear}` });
  }
  return options;
}

export default function AttendancePage() {
  const user = useAppSelector((state) => state.user.user);
  const isDivisionAdmin =
    user?.type === "division_admin" || user?.type === "division_type";
  const isTeacher = isTeacherRole(user?.type);
  const searchParams = useSearchParams();

  const [schools, setSchools] = useState<SchoolOption[]>([]);
  const [sections, setSections] = useState<SectionOption[]>([]);
  const [schoolId, setSchoolId] = useState<string>("");
  const [sectionId, setSectionId] = useState<string>(searchParams.get("section") || "");
  const [schoolYear, setSchoolYear] = useState<string>(searchParams.get("school_year") || getCurrentSchoolYear());
  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const effectiveSchoolId = isDivisionAdmin
    ? schoolId
    : ((user?.school_id as string | undefined) ?? "");

  const monthOptions = getMonthOptions(schoolYear);

  const fetchSchools = useCallback(async () => {
    const { data } = await supabase
      .from("sms_schools")
      .select("id, name")
      .eq("is_active", true)
      .order("name");
    // BIGSERIAL ids arrive as numbers; the Select compares values strictly.
    setSchools((data || []).map((s) => ({ id: String(s.id), name: s.name })));
  }, []);

  const fetchSections = useCallback(async () => {
    // Section ids are BIGSERIAL, so PostgREST hands them back as numbers while
    // the Select value and the `?section=` deep link are strings. Normalise here
    // or the selection silently fails to match and gets reset.
    const normalize = (rows: SectionOption[] | null) =>
      (rows || []).map((s) => ({
        ...s,
        id: String(s.id),
        school_id: s.school_id == null ? null : String(s.school_id),
      }));

    if (isTeacher && user?.system_user_id) {
      // Teachers: only sections where they are section adviser
      const { data } = await supabase
        .from("sms_sections")
        .select("id, name, grade_level, school_id")
        .eq("section_adviser_id", user.system_user_id)
        .eq("school_year", schoolYear)
        .eq("is_active", true)
        .order("grade_level")
        .order("name");
      setSections(normalize(data));
    } else if (effectiveSchoolId) {
      // School staff / division admin: all sections in the school. Editing is
      // still adviser-only — the modal decides that from the section row.
      const { data } = await supabase
        .from("sms_sections")
        .select("id, name, grade_level, school_id")
        .eq("school_id", effectiveSchoolId)
        .eq("school_year", schoolYear)
        .eq("is_active", true)
        .order("grade_level")
        .order("name");
      setSections(normalize(data));
    } else {
      setSections([]);
    }
  }, [isTeacher, user, effectiveSchoolId, schoolYear]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      if (isDivisionAdmin) {
        await fetchSchools();
      } else if (user?.school_id) {
        setSchoolId(String(user.school_id));
      }
      setLoading(false);
    };
    load();
  }, [isDivisionAdmin, user?.school_id, fetchSchools]);

  useEffect(() => {
    fetchSections();
  }, [fetchSections]);

  // Reset section when school/year changes and it's no longer valid
  useEffect(() => {
    if (sections.length === 0) return; // sections not loaded yet, don't reset
    const valid = sections.some((s) => s.id === sectionId);
    if (sectionId && !valid) {
      setSectionId("");
    }
  }, [sections, sectionId]);

  // Reset month when school year changes
  useEffect(() => {
    setSelectedMonth("");
  }, [schoolYear]);

  const selectedSection = sections.find((s) => s.id === sectionId);

  return (
    <div>
      <div className="app__title">
        <h1 className="app__title_text flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          Attendance Records
        </h1>
      </div>

      <div className="app__content">
        <Card>
          <CardHeader>
            <CardTitle>Monthly Class Attendance</CardTitle>
            <CardDescription>
              Select section and month to record or view AM/PM attendance.
              Used for SF2 (Learner&apos;s Daily Class Attendance).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4">
              {isDivisionAdmin && (
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium">School</label>
                  <Select
                    value={schoolId}
                    onValueChange={setSchoolId}
                    disabled={loading}
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
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">School Year</label>
                <Select value={schoolYear} onValueChange={setSchoolYear}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
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
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Section</label>
                <Select value={sectionId} onValueChange={setSectionId}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select section" />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.grade_level === -1 ? "SNED" : s.grade_level === 0 ? "K" : s.grade_level} - {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium">Month</label>
                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {monthOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {sectionId && selectedMonth && schoolYear && (
              <div className="pt-2">
                <Button onClick={() => setModalOpen(true)} className="gap-2">
                  <CalendarDays className="h-4 w-4" />
                  View / Record Attendance
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedSection && selectedMonth && (
        <MonthlyAttendanceModal
          open={modalOpen}
          onOpenChange={setModalOpen}
          sectionId={sectionId}
          sectionName={selectedSection.name}
          gradeLevel={selectedSection.grade_level}
          schoolId={selectedSection.school_id ?? effectiveSchoolId}
          schoolYear={schoolYear}
          month={selectedMonth}
        />
      )}
    </div>
  );
}
