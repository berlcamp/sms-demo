"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/lib/supabase/client";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { Filter as FilterIcon, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface StudentFilterProps {
  filter: {
    section_id?: string;
    subject_id?: string;
    school_year: string;
  };
  setFilter: (filter: {
    section_id?: string;
    subject_id?: string;
    school_year: string;
  }) => void;
  teacherId: number;
}

export function StudentFilter({
  filter,
  setFilter,
  teacherId,
}: StudentFilterProps) {
  const [sections, setSections] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [subjects, setSubjects] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [isOpen, setIsOpen] = useState(false);

  // Initialize school year if not set
  useEffect(() => {
    if (!filter.school_year) {
      setFilter({ ...filter, school_year: getCurrentSchoolYear() });
    }
  }, []);

  // Declared before the effect that calls them: reading a `const` above its
  // declaration means the effect closes over a binding that never updates when
  // the value changes.
  const fetchSections = useCallback(async () => {
    // Get sections where teacher is adviser
    const { data: adviserSections } = await supabase
      .from("sms_sections")
      .select("id, name")
      .eq("section_adviser_id", teacherId)
      .eq("school_year", filter.school_year)
      .eq("is_active", true);

    // Get sections via subject schedules
    const { data: scheduleSections } = await supabase
      .from("sms_subject_schedules")
      .select(
        `
        section_id,
        sections:section_id (id, name)
      `
      )
      .eq("teacher_id", teacherId)
      .eq("school_year", filter.school_year);

    const sectionMap = new Map<string, { id: string; name: string }>();
    adviserSections?.forEach((s) => sectionMap.set(s.id, s));
    scheduleSections?.forEach((s) => {
      if (s.section_id && s.sections) {
        const section = Array.isArray(s.sections) ? s.sections[0] : s.sections;
        sectionMap.set(section.id, { id: section.id, name: section.name });
      }
    });

    setSections(Array.from(sectionMap.values()));
  }, [teacherId, filter.school_year]);

  const fetchSubjects = useCallback(async () => {
    const { data: schedules } = await supabase
      .from("sms_subject_schedules")
      .select(
        `
        subject_id,
        subjects:subject_id (id, name)
      `
      )
      .eq("teacher_id", teacherId)
      .eq("school_year", filter.school_year);

    const subjectMap = new Map<string, { id: string; name: string }>();
    schedules?.forEach((s) => {
      if (s.subjects) {
        const subject = Array.isArray(s.subjects) ? s.subjects[0] : s.subjects;
        subjectMap.set(subject.id, { id: subject.id, name: subject.name });
      }
    });

    setSubjects(Array.from(subjectMap.values()));
  }, [teacherId, filter.school_year]);

  useEffect(() => {
    fetchSections();
    fetchSubjects();
  }, [fetchSections, fetchSubjects]);

  const hasActiveFilters =
    filter.section_id || filter.subject_id || filter.school_year;

  const clearFilters = () => {
    setFilter({
      school_year: filter.school_year,
    });
  };

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <FilterIcon className="h-4 w-4 mr-2" />
          Filters
          {hasActiveFilters && (
            <span className="ml-2 h-2 w-2 rounded-full bg-primary" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-4">
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-2 block">
              School Year
            </label>
            <Select
              value={filter.school_year}
              onValueChange={(value) =>
                setFilter({ ...filter, school_year: value })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select school year" />
              </SelectTrigger>
              <SelectContent>
                {getSchoolYearOptions().map((year) => (
                  <SelectItem key={year} value={year}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Section</label>
            <Select
              value={filter.section_id || "all"}
              onValueChange={(value) =>
                setFilter({
                  ...filter,
                  section_id: value === "all" ? undefined : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All sections" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sections</SelectItem>
                {sections.map((section) => (
                  <SelectItem key={section.id} value={section.id}>
                    {section.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">Subject</label>
            <Select
              value={filter.subject_id || "all"}
              onValueChange={(value) =>
                setFilter({
                  ...filter,
                  subject_id: value === "all" ? undefined : value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subject.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="w-full"
            >
              <X className="h-4 w-4 mr-2" />
              Clear Filters
            </Button>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
