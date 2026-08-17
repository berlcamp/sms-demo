"use client";

import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getGradeLevelLabel,
  GRADE_LEVELS,
  GRADE_LEVEL_MIN,
  SECTION_TYPE_LABELS,
} from "@/lib/constants";
import { getSuggestedSectionType } from "@/lib/utils/gpaThresholds";
import { GpaThresholds } from "@/lib/utils/gpaThresholds";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { SectionSuggestion } from "@/lib/utils/sectionAssignment";
import { LrnLookupResult, SectionType, StudentEntryMode } from "@/types/database";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { BookOpen, CalendarRange, GraduationCap, HelpCircle, Star } from "lucide-react";
import { useMemo } from "react";
import { UseFormReturn } from "react-hook-form";
import { EnrollmentFormType } from "./enrollmentWizardSchema";

const SENIOR_HIGH_GRADE_MIN = 11;
const SENIOR_HIGH_GRADE_MAX = 12;

interface SectionOption {
  id: string;
  name: string;
  grade_level: number;
  school_year: string;
  section_type?: SectionType | null;
  enrolledMale: number;
  enrolledFemale: number;
}

interface Props {
  form: UseFormReturn<EnrollmentFormType>;
  sections: SectionOption[];
  isSubmitting: boolean;
  entryMode: StudentEntryMode;
  lookupResult: LrnLookupResult | null;
  studentName: string;
  studentLrn: string;
  studentPreviousGpa: number | null | undefined;
  studentPreviousSectionType?: SectionType | null;
  thresholds: GpaThresholds;
  sectionSuggestions?: SectionSuggestion[];
  onGradeLevelChange: (level: number) => void;
}

