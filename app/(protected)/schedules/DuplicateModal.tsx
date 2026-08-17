"use client";

import { Button } from "@/components/ui/button";
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
import {
  checkScheduleConflicts,
  formatDays,
  parseDbConflictError,
} from "@/lib/utils/scheduleConflicts";
import { getSchoolYearOptions } from "@/lib/utils/schoolYear";
import { RootState, SubjectSchedule } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { z } from "zod";

type ItemType = SubjectSchedule;
const table = "sms_subject_schedules";

interface DuplicateModalProps {
  isOpen: boolean;
  onClose: () => void;
  scheduleData: ItemType | null;
}

const FormSchema = z.object({
  school_year: z.string().min(1, "School year is required"),
});

type FormType = z.infer<typeof FormSchema>;

export const DuplicateModal = ({
  isOpen,
  onClose,
  scheduleData,
}: DuplicateModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [subjectName, setSubjectName] = useState<string>("");
  const [sectionName, setSectionName] = useState<string>("");
  const [teacherName, setTeacherName] = useState<string>("");
  const [roomName, setRoomName] = useState<string>("");
  const [conflictCheckSchedules, setConflictCheckSchedules] = useState<
    SubjectSchedule[]
  >([]);

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);
  const allSchedules = useSelector(
    (state: RootState) => state.list.value,
  ) as SubjectSchedule[];

  const form = useForm<FormType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      school_year: "",
    },
  });

  // Fetch related data for display
  useEffect(() => {
    if (!isOpen || !scheduleData) return;

    const fetchRelatedData = async () => {
      // Fetch subject (school-scoped)
      let subjectQuery = supabase
        .from("sms_subjects")
        .select("id, name, code")
        .eq("id", scheduleData.subject_id);
      if (user?.school_id != null) {
        subjectQuery = subjectQuery.eq("school_id", user.school_id);
      }
      const { data: subjectData } = await subjectQuery.single();
      if (subjectData) {
        setSubjectName(`${subjectData.code} - ${subjectData.name}`);
      }

      // Fetch section (school-scoped)
      let sectionQuery = supabase
        .from("sms_sections")
        .select("id, name")
        .eq("id", scheduleData.section_id);
      if (user?.school_id != null) {
        sectionQuery = sectionQuery.eq("school_id", user.school_id);
      }
      const { data: sectionData } = await sectionQuery.single();
      if (sectionData) {
        setSectionName(sectionData.name);
      }

      // Fetch teacher. Not school-scoped: the duplicate copies teacher_id, so
      // the preview must name the holder even after they move schools.
      const { data: teacherData } = await supabase
        .from("sms_users")
        .select("id, name")
        .eq("id", scheduleData.teacher_id)
        .maybeSingle();
      if (teacherData) {
        setTeacherName(teacherData.name);
      }

      // Fetch room (school-scoped)
      let roomQuery = supabase
        .from("sms_rooms")
        .select("id, name")
        .eq("id", scheduleData.room_id);
      if (user?.school_id != null) {
        roomQuery = roomQuery.eq("school_id", user.school_id);
      }
      const { data: roomData } = await roomQuery.single();
      if (roomData) {
        setRoomName(roomData.name);
      }
    };

    fetchRelatedData();
  }, [isOpen, scheduleData, user?.school_id]);

  // Reset form when modal opens
  useEffect(() => {
    if (!isOpen) {
      form.reset();
      setConflicts([]);
    }
  }, [isOpen, form]);

  // Fetch ALL schedules for target school year (avoids filtered Redux list)
  const formSchoolYear = form.watch("school_year");
  useEffect(() => {
    if (!isOpen || !formSchoolYear?.trim()) {
      setConflictCheckSchedules([]);
      return;
    }
    const fetchSchedules = async () => {
      let query = supabase
        .from("sms_subject_schedules")
        .select("*")
        .eq("school_year", formSchoolYear.trim());
      if (user?.school_id != null) {
        query = query.eq("school_id", user.school_id);
      }
      const { data } = await query;
      setConflictCheckSchedules(data || []);
    };
    fetchSchedules();
  }, [isOpen, formSchoolYear, user?.school_id]);

  const schedulesForConflictCheck =
    conflictCheckSchedules.length > 0 ? conflictCheckSchedules : allSchedules;

  // Check for conflicts when school year changes
  useEffect(() => {
    if (!scheduleData || !form.watch("school_year")) return;

    const subscription = form.watch((value) => {
      if (value.school_year) {
        const scheduleDataForConflict = {
          room_id: scheduleData.room_id,
          teacher_id: scheduleData.teacher_id,
          section_id: scheduleData.section_id,
          days_of_week: [...scheduleData.days_of_week],
          start_time: scheduleData.start_time.includes(":")
            ? scheduleData.start_time.split(":").slice(0, 2).join(":")
            : scheduleData.start_time,
          end_time: scheduleData.end_time.includes(":")
            ? scheduleData.end_time.split(":").slice(0, 2).join(":")
            : scheduleData.end_time,
          school_year: value.school_year,
        };

        const detectedConflicts = checkScheduleConflicts(
          scheduleDataForConflict,
          schedulesForConflictCheck,
        );

        setConflicts(detectedConflicts.map((c) => c.message));
      } else {
        setConflicts([]);
      }
    });

    return () => subscription.unsubscribe();
  }, [form, schedulesForConflictCheck, scheduleData]);

  const onSubmit = async (data: FormType) => {
    if (isSubmitting || !scheduleData) return;
    setIsSubmitting(true);

    try {
      // Check conflicts one more time before submitting
      const normalizedStartTime = scheduleData.start_time.includes(":")
        ? scheduleData.start_time.split(":").slice(0, 2).join(":")
        : scheduleData.start_time;
      const normalizedEndTime = scheduleData.end_time.includes(":")
        ? scheduleData.end_time.split(":").slice(0, 2).join(":")
        : scheduleData.end_time;

      const scheduleDataForConflict = {
        room_id: scheduleData.room_id,
        teacher_id: scheduleData.teacher_id,
        section_id: scheduleData.section_id,
        days_of_week: [...scheduleData.days_of_week],
        start_time: normalizedStartTime,
        end_time: normalizedEndTime,
        school_year: data.school_year,
      };

      const detectedConflicts = checkScheduleConflicts(
        scheduleDataForConflict,
        schedulesForConflictCheck,
      );

      if (detectedConflicts.length > 0) {
        toast.error(
          `Conflicts detected: ${detectedConflicts
            .map((c) => c.type)
            .join(", ")}`,
        );
        setConflicts(detectedConflicts.map((c) => c.message));
        setIsSubmitting(false);
        return;
      }

      const newData = {
        subject_id: parseInt(scheduleData.subject_id),
        section_id: parseInt(scheduleData.section_id),
        // Preserve a Temporary source schedule as Temporary in the copy
        teacher_id:
          scheduleData.teacher_id != null
            ? parseInt(scheduleData.teacher_id)
            : null,
        room_id: parseInt(scheduleData.room_id),
        days_of_week: [...scheduleData.days_of_week],
        start_time: `${normalizedStartTime}:00`,
        end_time: `${normalizedEndTime}:00`,
        school_year: data.school_year.trim(),
        // Carry an accepted conflict forward, else the copy of a deliberate
        // shared slot is blocked by the trigger the original was exempt from
        conflict_override: scheduleData.conflict_override ?? false,
        ...(user?.school_id != null && { school_id: user.school_id }),
      };

      const { data: inserted, error } = await supabase
        .from(table)
        .insert([newData])
        .select()
        .single();

      if (error) {
        const dbConflicts = parseDbConflictError(error.message);
        if (dbConflicts) {
          // Show what the trigger said; it saw a clash the client check did not
          setConflicts(
            dbConflicts.length > 0
              ? dbConflicts
              : ["This slot is already taken (reported by the server)."],
          );
          toast.error("Schedule conflict detected — see details below.");
        } else {
          throw new Error(error.message);
        }
      } else {
        dispatch(addItem(inserted));
        onClose();
        toast.success("Schedule duplicated successfully!");
      }
    } catch (err) {
      console.error("Submission error:", err);
      toast.error(err instanceof Error ? err.message : "Error saving schedule");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      form.reset();
      setConflicts([]);
      onClose();
    }
  };

  // Helper function to normalize time format from HH:mm:ss to HH:mm
  const normalizeTime = (time: string): string => {
    if (!time) return time;
    return time.split(":").slice(0, 2).join(":");
  };

  if (!scheduleData) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            Duplicate Schedule
          </DialogTitle>
          <DialogDescription>
            Duplicate this schedule to a new school year. All fields except
            school year will be copied.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {/* Display read-only fields */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Subject
                </label>
                <Input
                  value={subjectName}
                  disabled
                  className="h-10 bg-gray-50"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Section
                </label>
                <Input
                  value={sectionName}
                  disabled
                  className="h-10 bg-gray-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Teacher
                </label>
                <Input
                  value={teacherName}
                  disabled
                  className="h-10 bg-gray-50"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Room
                </label>
                <Input value={roomName} disabled className="h-10 bg-gray-50" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                Days of Week
              </label>
              <Input
                value={formatDays([...scheduleData.days_of_week])}
                disabled
                className="h-10 bg-gray-50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  Start Time
                </label>
                <Input
                  type="time"
                  value={normalizeTime(scheduleData.start_time)}
                  disabled
                  className="h-10 bg-gray-50"
                />
              </div>

              <div>
                <label className="text-sm font-medium text-gray-700 mb-1.5 block">
                  End Time
                </label>
                <Input
                  type="time"
                  value={normalizeTime(scheduleData.end_time)}
                  disabled
                  className="h-10 bg-gray-50"
                />
              </div>
            </div>

            {/* Editable school year field */}
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

            {conflicts.length > 0 && (
              <div className="rounded-md bg-red-50 border border-red-200 p-4">
                <h4 className="text-sm font-medium text-red-800 mb-2">
                  Schedule Conflicts Detected:
                </h4>
                <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                  {conflicts.map((conflict, index) => (
                    <li key={index}>{conflict}</li>
                  ))}
                </ul>
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
                disabled={isSubmitting || conflicts.length > 0}
                className="h-10 min-w-[100px]"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Saving...
                  </span>
                ) : (
                  "Save"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
