"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { addItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import {
  getGradeLevelLabel,
  getMapehComponentLabel,
  getSubjectProgram,
  getSubjectProgramDescription,
  GRADE_LEVELS,
  GRADE_LEVEL_MAX,
  GRADE_LEVEL_MIN,
  isSelectiveProgram,
  MAPEH_COMPONENTS,
  SUBJECT_PROGRAMS,
} from "@/lib/constants";
import { Subject } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";

type ItemType = Subject;
const table = "sms_subjects";
const title = "Subject";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  editData?: ItemType | null;
}

const FormSchema = z.object({
  code: z.string().min(1, "Subject code is required"),
  name: z.string().min(1, "Subject name is required"),
  description: z.string().optional(),
  grade_level: z.number().min(GRADE_LEVEL_MIN).max(GRADE_LEVEL_MAX),
  is_graded: z.boolean().default(true),
  program: z.enum(["regular", "madrasah", "als"]).default("regular"),
  // "none" rather than null: a Radix Select item cannot carry an empty value.
  // Mapped back to NULL on save (migration 153).
  mapeh_component: z
    .enum(["none", "music", "arts", "pe", "health"])
    .default("none"),
  is_active: z.boolean().default(true),
});

type FormType = z.infer<typeof FormSchema>;

export const AddModal = ({ isOpen, onClose, editData }: ModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set when a subject literally named MAPEH already exists at this grade
  // level. Tagging components alongside it would print MAPEH twice, so the
  // save is held until the user accepts it — the "Save anyway" shape
  // migration 124 established for intentional schedule double-bookings.
  const [mapehCollision, setMapehCollision] = useState<string | null>(null);
  const [acceptMapehCollision, setAcceptMapehCollision] = useState(false);
  const hasResetForEditRef = useRef<string | null>(null);

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);

  const form = useForm<FormType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      code: "",
      name: "",
      description: "",
      grade_level: 1,
      is_graded: true,
      program: "regular",
      mapeh_component: "none",
      is_active: true,
    },
  });

  // Reset form when modal opens or when teachers finish loading (for edit mode)
  useEffect(() => {
    if (!isOpen) {
      hasResetForEditRef.current = null;
      setMapehCollision(null);
      setAcceptMapehCollision(false);
      return;
    }

    // If editing, reset form with edit data
    if (editData?.id) {
      const editId = editData.id;
      if (hasResetForEditRef.current !== editId) {
        form.reset({
          code: editData.code || "",
          name: editData.name || "",
          description: editData.description || "",
          grade_level: editData.grade_level ?? GRADE_LEVEL_MIN,
          is_graded: editData.is_graded ?? true,
          program: getSubjectProgram(editData),
          mapeh_component: editData.mapeh_component ?? "none",
          is_active: editData.is_active ?? true,
        });
        hasResetForEditRef.current = editId;
      }
    }
    // If not editing, reset to defaults immediately
    else if (!editData && hasResetForEditRef.current !== "add") {
      form.reset({
        code: "",
        name: "",
        description: "",
        grade_level: 1,
        is_graded: true,
        program: "regular",
        mapeh_component: "none",
        is_active: true,
      });
      hasResetForEditRef.current = "add";
    }
  }, [form, editData, isOpen]);

  const onSubmit = async (data: FormType) => {
    if (isSubmitting) return;

    const mapehComponent =
      data.mapeh_component === "none" ? null : data.mapeh_component;

    // A MAPEH component is folded into a computed parent row that DOES count
    // toward the general average; a Madrasah/ALS subject is deliberately left
    // out of it (migration 076). Tagging one as the other asks the card to
    // both include and exclude the same grade, so refuse rather than pick.
    if (mapehComponent && isSelectiveProgram(data.program)) {
      toast.error(
        "A Madrasah or ALS subject cannot be a MAPEH component — those programs are left out of the general average, while MAPEH counts toward it. Set the program to Regular first.",
      );
      return;
    }

    // Tagging components beside a subject already named MAPEH would print the
    // learning area twice: once as that subject's own row, once as the
    // computed group. Warn, but let the school proceed — suppressing the
    // untagged row would hide grades a teacher actually encoded.
    if (mapehComponent && !acceptMapehCollision) {
      let collisionQuery = supabase
        .from(table)
        .select("name", { count: "exact" })
        .eq("grade_level", data.grade_level)
        .eq("is_active", true)
        .ilike("name", "mapeh")
        .is("mapeh_component", null);
      if (user?.school_id != null) {
        collisionQuery = collisionQuery.eq("school_id", user.school_id);
      }
      if (editData?.id) {
        collisionQuery = collisionQuery.neq("id", editData.id);
      }
      const { count: collisionCount } = await collisionQuery;

      if (collisionCount != null && collisionCount > 0) {
        setMapehCollision(getGradeLevelLabel(data.grade_level));
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const newData = {
        code: data.code.trim().toUpperCase(),
        name: data.name.trim(),
        description: data.description?.trim() || null,
        grade_level: data.grade_level,
        is_graded: data.is_graded,
        program: data.program,
        // Derived from program by migration 133's trigger; written here too so
        // the row is consistent without relying on it.
        is_madrasah: isSelectiveProgram(data.program),
        // NULL = not part of MAPEH (migration 153)
        mapeh_component: mapehComponent,
        is_active: data.is_active,
        ...(user?.school_id != null && { school_id: user.school_id }),
      };

      if (editData?.id) {
        // ALS subjects are scheduled in ALS sections and nowhere else
        // (migration 136), so crossing that line would leave every schedule
        // this subject already has in the wrong kind of section.
        const wasAls = getSubjectProgram(editData) === "als";
        const isAls = data.program === "als";
        if (wasAls !== isAls) {
          let alsCheckQuery = supabase
            .from("sms_subject_schedules")
            .select("*", { count: "exact", head: true })
            .eq("subject_id", editData.id);
          if (user?.school_id != null) {
            alsCheckQuery = alsCheckQuery.eq("school_id", user.school_id);
          }
          const { count: alsScheduleCount } = await alsCheckQuery;

          if (alsScheduleCount != null && alsScheduleCount > 0) {
            toast.error(
              isAls
                ? "Cannot switch this subject to ALS because it is already scheduled in non-ALS sections. Remove the schedules first."
                : "Cannot switch this subject away from ALS because it is already scheduled in ALS sections. Remove the schedules first.",
            );
            setIsSubmitting(false);
            return;
          }
        }

        // Prevent grade_level change if subject is already linked to schedules
        if (editData.grade_level !== data.grade_level) {
          let scheduleCheckQuery = supabase
            .from("sms_subject_schedules")
            .select("*", { count: "exact", head: true })
            .eq("subject_id", editData.id);
          if (user?.school_id != null) {
            scheduleCheckQuery = scheduleCheckQuery.eq(
              "school_id",
              user.school_id,
            );
          }
          const { count: scheduleCount } = await scheduleCheckQuery;

          if (scheduleCount != null && scheduleCount > 0) {
            toast.error(
              "Cannot change grade level because this subject is already assigned to schedules. Remove the schedules first.",
            );
            setIsSubmitting(false);
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

        if (error) throw new Error(error.message);

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
        toast.success("Subject updated successfully!");
      } else {
        const { data: inserted, error } = await supabase
          .from(table)
          .insert([newData])
          .select()
          .single();

        if (error) {
          if (error.code === "23505") {
            toast.error("Subject code already exists in this school");
            setIsSubmitting(false);
            return;
          }
          throw new Error(error.message);
        }

        if (inserted) {
          dispatch(addItem(inserted));
        }
        onClose();
        toast.success("Subject added successfully!");
      }
    } catch (err) {
      console.error("Submission error:", err);
      toast.error(err instanceof Error ? err.message : "Error saving subject");
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

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {editData ? "Edit" : "Add"} {title}
          </DialogTitle>
          <DialogDescription>
            {editData
              ? "Update subject information below."
              : "Fill in the details to add a new subject."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <FormField
                control={form.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Subject Code <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., MATH-101"
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
                      disabled={isSubmitting}
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

              <FormField
                control={form.control}
                name="is_graded"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Grading
                    </FormLabel>
                    <Select
                      onValueChange={(value) =>
                        field.onChange(value === "graded")
                      }
                      value={field.value ? "graded" : "no_graded"}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select grading type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="graded">Graded</SelectItem>
                        <SelectItem value="no_graded">
                          Not graded
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="program"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Program
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select program type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {SUBJECT_PROGRAMS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isSelectiveProgram(field.value) && (
                      <p className="text-xs text-muted-foreground">
                        {getSubjectProgramDescription(field.value)} — only
                        learners you add to this subject take it, and it is left
                        out of the general average.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Subject Name <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Mathematics"
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
              name="mapeh_component"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    MAPEH Component
                  </FormLabel>
                  <Select
                    onValueChange={(value) => {
                      field.onChange(value);
                      // A different choice is a different question; make the
                      // school re-accept any duplicate-MAPEH warning.
                      setMapehCollision(null);
                      setAcceptMapehCollision(false);
                    }}
                    value={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="h-10">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="none">Not part of MAPEH</SelectItem>
                      {MAPEH_COMPONENTS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.value !== "none" && (
                    <p className="text-xs text-muted-foreground">
                      Prints as {getMapehComponentLabel(field.value)} indented
                      under a MAPEH row on the report card and SF9. MAPEH is
                      averaged from its components and counts once toward the
                      general average, not once per component.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {mapehCollision && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
                <p className="text-xs text-amber-900">
                  A subject named <strong>MAPEH</strong> already exists for{" "}
                  {mapehCollision}. Tagging components as well will print MAPEH
                  twice on the card — once as that subject&apos;s own row, and
                  once as the group computed from its components.
                </p>
                <label className="flex items-start gap-2 text-xs text-amber-900">
                  <Checkbox
                    className="mt-0.5"
                    checked={acceptMapehCollision}
                    onChange={(e) => setAcceptMapehCollision(e.target.checked)}
                    disabled={isSubmitting}
                  />
                  <span>Save anyway — I know both rows will appear.</span>
                </label>
              </div>
            )}

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Description
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter subject description (optional)"
                      className="min-h-[80px]"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
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
