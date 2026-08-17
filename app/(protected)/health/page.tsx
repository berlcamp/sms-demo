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
import { isTeacherRole } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { Heart } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { HealthEntryTable } from "./components/HealthEntryTable";

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

export default function HealthPage() {
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
  const [loading, setLoading] = useState(true);

  const effectiveSchoolId = isDivisionAdmin
    ? schoolId
    : ((user?.school_id as string | undefined) ?? "");

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

    if (isTeacher) {
      if (!user?.system_user_id) {
        setSections([]);
        return;
      }
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
      // School staff / division admin: all sections in the school. SF8 entry
      // stays adviser-only — HealthEntryTable renders read-only for everyone
      // else, so this widens visibility without widening who may encode.
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

  useEffect(() => {
    if (sections.length === 0) return; // sections not loaded yet, don't reset
    const valid = sections.some((s) => s.id === sectionId);
    if (sectionId && !valid) {
      setSectionId("");
    }
  }, [sections, sectionId]);

  return (
    <div>
      <div className="app__title">
        <h1 className="app__title_text flex items-center gap-2">
          <Heart className="h-5 w-5" />
          Learner Health
        </h1>
      </div>

      <div className="app__content">
        <Card>
          <CardHeader>
            <CardTitle>Basic Health and Nutrition</CardTitle>
            <CardDescription>
              Record height, weight, and nutritional status per learner. Used for
              SF8 (Learner Basic Health and Nutrition Report).
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
            </div>

            {sectionId && schoolYear && (
              <HealthEntryTable
                sectionId={sectionId}
                schoolYear={schoolYear}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
