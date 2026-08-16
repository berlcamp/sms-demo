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
  FormDescription,
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
import { addItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import {
  getGradeLevelLabel,
  GRADE_LEVELS,
  GRADE_LEVEL_MAX,
  GRADE_LEVEL_MIN,
  isAlsSectionType,
  SECTION_TYPE_OPTIONS,
} from "@/lib/constants";
import { formatRoomDimension } from "@/lib/utils/roomDimension";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { Section, SectionType } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";

type ItemType = Section;
const table = "sms_sections";
const title = "Section";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  editData?: ItemType | null;
}

const FormSchema = z.object({
  name: z.string().min(1, "Section name is required"),
  grade_level: z.number().min(GRADE_LEVEL_MIN).max(GRADE_LEVEL_MAX),
  school_year: z.string().min(1, "School year is required"),
  section_type: z.string().min(1, "Section type is required"),
  section_adviser_id: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null || v === "" ? undefined : String(v))),
  room_id: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => (v == null || v === "" ? undefined : String(v))),
  max_students: z.number().optional(),
  is_active: z.boolean().default(true),
});

type FormType = z.infer<typeof FormSchema>;

export const AddModal = ({ isOpen, onClose, editData }: ModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teachers, setTeachers] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [rooms, setRooms] = useState<
    Array<{ id: string; name: string; dimension: string | null }>
  >([]);
  const [hasExistingData, setHasExistingData] = useState(false);

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);

  const form = useForm<FormType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      grade_level: 1,
      school_year: getCurrentSchoolYear(),
      section_type: undefined,
      section_adviser_id: undefined,
      room_id: undefined,
      max_students: undefined,
      is_active: true,
    },
  });

  useEffect(() => {
    const checkExistingData = async () => {
      if (!editData?.id) {
        setHasExistingData(false);
        return;
      }

      const [{ count: enrollmentCount }, { count: scheduleCount }] =
        await Promise.all([
          supabase
            .from("sms_enrollments")
            .select("id", { count: "exact", head: true })
            .eq("section_id", editData.id),
          supabase
            .from("sms_subject_schedules")
            .select("id", { count: "exact", head: true })
            .eq("section_id", editData.id),
        ]);

      setHasExistingData(
        (enrollmentCount ?? 0) > 0 || (scheduleCount ?? 0) > 0,
      );
    };

    if (isOpen) {
      checkExistingData();
    }
  }, [isOpen, editData?.id]);

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

  // Classrooms available to assign to this section (migration 138). The room's
  // dimension and capacity are what the Classroom Enrollment and Size report
  // prints, so the picker shows the dimension beside the name.
  useEffect(() => {
    const fetchRooms = async () => {
      let query = supabase
        .from("sms_rooms")
        .select("id, name, dimension")
        .eq("is_active", true)
        .order("name");
      if (user?.school_id != null) {
        query = query.eq("school_id", user.school_id);
      }
      const { data, error } = await query;

      if (!error && data) {
        setRooms(data as Array<{ id: string; name: string; dimension: string | null }>);
      }
    };

    if (isOpen) {
      fetchRooms();
    }
  }, [isOpen, user?.school_id]);

  const onSubmit = async (data: FormType) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const newData = {
        name: data.name.trim(),
        grade_level: data.grade_level,
        school_year: data.school_year.trim(),
        section_type: data.section_type || null,
        section_adviser_id: data.section_adviser_id || null,
        room_id: data.room_id || null,
        max_students: data.max_students || null,
        is_active: data.is_active,
        ...(user?.school_id != null && { school_id: user.school_id }),
      };

      if (editData?.id) {
        // An ALS section takes ALS subjects and nothing else (migration 136),
        // so crossing that line would strand every subject already scheduled
        // here — the schedules have to go first.
        const crossesAlsBoundary =
          isAlsSectionType(editData.section_type) !==
          isAlsSectionType(data.section_type);
        if (crossesAlsBoundary) {
          const { count: scheduleCount } = await supabase
            .from("sms_subject_schedules")
            .select("id", { count: "exact", head: true })
            .eq("section_id", editData.id);

          if (scheduleCount != null && scheduleCount > 0) {
            toast.error(
              isAlsSectionType(data.section_type)
                ? "Cannot switch this section to ALS because it already has scheduled subjects. Remove the schedules first."
                : "Cannot switch this section away from ALS because it already has scheduled ALS subjects. Remove the schedules first.",
            );
            return;
          }
        }

        let updateQuery = supabase
          .from(table)
          .update(newData)
          .eq("id", editData.id);
        if (user?.school_id != null) {
          updateQuery = updateQuery.eq("school_id", user.school_id);
        }
        const { error } = await updateQuery;

        if (error) {
          if (error.code === "23505") {
            toast.error(
              "A section with the same name, grade level, and school year already exists.",
            );
            return;
          }
          throw new Error(error.message);
        }

        let selectQuery = supabase
          .from(table)
          .select()
          .eq("id", editData.id);
        if (user?.school_id != null) {
          selectQuery = selectQuery.eq("school_id", user.school_id);
        }
        const { data: updated } = await selectQuery.single();

        if (updated) {
          dispatch(updateList(updated));
        }

        onClose();
        toast.success("Section updated successfully!");
      } else {
        const { data: inserted, error } = await supabase
          .from(table)
          .insert([newData])
          .select()
          .single();

        if (error) {
          if (error.code === "23505") {
            toast.error(
              "A section with the same name, grade level, and school year already exists.",
            );
            return;
          }
          throw new Error(error.message);
        }

        if (inserted) {
          dispatch(addItem(inserted));
        }
        onClose();
        toast.success("Section added successfully!");
      }
    } catch (err) {
      console.error("Submission error:", err);
      toast.error(err instanceof Error ? err.message : "Error saving section");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      form.reset({
        name: editData?.name || "",
        grade_level: editData?.grade_level ?? 1,
        school_year: editData?.school_year || getCurrentSchoolYear(),
        section_type: editData?.section_type || undefined,
        section_adviser_id: editData?.section_adviser_id ?? undefined,
        room_id: editData?.room_id ?? undefined,
        max_students: editData?.max_students || undefined,
        is_active: editData?.is_active ?? true,
      });
    }
  }, [form, editData, isOpen]);

  const handleClose = () => {
    if (!isSubmitting) {
      form.reset();
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {editData ? "Edit" : "Add"} {title}
          </DialogTitle>
          <DialogDescription>
            {editData
              ? "Update section information below."
              : "Fill in the details to add a new section."}
          </DialogDescription>
        </DialogHeader>

        {hasExistingData && (
          <p className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">
            Grade level and school year cannot be changed because this section
            already has enrolled students or scheduled subjects.
          </p>
        )}

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

              <FormField
                control={form.control}
                name="grade_level"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Grade Level <span className="text-red-500">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={(value) => field.onChange(parseInt(value))}
                      value={field.value?.toString()}
                      disabled={isSubmitting || hasExistingData}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
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
                      disabled={isSubmitting || hasExistingData}
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

              <FormField
                control={form.control}
                name="max_students"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Max Students
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Optional"
                        className="h-10"
                        {...field}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value
                              ? parseInt(e.target.value)
                              : undefined,
                          )
                        }
                        value={field.value || ""}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="section_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Section Type
                    </FormLabel>
                    <Select
                      onValueChange={(value) => {
                        field.onChange(value as SectionType);
                      }}
                      value={field.value ?? ""}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select section type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SECTION_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
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
                name="room_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Classroom
                    </FormLabel>
                    <Select
                      onValueChange={(value) =>
                        field.onChange(value === "none" ? undefined : value)
                      }
                      value={field.value ? String(field.value) : "none"}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select classroom (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="none">
                          No classroom assigned
                        </SelectItem>
                        {rooms.map((room) => (
                          <SelectItem key={room.id} value={String(room.id)}>
                            {room.name}
                            {formatRoomDimension(room.dimension)
                              ? ` — ${formatRoomDimension(room.dimension)}`
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      Room this section occupies. Its dimension and capacity
                      appear in the Classroom Enrollment and Size report.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="section_adviser_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Section Adviser
                  </FormLabel>
                  <Select
                    onValueChange={(value) =>
                      field.onChange(value === "none" ? undefined : value)
                    }
                    value={field.value ? String(field.value) : "none"}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select adviser (optional)" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">No adviser assigned</SelectItem>
                      {teachers.map((teacher) => (
                        <SelectItem key={teacher.id} value={String(teacher.id)}>
                          {teacher.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    Assign a teacher as section adviser (optional).
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

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
                    {editData ? "Updating..." : "Saving..."}
                  </span>
                ) : editData ? (
                  "Update"
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