export default function EnrollmentDetailsStep({
  form,
  sections,
  isSubmitting,
  entryMode,
  lookupResult,
  studentName,
  studentLrn,
  studentPreviousGpa,
  studentPreviousSectionType,
  thresholds,
  sectionSuggestions = [],
  onGradeLevelChange,
}: Props) {
  const gradeLevel = form.watch("grade_level");
  const studentId = form.watch("student_id");
  const schoolYear = form.watch("school_year");
  const disabled = isSubmitting;

  // One year either side of the running one covers early enrolment for the
  // incoming year and a late entry for the one just ended. An enrollment being
  // edited may sit outside that window, so its own year is always included.
  const schoolYearOptions = useMemo(() => {
    const options = getSchoolYearOptions(1, 1);
    if (schoolYear && !options.includes(schoolYear)) options.push(schoolYear);
    return options.sort().reverse();
  }, [schoolYear]);

  // Prefer the section type carried over from the previous grade; fall back to
  // the GPA-based suggestion (Kindergarten origin / no previous type).
  const previousSectionTypeLabel = studentPreviousSectionType
    ? SECTION_TYPE_LABELS[studentPreviousSectionType] ?? studentPreviousSectionType
    : null;
  const suggestedSectionType =
    previousSectionTypeLabel ??
    getSuggestedSectionType(studentPreviousGpa, thresholds);

  // Build a map of section suggestions for quick lookup
  const suggestionMap = new Map(
    sectionSuggestions.map((s, i) => [s.sectionId, { rank: i + 1, ...s }])
  );

  // Get the top recommended section ID
  const topSuggestionId =
    sectionSuggestions.length > 0 ? sectionSuggestions[0].sectionId : null;

  return (
    <div className="space-y-6">
      {/* Student summary header */}
      <div className="rounded-lg border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Enrolling:</span>
          <span className="font-semibold">{studentName}</span>
          <span className="text-muted-foreground">({studentLrn})</span>
          {entryMode === "transferee" && lookupResult?.current_school_name && (
            <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-900/30 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-200">
              Transferee from {lookupResult.current_school_name}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="grade_level"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-sm font-medium flex items-center gap-2 mb-2">
                <GraduationCap className="h-4 w-4 text-muted-foreground" />
                Grade Level <span className="text-destructive">*</span>
              </FormLabel>
              <Select
                onValueChange={(value) => {
                  const level = parseInt(value);
                  field.onChange(level);
                  form.setValue("section_id", "");
                  form.clearErrors("semester");
                  if (level >= SENIOR_HIGH_GRADE_MIN && level <= SENIOR_HIGH_GRADE_MAX) {
                    form.setValue("semester", 1);
                  } else {
                    form.setValue("semester", null);
                  }
                  onGradeLevelChange(level);
                }}
                value={field.value?.toString()}
                disabled={disabled}
              >
                <FormControl>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select grade level" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {GRADE_LEVELS.map((level) => (
                    <SelectItem key={level} value={level.toString()}>
                      {getGradeLevelLabel(level)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="school_year"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormLabel className="text-sm font-medium flex items-center gap-2 mb-2">
                <CalendarRange className="h-4 w-4 text-muted-foreground" />
                School Year <span className="text-destructive">*</span>
              </FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  // Sections belong to one school year — the current pick is
                  // meaningless under another.
                  form.setValue("section_id", "");
                }}
                value={field.value}
                disabled={disabled}
              >
                <FormControl>
                  <SelectTrigger className="h-11">
                    <SelectValue placeholder="Select school year" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {schoolYearOptions.map((sy) => (
                    <SelectItem key={sy} value={sy}>
                      {sy}
                      {sy === getCurrentSchoolYear() && (
                        <span className="text-muted-foreground text-xs font-normal ml-1.5">
                          current
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {gradeLevel >= SENIOR_HIGH_GRADE_MIN &&
          gradeLevel <= SENIOR_HIGH_GRADE_MAX && (
            <FormField
              control={form.control}
              name="semester"
              render={({ field }) => (
                <FormItem className="flex flex-col sm:col-span-2">
                  <FormLabel className="text-sm font-medium flex items-center gap-2 mb-2">
                    Semester <span className="text-destructive">*</span>
                  </FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(parseInt(value));
                      form.setValue("section_id", "");
                    }}
                    value={field.value?.toString() ?? ""}
                    disabled={disabled}
                  >
                    <FormControl>
                      <SelectTrigger className="h-11">
                        <SelectValue placeholder="Select semester" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="1">Semester 1</SelectItem>
                      <SelectItem value="2">Semester 2</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
      </div>

      {/* Balik-Aral belongs to THIS enrolment, not to the learner (migration
          148): the same learner is an ordinary enrolment the following year,
          which is why it sits on this step rather than the learner record. */}
      <FormField
        control={form.control}
        name="is_balik_aral"
        render={({ field }) => (
          <FormItem className="rounded-lg border p-4">
            <div className="flex items-start gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value ?? false}
                  onChange={(e) => field.onChange(e.target.checked)}
                  disabled={disabled}
                />
              </FormControl>
              <div className="space-y-1">
                <FormLabel className="text-sm font-medium">
                  Balik-Aral
                </FormLabel>
                <p className="text-xs text-muted-foreground">
                  Learner is returning to school after a year or more out.
                  Applies to this school year only.
                </p>
              </div>
            </div>
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="section_id"
        render={({ field }) => (
          <FormItem className="flex flex-col">
            <FormLabel className="text-sm font-medium flex items-center gap-2 mb-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              Section <span className="text-destructive">*</span>
            </FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Select section" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {sections.length === 0 ? (
                  <div className="py-6 text-center">
                    <BookOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No sections available for {getGradeLevelLabel(gradeLevel)}.
                    </p>
                  </div>
                ) : (
                  sections.map((section) => {
                    const suggestion = suggestionMap.get(String(section.id));
                    const isTopPick =
                      String(section.id) === topSuggestionId;

                    return (
                      <SelectItem key={section.id} value={String(section.id)}>
                        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span>
                            {section.name}
                            {section.section_type
                              ? ` (${SECTION_TYPE_LABELS[section.section_type] ?? section.section_type})`
                              : ""}
                            {` — ${section.school_year}`}
                          </span>
                          <span className="text-muted-foreground text-xs font-normal tabular-nums">
                            M: {section.enrolledMale} · F: {section.enrolledFemale}
                          </span>
                          {isTopPick && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              <Star className="h-3 w-3" />
                              Recommended
                            </span>
                          )}
                          {suggestion && !isTopPick && suggestion.rank <= 3 && (
                            <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              #{suggestion.rank}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
            <FormMessage />

            {/* Auto Section Assignment algorithm info */}
            <div className="mt-1 flex items-center gap-1.5">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <HelpCircle className="h-3.5 w-3.5" />
                    How is the section recommendation calculated?
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-[420px] p-0 text-sm"
                  align="start"
                  side="bottom"
                  collisionPadding={12}
                >
                  <div className="rounded-md overflow-hidden">
                    <div className="bg-primary/10 px-3 py-2.5 border-b">
                      <p className="font-semibold text-xs text-foreground">Auto Section Assignment Algorithm</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        Sections are chosen in priority order — section fit first, then an even split, then mix.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 gap-px bg-border">
                      <div className="bg-background px-3 py-2.5 flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary leading-none">1st</span>
                        <div>
                          <p className="font-medium text-[11px]">Section Type Fit</p>
                          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                            High-GPA students go to Fast Learner sections, low-GPA to Crack sections, everyone else to regular (Heterogeneous) sections. Students with no GPA yet go to regular sections — never Fast Learner / Crack.
                          </p>
                        </div>
                      </div>
                      <div className="bg-background px-3 py-2.5 flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400 leading-none">2nd</span>
                        <div>
                          <p className="font-medium text-[11px]">Even Distribution</p>
                          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                            Among the sections a student fits, the one with the fewest students wins — so sections fill up evenly, even with no maximum size set.
                          </p>
                        </div>
                      </div>
                      <div className="bg-background px-3 py-2.5 flex items-start gap-2">
                        <span className="mt-0.5 shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 leading-none">3rd</span>
                        <div>
                          <p className="font-medium text-[11px]">Gender &amp; GPA Mix</p>
                          <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                            Only breaks ties between equally-filled sections — favours a balanced M/F ratio and a good spread of grades.
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="border-t bg-muted/40 px-3 py-2">
                      <p className="text-[10px] text-muted-foreground leading-snug">
                        Full sections are skipped. The{" "}
                        <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                          <Star className="h-2.5 w-2.5" />Recommended
                        </span>{" "}
                        badge marks the best-fit section.
                      </p>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {!Number.isFinite(form.watch("grade_level")) && (
              <p className="text-xs text-muted-foreground mt-1">
                Please select a grade level first
              </p>
            )}
            {/* Section type recommendation */}
            {gradeLevel > GRADE_LEVEL_MIN &&
              studentId &&
              entryMode !== "transferee" &&
              (studentPreviousGpa != null || previousSectionTypeLabel) &&
              suggestedSectionType && (
                <div className="mt-2 rounded-lg bg-green-100 dark:bg-green-900/30 px-3 py-2 text-sm">
                  {studentPreviousGpa != null && (
                    <>
                      <span className="text-muted-foreground">
                        {getGradeLevelLabel(gradeLevel - 1)} GPA:{" "}
                        <span className="font-medium text-foreground">
                          {Math.round(studentPreviousGpa)}
                        </span>
                      </span>
                      <br />
                    </>
                  )}
                  <span className="font-medium text-green-800 dark:text-green-200">
                    Suggested Section Type: {suggestedSectionType}
                    {previousSectionTypeLabel && (
                      <span className="font-normal text-green-700 dark:text-green-300">
                        {" "}
                        (carried over from {getGradeLevelLabel(gradeLevel - 1)})
                      </span>
                    )}
                  </span>
                  {topSuggestionId && (
                    <>
                      {" — "}
                      <span className="text-green-700 dark:text-green-300">
                        Best match auto-selected based on gender balance, GPA
                        distribution, and capacity
                      </span>
                    </>
                  )}
                </div>
              )}
            {gradeLevel > GRADE_LEVEL_MIN &&
              studentId &&
              entryMode === "transferee" && (
                <div className="mt-2 rounded-lg bg-amber-100 dark:bg-amber-900/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    GPA from previous school will be available after record transfer is accepted.
                  </span>
                </div>
              )}
            {gradeLevel > GRADE_LEVEL_MIN &&
              studentId &&
              entryMode !== "transferee" &&
              studentPreviousGpa == null &&
              !previousSectionTypeLabel && (
                <div className="mt-2 rounded-lg bg-green-100 dark:bg-green-900/30 px-3 py-2 text-sm">
                  <span className="text-muted-foreground">
                    {getGradeLevelLabel(gradeLevel - 1)}: no previous GPA data found
                  </span>
                </div>
              )}
          </FormItem>
        )}
      />
    </div>
  );
}
