"use client";

import { TemporaryScheduleBadge } from "@/components/TemporaryScheduleBadge";
import { Button } from "@/components/ui/button";
import {
  getGradeLevelLabel,
  SECTION_TYPE_OPTIONS,
} from "@/lib/constants";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { addItem } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { formatDays, formatTimeRange } from "@/lib/utils/scheduleConflicts";
import { getSchoolYearOptions } from "@/lib/utils/schoolYear";
import { Section, SubjectSchedule } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";

const sectionsTable = "sms_sections";
const schedulesTable = "sms_subject_schedules";

const FormSchema = z.object({
  name: z.string().min(1, "Section name is required"),
  school_year: z.string().min(1, "School year is required"),
});

type FormType = z.infer<typeof FormSchema>;

interface DuplicateModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceSection: Section | null;
}

export const DuplicateModal = ({
  isOpen,
  onClose,
  sourceSection,
}: DuplicateModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teachers, setTeachers] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [schedulesToDuplicate, setSchedulesToDuplicate] = useState<
    SubjectSchedule[]
  >([]);
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const [scheduleTeacherNames, setScheduleTeacherNames] = useState<
    Record<string, string>
  >({});
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});
  const [schedulesLoading, setSchedulesLoading] = useState(false);

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);

  const form = useForm<FormType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      school_year: "",
    },
  });

  useEffect(() => {
    const fetchTeachers = async () => {
      let query = supabase
        .from("sms_users")
        .select("id, name")
        .neq("type", "division_admin")
        .neq("type", "division_type")
        .eq("is_active", true)
        .order("name");
      if (user?.school_id != null) {
        query = query.eq("school_id", user.school_id);
      }
      const { data, error } = await query;

      if (!error && data) {
        setTeachers(data);
      }
    };

    if (isOpen) {
      fetchTeachers();
    }
  }, [isOpen, user?.school_id]);

  useEffect(() => {
    if (isOpen && sourceSection) {
      form.reset({
        name: sourceSection.name,
        school_year: "",
      });
    }
  }, [form, sourceSection, isOpen]);

  useEffect(() => {
    const fetchSchedules = async () => {
      if (!isOpen || !sourceSection) return;

      setSchedulesLoading(true);
      setSchedulesToDuplicate([]);
      setSubjectNames({});
      setScheduleTeacherNames({});
      setRoomNames({});

      try {
        let schedulesQuery = supabase
          .from(schedulesTable)
          .select("*")
          .eq("section_id", sourceSection.id)
          .eq("school_year", sourceSection.school_year)
          .order("start_time", { ascending: true });
        if (user?.school_id != null) {
          schedulesQuery = schedulesQuery.eq("school_id", user.school_id);
        }
        const { data: schedulesData, error: schedulesError } = await schedulesQuery;

        if (schedulesError) throw schedulesError;

        if (schedulesData && schedulesData.length > 0) {
          setSchedulesToDuplicate(schedulesData as SubjectSchedule[]);

          const subjectIds = Array.from(
            new Set(schedulesData.map((s) => s.subject_id)),
          );
          // Temporary schedules have no teacher — keep nulls out of the .in() filter
          const teacherIds = Array.from(
            new Set(
              schedulesData
                .map((s) => s.teacher_id)
                .filter((id): id is string => id != null),
            ),
          );
          const roomIdsArray = Array.from(
            new Set(schedulesData.map((s) => s.room_id)),
          );

          if (subjectIds.length > 0) {
            let subjectsQuery = supabase
              .from("sms_subjects")
              .select("id, code, name")
              .in("id", subjectIds);
            if (user?.school_id != null) {
              subjectsQuery = subjectsQuery.eq("school_id", user.school_id);
            }
            const { data: subjects } = await subjectsQuery;
            if (subjects) {
              const names: Record<string, string> = {};
              subjects.forEach((s) => {
                names[s.id] = `${s.code} - ${s.name}`;
              });
              setSubjectNames(names);
            }
          }

          if (teacherIds.length > 0) {
            // Not school-scoped — see fetchStaffNames. The duplicate carries
            // teacher_id forward, so the preview has to name who that is even
            // when they have since moved schools.
            const { data: teachersData } = await supabase
              .from("sms_users")
              .select("id, name")
              .in("id", teacherIds);
            if (teachersData) {
              const names: Record<string, string> = {};
              teachersData.forEach((t) => {
                names[t.id] = t.name;
              });
              setScheduleTeacherNames(names);
            }
          }

          if (roomIdsArray.length > 0) {
            let roomsQuery = supabase
              .from("sms_rooms")
              .select("id, name")
              .in("id", roomIdsArray);
            if (user?.school_id != null) {
              roomsQuery = roomsQuery.eq("school_id", user.school_id);
            }
            const { data: rooms } = await roomsQuery;
            if (rooms) {
              const names: Record<string, string> = {};
              rooms.forEach((r) => {
                names[r.id] = r.name;
              });
              setRoomNames(names);
            }
          }
        }
      } catch (err) {
        console.error("Error fetching schedules:", err);
      } finally {
        setSchedulesLoading(false);
      }
    };

    fetchSchedules();
  }, [isOpen, sourceSection, user?.school_id]);

  const onSubmit = async (data: FormType) => {
    if (isSubmitting || !sourceSection) return;
    setIsSubmitting(true);

    try {
      const newSection = {
        name: data.name.trim(),
        grade_level: sourceSection.grade_level,
        school_year: data.school_year.trim(),
        section_type: sourceSection.section_type ?? null,
        section_adviser_id: sourceSection.section_adviser_id ?? null,
        room_id: sourceSection.room_id ?? null,
        // Carry the SHS strand through, else the copy of a Grade 11-12 section
        // silently drops out of the Track & Strand report (migration 145).
        strand: sourceSection.strand ?? null,
        specialization: sourceSection.specialization ?? null,
        max_students: sourceSection.max_students ?? null,
        is_active: true,
        ...(user?.school_id != null && { school_id: user.school_id }),
      };

      const { data: insertedSection, error: sectionError } = await supabase
        .from(sectionsTable)
        .insert([newSection])
        .select()
        .single();

      if (sectionError) throw new Error(sectionError.message);
      if (!insertedSection) throw new Error("Failed to create section");

      // Fetch subject schedules for the source section (school-scoped)
      let sourceSchedulesQuery = supabase
        .from(schedulesTable)
        .select("*")
        .eq("section_id", sourceSection.id)
        .eq("school_year", sourceSection.school_year);
      if (user?.school_id != null) {
        sourceSchedulesQuery = sourceSchedulesQuery.eq("school_id", user.school_id);
      }
      const { data: sourceSchedules, error: schedulesError } =
        await sourceSchedulesQuery;

      if (schedulesError) throw new Error(schedulesError.message);

      if (sourceSchedules && sourceSchedules.length > 0) {
        const newSchedules = sourceSchedules.map((schedule) => ({
          subject_id: schedule.subject_id,
          section_id: insertedSection.id,
          teacher_id: schedule.teacher_id,
          room_id: schedule.room_id,
          days_of_week: schedule.days_of_week,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          school_year: data.school_year.trim(),
          // Carry an accepted conflict forward, else the copy of a deliberate
          // shared slot is blocked by the trigger the original was exempt from
          conflict_override: schedule.conflict_override ?? false,
          ...(insertedSection.school_id != null && {
            school_id: insertedSection.school_id,
          }),
        }));

        const { error: insertSchedulesError } = await supabase
          .from(schedulesTable)
          .insert(newSchedules);

        if (insertSchedulesError) {
          // Rollback: delete the created section if schedule copy fails
          let rollbackQuery = supabase
            .from(sectionsTable)
            .delete()
            .eq("id", insertedSection.id);
          if (user?.school_id != null) {
            rollbackQuery = rollbackQuery.eq("school_id", user.school_id);
          }
          await rollbackQuery;
          throw new Error(insertSchedulesError.message);
        }
      }

      dispatch(addItem(insertedSection));
      onClose();
      toast.success(
        `Section duplicated successfully!${
          sourceSchedules && sourceSchedules.length > 0
            ? ` ${sourceSchedules.length} subject schedule(s) copied.`
            : ""
        }`,
      );
    } catch (err) {
      console.error("Duplicate error:", err);
      toast.error(
        err instanceof Error ? err.message : "Error duplicating section",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      form.reset();
      onClose();
    }
  };

  if (!sourceSection) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Duplicate Section
          </DialogTitle>
          <DialogDescription>
            Duplicate this section to a new school year. Section details and
            subject schedules will be copied. Choose the target school year
            below.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Section Name <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Grade 7-A"
                        className="h-10"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <label className="text-sm font-medium">Grade Level</label>
                <p className="text-sm text-muted-foreground h-10 flex items-center">
                  {sourceSection?.grade_level != null ? getGradeLevelLabel(sourceSection.grade_level) : "-"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="school_year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      School Year <span className="text-red-500">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select school year" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {getSchoolYearOptions().map((year) => (
                          <SelectItem key={year} value={year}>
                            {year}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="space-y-2">
                <label className="text-sm font-medium">Max Students</label>
                <p className="text-sm text-muted-foreground h-10 flex items-center">
                  {sourceSection?.max_students ?? "-"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Section Type</label>
                <p className="text-sm text-muted-foreground h-10 flex items-center">
                  {sourceSection?.section_type
                    ? (SECTION_TYPE_OPTIONS.find(
                        (o) => o.value === sourceSection.section_type,
                      )?.label ?? sourceSection.section_type)
                    : "No section type"}
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Section Adviser</label>
                <p className="text-sm text-muted-foreground h-10 flex items-center">
                  {sourceSection?.section_adviser_id
                    ? (teachers.find(
                        (t) => t.id === sourceSection.section_adviser_id,
                      )?.name ?? "-")
                    : "No adviser assigned"}
                </p>
              </div>
            </div>

            {schedulesLoading ? (
              <div className="text-sm text-muted-foreground py-2">
                Loading subject schedules...
              </div>
            ) : schedulesToDuplicate.length > 0 ? (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Subject Schedules to Duplicate ({schedulesToDuplicate.length})
                </label>
                <div className="max-h-[200px] overflow-y-auto rounded-md border p-3 space-y-2">
                  {schedulesToDuplicate.map((schedule) => (
                    <div
                      key={schedule.id}
                      className="text-sm pl-3 border-l-2 border-primary/20 space-y-0.5"
                    >
                      <div className="font-medium">
                        {subjectNames[schedule.subject_id] ?? "-"}
                      </div>
                      <div className="text-muted-foreground flex flex-wrap gap-x-2 gap-y-0">
                        <span>{formatDays(schedule.days_of_week ?? [])}</span>
                        <span>
                          {formatTimeRange(
                            schedule.start_time ?? "",
                            schedule.end_time ?? "",
                          )}
                        </span>
                        {schedule.teacher_id == null ? (
                          <TemporaryScheduleBadge />
                        ) : (
                          <span>
                            • {scheduleTeacherNames[schedule.teacher_id] ?? "-"}
                          </span>
                        )}
                        <span>
                          • Room: {roomNames[schedule.room_id] ?? "-"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-2">
                No subject schedules to duplicate
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2 space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
                className="h-10"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-10 min-w-[100px]"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Duplicating...
                  </span>
                ) : (
                  "Duplicate"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
