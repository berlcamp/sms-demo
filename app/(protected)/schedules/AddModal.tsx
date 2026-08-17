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
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { addItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { ALS_SECTION_TYPE, isAlsSectionType } from "@/lib/constants";
import { cn } from "@/lib/utils";
import {
  blocksOverlap,
  checkScheduleConflicts,
  describeBlock,
  parseDbConflictError,
  type ScheduleConflictLookups,
  type TimeBlock,
} from "@/lib/utils/scheduleConflicts";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import {
  fetchAssignableStaff,
  FORMER_STAFF_LABEL,
  type StaffOption,
} from "@/lib/utils/staff";
import { RootState, SubjectSchedule } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { z } from "zod";

type ItemType = SubjectSchedule;
const table = "sms_subject_schedules";
const title = "Schedule";

/**
 * Sentinel for the "no teacher" option. Radix Select rejects "" as an item
 * value, so the empty choice needs a stand-in. Saved as NULL — see migration 117.
 */
const NO_TEACHER = "none";

/**
 * A schedule with no teacher is "Temporary". It is still checked for room
 * clashes; only the teacher and section checks fall away.
 */
const hasTeacher = (teacherId: string | undefined): boolean =>
  !!teacherId && teacherId !== NO_TEACHER;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  editData?: ItemType | null;
  /** Pre-fill section when adding (e.g. from View Subjects modal) */
  initialSectionId?: string;
  /** Pre-fill school year when adding */
  initialSchoolYear?: string;
  /** Pre-fill and lock subject when adding from View Subjects modal */
  initialSubjectId?: string;
  /** Display label for locked subject (e.g. "MATH 101 - Algebra") */
  initialSubjectLabel?: string;
  /** When true, subject field is read-only (used with initialSubjectId) */
  subjectLocked?: boolean;
  /** When provided, fetch schedules for this year for conflict check instead of using Redux */
  conflictCheckSchoolYear?: string;
  /** Called after successful add/update before closing */
  onSuccess?: () => void;
  /** When true, do not dispatch to Redux (e.g. when opened from sections page) */
  skipReduxUpdate?: boolean;
}

const TIME_PATTERN = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;

/**
 * One set of days sharing one time span — "Mon, Wed 8:00–9:00".
 *
 * A subject rarely meets at the same hour all week: the same class may sit
 * 8–9am on Mon/Wed and 2–3pm on Fri. Each block is saved as its own
 * sms_subject_schedules row, which is the shape the rest of the system already
 * reads — the calendar filters row by row, and teaching load / SF7 sum row by
 * row, so two blocks total correctly without any schema change.
 */
const BlockSchema: z.ZodType<TimeBlock> = z
  .object({
    days_of_week: z
      .array(z.number())
      .min(1, "At least one day must be selected"),
    start_time: z.string().regex(TIME_PATTERN, "Invalid time format (HH:mm)"),
    end_time: z.string().regex(TIME_PATTERN, "Invalid time format (HH:mm)"),
  })
  .refine(
    (block) => toMinutes(block.end_time) > toMinutes(block.start_time),
    {
      message: "End time must be after start time",
      path: ["end_time"],
    },
  );

const FormSchema = z.object({
  subject_id: z.string().min(1, "Subject is required"),
  section_id: z.string().min(1, "Section is required"),
  // Optional: a schedule may be created before a teacher is assigned
  teacher_id: z.string(),
  room_id: z.string().min(1, "Room is required"),
  blocks: z.array(BlockSchema).min(1, "At least one time block is required"),
  school_year: z.string().min(1, "School year is required"),
});

type FormType = z.infer<typeof FormSchema>;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

const DAYS = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

const EMPTY_BLOCK: TimeBlock = {
  days_of_week: [],
  start_time: "08:00",
  end_time: "09:00",
};

/**
 * form.watch() hands back a deep-partial (a block may be half-typed, days may
 * hold holes) while form.getValues() hands back the full FormType. The conflict
 * check accepts both and keeps only the blocks that are complete enough to
 * compare.
 */
type LooseValues = {
  subject_id?: string;
  section_id?: string;
  teacher_id?: string;
  room_id?: string;
  school_year?: string;
  blocks?: Array<
    | {
        days_of_week?: (number | undefined)[];
        start_time?: string;
        end_time?: string;
      }
    | undefined
  >;
};

const completeBlocks = (blocks: LooseValues["blocks"]): TimeBlock[] =>
  (blocks ?? []).flatMap((block) => {
    const days = (block?.days_of_week ?? []).filter(
      (day): day is number => day !== undefined,
    );
    if (days.length === 0 || !block?.start_time || !block?.end_time) return [];
    return [
      {
        days_of_week: days,
        start_time: block.start_time,
        end_time: block.end_time,
      },
    ];
  });

/**
 * Day toggles for one block. Pills rather than a checkbox grid: a schedule may
 * now hold several blocks stacked in the same modal, and seven labelled
 * checkboxes per block pushes everything else off the screen.
 */
const DayPicker = ({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (days: number[]) => void;
  disabled?: boolean;
}) => (
  <div className="flex flex-wrap gap-1.5">
    {DAYS.map((day) => {
      const selected = value.includes(day.value);
      return (
        <button
          key={day.value}
          type="button"
          disabled={disabled}
          aria-pressed={selected}
          aria-label={day.label}
          onClick={() =>
            onChange(
              selected
                ? value.filter((d) => d !== day.value)
                : [...value, day.value].sort((a, b) => a - b),
            )
          }
          className={cn(
            "h-8 rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            selected
              ? "border-primary bg-primary text-primary-foreground"
              : "border-input bg-background text-muted-foreground hover:bg-muted",
          )}
        >
          {day.short}
        </button>
      );
    })}
  </div>
);

export const AddModal = ({
  isOpen,
  onClose,
  editData,
  initialSectionId,
  initialSchoolYear,
  initialSubjectId,
  initialSubjectLabel,
  subjectLocked,
  conflictCheckSchoolYear,
  onSuccess,
  skipReduxUpdate,
}: ModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [conflictCheckSchedules, setConflictCheckSchedules] = useState<
    SubjectSchedule[]
  >([]);
  const [subjects, setSubjects] = useState<
    Array<{
      id: string;
      name: string;
      code: string;
      grade_level: number;
      program: string | null;
    }>
  >([]);
  const [sections, setSections] = useState<
    Array<{
      id: string;
      name: string;
      grade_level: number;
      section_type: string | null;
    }>
  >([]);
  const [teachers, setTeachers] = useState<StaffOption[]>([]);
  const [rooms, setRooms] = useState<Array<{ id: string; name: string }>>([]);
  const [conflicts, setConflicts] = useState<string[]>([]);
  /**
   * Encoder ticked "Create anyway" on the conflict warning. Schools do run
   * combined classes — two grade levels in one room under one teacher — so a
   * detected clash is a warning, not a wall. Persisted as conflict_override so
   * the DB trigger lets the row through; see migration 124.
   */
  const [overrideConflicts, setOverrideConflicts] = useState(false);
  /** Blocks of THIS schedule colliding with each other — never overridable */
  const [blockOverlaps, setBlockOverlaps] = useState<string[]>([]);
  const hasResetForEditRef = useRef<string | null>(null);

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);
  const allSchedules = useSelector(
    (state: RootState) => state.list.value,
  ) as SubjectSchedule[];

  const form = useForm<FormType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      subject_id: "",
      section_id: "",
      teacher_id: NO_TEACHER,
      room_id: "",
      blocks: [EMPTY_BLOCK],
      school_year: getCurrentSchoolYear(),
    },
  });

  const {
    fields: blockFields,
    append: appendBlock,
    remove: removeBlock,
  } = useFieldArray({ control: form.control, name: "blocks" });

  const blockValues = form.watch("blocks") ?? [];

  /**
   * An ALS section takes ALS subjects and nothing else, and an ALS subject is
   * scheduled nowhere else (migration 136), so the section chosen decides which
   * subjects are on offer. Before a section is picked the full list stands.
   */
  const selectedSectionId = form.watch("section_id");
  const selectedSection = useMemo(
    () => sections.find((s) => String(s.id) === selectedSectionId) ?? null,
    [sections, selectedSectionId],
  );
  const visibleSubjects = useMemo(() => {
    if (!selectedSection) return subjects;
    const wantsAls = isAlsSectionType(selectedSection.section_type);
    return subjects.filter(
      (subject) => (subject.program === ALS_SECTION_TYPE) === wantsAls,
    );
  }, [subjects, selectedSection]);

  // Switching to a section of the other kind strands whatever subject was
  // already picked, so it is cleared rather than silently submitted.
  useEffect(() => {
    const current = form.getValues("subject_id");
    if (!current || !selectedSectionId || subjects.length === 0) return;
    if (!visibleSubjects.some((s) => String(s.id) === current)) {
      form.setValue("subject_id", "");
    }
  }, [form, visibleSubjects, selectedSectionId, subjects.length]);

  // Fetch ALL schedules for conflict check (avoids filtered Redux list).
  // Uses conflictCheckSchoolYear when provided (e.g. ViewSubjectsModal), else form's school_year.
  const formSchoolYear = form.watch("school_year");
  const targetSchoolYear =
    conflictCheckSchoolYear ?? formSchoolYear ?? getCurrentSchoolYear();

  useEffect(() => {
    if (!isOpen || !targetSchoolYear?.trim()) {
      setConflictCheckSchedules([]);
      return;
    }

    const fetchSchedules = async () => {
      let query = supabase
        .from("sms_subject_schedules")
        .select("*")
        .eq("school_year", targetSchoolYear.trim());
      if (user?.school_id != null) {
        query = query.eq("school_id", user.school_id);
      }
      const { data } = await query;
      setConflictCheckSchedules(data || []);
    };

    fetchSchedules();
  }, [isOpen, targetSchoolYear, user?.school_id]);

  // Fetch dropdown data
  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      // Fetch subjects (school-scoped)
      let subjectsQuery = supabase
        .from("sms_subjects")
        .select("id, name, code, grade_level, program")
        .eq("is_active", true)
        .order("code");
      if (user?.school_id != null) {
        subjectsQuery = subjectsQuery.eq("school_id", user.school_id);
      }
      const { data: subjectsData } = await subjectsQuery;
      if (subjectsData) {
        setSubjects(subjectsData);
      }

      // Fetch sections (school-scoped)
      let sectionsQuery = supabase
        .from("sms_sections")
        .select("id, name, grade_level, section_type")
        .eq("is_active", true)
        .order("name");
      if (user?.school_id != null) {
        sectionsQuery = sectionsQuery.eq("school_id", user.school_id);
      }
      const { data: sectionsData } = await sectionsQuery;
      if (sectionsData) {
        setSections(sectionsData);
      }

      // Fetch teachers (school-scoped; all users except division_admin/
      // division_type can be assigned as subject teachers). The row's own
      // teacher is added even after they move schools, so an edit shows who is
      // on it instead of an empty box over a live value.
      setTeachers(
        await fetchAssignableStaff(user?.school_id, editData?.teacher_id),
      );

      // Fetch rooms (school-scoped)
      let roomsQuery = supabase
        .from("sms_rooms")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (user?.school_id != null) {
        roomsQuery = roomsQuery.eq("school_id", user.school_id);
      }
      const { data: roomsData } = await roomsQuery;
      if (roomsData) {
        setRooms(roomsData);
      }
    };

    fetchData();
  }, [isOpen, user?.school_id, editData?.teacher_id]);

  // Helper function to normalize time format from HH:mm:ss to HH:mm
  const normalizeTime = (time: string): string => {
    if (!time) return time;
    // If time includes seconds (HH:mm:ss), strip them
    return time.split(":").slice(0, 2).join(":");
  };

  // Reset form when modal opens
  useEffect(() => {
    if (!isOpen) {
      hasResetForEditRef.current = null;
      setConflicts([]);
      setOverrideConflicts(false);
      return;
    }

    if (editData?.id) {
      const editId = editData.id;
      if (hasResetForEditRef.current !== editId) {
        form.reset({
          subject_id: String(editData.subject_id),
          section_id: String(editData.section_id),
          teacher_id:
            editData.teacher_id != null
              ? String(editData.teacher_id)
              : NO_TEACHER,
          room_id: String(editData.room_id),
          // An edit targets one row, so it opens as one block; extra blocks
          // added here are saved as additional rows
          blocks: [
            {
              days_of_week: editData.days_of_week,
              start_time: normalizeTime(editData.start_time),
              end_time: normalizeTime(editData.end_time),
            },
          ],
          school_year: editData.school_year,
        });
        // A row already saved as an accepted conflict re-opens with the
        // acknowledgement kept, so an unrelated edit does not have to re-tick it
        setOverrideConflicts(!!editData.conflict_override);
        hasResetForEditRef.current = editId;
      }
    } else if (!editData && hasResetForEditRef.current !== "add") {
      const currentYear = initialSchoolYear ?? getCurrentSchoolYear();
      form.reset({
        subject_id: initialSubjectId != null ? String(initialSubjectId) : "",
        section_id: initialSectionId != null ? String(initialSectionId) : "",
        teacher_id: NO_TEACHER,
        room_id: "",
        blocks: [EMPTY_BLOCK],
        school_year: currentYear,
      });
      setOverrideConflicts(false);
      hasResetForEditRef.current = "add";
    }
  }, [
    form,
    editData,
    isOpen,
    initialSectionId,
    initialSchoolYear,
    initialSubjectId,
  ]);

  // Always use freshly fetched schedules for conflict check (avoids filtered list)
  const schedulesForConflictCheck =
    conflictCheckSchedules.length > 0 ? conflictCheckSchedules : allSchedules;

  /**
   * Conflicts for every block, split by whether they can be overridden.
   *
   *  - `external` — this schedule against ones already saved. A school may mean
   *    these (combined classes), so they are overridable.
   *  - `internal` — two blocks of THIS schedule landing on the same day at the
   *    same hour. One class cannot meet twice at once; that is a typo, not an
   *    arrangement, so it is a hard stop.
   */
  const detectConflicts = useCallback(
    (
      values: LooseValues,
    ): {
      external: string[];
      /** Aligned with the blocks, so each saved row can carry its own flag */
      externalByBlock: string[][];
      internal: string[];
    } => {
      const blocks = completeBlocks(values.blocks);
      if (
        !values.subject_id ||
        !values.section_id ||
        !values.room_id ||
        !values.school_year ||
        blocks.length === 0
      ) {
        return { external: [], externalByBlock: [], internal: [] };
      }

      const lookups: ScheduleConflictLookups = {
        rooms: rooms.map((r) => ({ id: String(r.id), name: r.name })),
        teachers: teachers.map((t) => ({ id: String(t.id), name: t.name })),
        sections: sections.map((s) => ({ id: String(s.id), name: s.name })),
      };

      // Name the block only when there is more than one, so the single-block
      // case reads exactly as it did before
      const prefix = (block: TimeBlock) =>
        blocks.length > 1 ? `${describeBlock(block)} — ` : "";

      const externalByBlock = blocks.map((block) =>
        checkScheduleConflicts(
          {
            room_id: values.room_id as string,
            // Map the "no teacher" sentinel to null so it is never compared as an id
            teacher_id: hasTeacher(values.teacher_id)
              ? (values.teacher_id as string)
              : null,
            section_id: values.section_id as string,
            days_of_week: block.days_of_week,
            start_time: block.start_time,
            end_time: block.end_time,
            school_year: values.school_year as string,
          },
          schedulesForConflictCheck,
          editData?.id,
          lookups,
        ).map((conflict) => `${prefix(block)}${conflict.message}`),
      );
      const external = externalByBlock.flat();

      const internal: string[] = [];
      for (let i = 0; i < blocks.length; i++) {
        for (let j = i + 1; j < blocks.length; j++) {
          if (blocksOverlap(blocks[i]!, blocks[j]!)) {
            internal.push(
              `${describeBlock(blocks[i]!)} and ${describeBlock(
                blocks[j]!,
              )} overlap — the same class cannot meet twice at once.`,
            );
          }
        }
      }

      return { external, externalByBlock, internal };
    },
    [rooms, teachers, sections, schedulesForConflictCheck, editData?.id],
  );

  // Check for conflicts when form values change
  useEffect(() => {
    const runCheck = (values: LooseValues) => {
      const { external, internal } = detectConflicts(values);
      setConflicts(external);
      setBlockOverlaps(internal);
    };

    // Run against the values already in the form, not only on the next change:
    // an edit opens with every field filled, so a clash on an existing row has
    // to be visible before the user touches anything.
    runCheck(form.getValues());

    const subscription = form.watch((values) => runCheck(values));

    return () => subscription.unsubscribe();
  }, [form, detectConflicts]);

  const onSubmit = async (data: FormType) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    const teacherAssigned = hasTeacher(data.teacher_id);

    try {
      // Check conflicts one more time before submitting. A Temporary schedule
      // (no teacher) is still room-checked; teacher/section checks fall away.
      const { external, externalByBlock, internal } = detectConflicts(data);

      // Two blocks of this same schedule colliding is bad data, not a shared
      // room — it cannot be overridden away
      if (internal.length > 0) {
        toast.error("Time blocks overlap each other. Adjust the days or times.");
        setBlockOverlaps(internal);
        setIsSubmitting(false);
        return;
      }

      // A clash blocks the save unless the encoder explicitly accepted it
      if (external.length > 0 && !overrideConflicts) {
        toast.error("Conflicts detected — see details below.");
        setConflicts(external);
        setIsSubmitting(false);
        return;
      }

      // Only the server saw a clash (it checks rows this modal never fetched),
      // so it cannot be attributed to one block — every row has to carry the
      // flag or the retry is rejected again.
      const serverOnlyConflict =
        external.length === 0 && overrideConflicts && conflicts.length > 0;

      // One row per time block: "Mon/Wed 8-9" and "Fri 2-3" are two rows of the
      // same subject, section, teacher and room. The flag records what was true
      // for THAT block, so a clean block is not marked as an accepted conflict
      // just because a sibling clashes.
      const rowFor = (block: TimeBlock, index: number) => ({
        subject_id: parseInt(data.subject_id),
        section_id: parseInt(data.section_id),
        teacher_id: teacherAssigned ? parseInt(data.teacher_id) : null,
        room_id: parseInt(data.room_id),
        days_of_week: block.days_of_week,
        start_time: `${block.start_time}:00`, // Add seconds for TIME type
        end_time: `${block.end_time}:00`,
        school_year: data.school_year.trim(),
        conflict_override:
          serverOnlyConflict || (externalByBlock[index]?.length ?? 0) > 0,
        ...(user?.school_id != null && { school_id: user.school_id }),
      });

      // On edit the first block updates the row that was opened; any block
      // added alongside it is a new row
      const newData = rowFor(data.blocks[0]!, 0);
      const extraRows = data.blocks
        .slice(1)
        .map((block, index) => rowFor(block, index + 1));

      if (editData?.id) {
        let updateQuery = supabase
          .from(table)
          .update(newData)
          .eq("id", editData.id);
        if (user?.school_id != null) {
          updateQuery = updateQuery.eq("school_id", user.school_id);
        }
        const { error } = await updateQuery;

        if (error) {
          const dbConflicts = parseDbConflictError(error.message);
          if (dbConflicts) {
            // The trigger saw a clash the client check did not. Show what it
            // said, so the override checkbox appears and the save is retryable.
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
          let selectQuery = supabase
            .from(table)
            .select()
            .eq("id", editData.id);
          if (user?.school_id != null) {
            selectQuery = selectQuery.eq("school_id", user.school_id);
          }
          const { data: updated } = await selectQuery.single();

          if (updated && !skipReduxUpdate) {
            dispatch(updateList(updated));
          }

          // Blocks added during the edit become rows of their own. The update
          // above is already committed, so a failure here is reported as the
          // partial save it is rather than swallowed.
          if (extraRows.length > 0) {
            const { data: addedRows, error: addError } = await supabase
              .from(table)
              .insert(extraRows)
              .select();

            if (addError) {
              setIsSubmitting(false);
              toast.error(
                `Saved the edited time block, but the ${extraRows.length} new one(s) failed: ${addError.message}`,
              );
              return;
            }

            if (addedRows && !skipReduxUpdate) {
              addedRows.forEach((row) => dispatch(addItem(row)));
            }
          }

          onSuccess?.();
          onClose();
          toast.success(
            extraRows.length > 0
              ? `Schedule updated and ${extraRows.length} time block(s) added!`
              : "Schedule updated successfully!",
          );
        }
      } else {
        // Single statement, so the blocks are inserted or rejected together
        const { data: inserted, error } = await supabase
          .from(table)
          .insert([newData, ...extraRows])
          .select();

        if (error) {
          const dbConflicts = parseDbConflictError(error.message);
          if (dbConflicts) {
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
          if (inserted && !skipReduxUpdate) {
            inserted.forEach((row) => dispatch(addItem(row)));
          }
          onSuccess?.();
          onClose();
          toast.success(
            data.blocks.length > 1
              ? `Schedule added with ${data.blocks.length} time blocks!`
              : "Schedule added successfully!",
          );
        }
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
      setBlockOverlaps([]);
      setOverrideConflicts(false);
      onClose();
    }
  };

  /**
   * A new block starts from the last one's times — a Friday afternoon slot is
   * usually a variation on what is already there, not a blank form.
   */
  const handleAddBlock = () => {
    const last = form.getValues("blocks").at(-1);
    appendBlock({
      days_of_week: [],
      start_time: last?.start_time ?? EMPTY_BLOCK.start_time,
      end_time: last?.end_time ?? EMPTY_BLOCK.end_time,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {editData ? "Edit" : "Add"} {title}
          </DialogTitle>
          <DialogDescription>
            {editData
              ? "Update schedule information below."
              : "Fill in the details to add a new schedule."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="subject_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Subject <span className="text-red-500">*</span>
                    </FormLabel>
                    {subjectLocked && field.value ? (
                      <div className="h-10 px-3 py-2 rounded-md border bg-muted text-sm font-medium flex items-center">
                        {initialSubjectLabel ??
                          (() => {
                            const subj = subjects.find(
                              (s) => String(s.id) === field.value,
                            );
                            return subj
                              ? `${subj.code} - ${subj.name}`
                              : field.value;
                          })()}
                      </div>
                    ) : (
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isSubmitting}
                      >
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select subject" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {visibleSubjects.map((subject) => (
                            <SelectItem
                              key={subject.id}
                              value={String(subject.id)}
                            >
                              {subject.code} - {subject.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {selectedSection && visibleSubjects.length === 0 && (
                      <p className="text-xs text-amber-700">
                        {isAlsSectionType(selectedSection.section_type)
                          ? "This is an ALS section, so only ALS subjects can be scheduled here — there are none yet."
                          : "Only ALS subjects are available, and they belong to ALS sections only."}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              {!initialSectionId ? (
                <FormField
                  control={form.control}
                  name="section_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">
                        Section <span className="text-red-500">*</span>
                      </FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                        disabled={isSubmitting}
                      >
                        <FormControl>
                          <SelectTrigger className="h-10">
                            <SelectValue placeholder="Select section" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {sections.map((section) => (
                            <SelectItem
                              key={section.id}
                              value={String(section.id)}
                            >
                              {section.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <FormField
                  control={form.control}
                  name="section_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">Section</FormLabel>
                      <div className="h-10 px-3 py-2 rounded-md border bg-muted text-sm font-medium flex items-center">
                        {sections.find((s) => String(s.id) === field.value)?.name ?? "Loading..."}
                      </div>
                    </FormItem>
                  )}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="teacher_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Teacher
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select teacher" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value={NO_TEACHER}>
                          No teacher (Temporary)
                        </SelectItem>
                        {teachers.map((teacher) => (
                          <SelectItem
                            key={teacher.id}
                            value={String(teacher.id)}
                          >
                            {teacher.name}
                            {teacher.isFormer && ` — ${FORMER_STAFF_LABEL}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!hasTeacher(field.value) && (
                      <p className="text-xs text-amber-700">
                        Saved as Temporary. Room conflicts are still checked;
                        teacher and section conflicts are not, until a teacher is
                        assigned.
                      </p>
                    )}
                    {teachers.some(
                      (t) => t.isFormer && t.id === field.value,
                    ) && (
                      <p className="text-xs text-amber-700">
                        This teacher has moved to another school. Saving keeps
                        them on the slot — pick a replacement, or &quot;No
                        teacher (Temporary)&quot;, to hand it over.
                      </p>
                    )}
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
                      Room <span className="text-red-500">*</span>
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select room" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {rooms.map((room) => (
                          <SelectItem key={room.id} value={String(room.id)}>
                            {room.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <FormLabel className="text-sm font-medium">
                  Meeting Times <span className="text-red-500">*</span>
                </FormLabel>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleAddBlock}
                  disabled={isSubmitting}
                  className="h-8"
                >
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add time block
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Days that share a time go in one block. Add another block when a
                day meets at a different hour — e.g. Mon &amp; Wed 8:00–9:00,
                Fri 14:00–15:00.
              </p>

              {blockFields.map((blockField, index) => {
                const block = blockValues[index];
                const days = block?.days_of_week ?? [];
                return (
                  <div
                    key={blockField.id}
                    className="rounded-md border bg-muted/30 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-muted-foreground">
                        {days.length > 0 && block
                          ? describeBlock(block as TimeBlock)
                          : `Time block ${index + 1}`}
                      </span>
                      {blockFields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeBlock(index)}
                          disabled={isSubmitting}
                          className="h-7 px-2 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1" />
                          Remove
                        </Button>
                      )}
                    </div>

                    <FormField
                      control={form.control}
                      name={`blocks.${index}.days_of_week`}
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <DayPicker
                              value={field.value ?? []}
                              onChange={field.onChange}
                              disabled={isSubmitting}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name={`blocks.${index}.start_time`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium text-muted-foreground">
                              Start Time
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="time"
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
                        name={`blocks.${index}.end_time`}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-xs font-medium text-muted-foreground">
                              End Time
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="time"
                                className="h-10"
                                {...field}
                                disabled={isSubmitting}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {editData && index > 0 && (
                      <p className="text-xs text-muted-foreground">
                        Saved as a separate schedule entry for this subject.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-4">
              {!initialSchoolYear ? (
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
              ) : (
                <FormField
                  control={form.control}
                  name="school_year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-sm font-medium">School Year</FormLabel>
                      <div className="h-10 px-3 py-2 rounded-md border bg-muted text-sm font-medium flex items-center">
                        {field.value}
                      </div>
                    </FormItem>
                  )}
                />
              )}
            </div>

            {blockOverlaps.length > 0 && (
              <div className="rounded-md bg-red-50 border border-red-200 p-4">
                <h4 className="text-sm font-medium text-red-800 mb-2">
                  Time Blocks Overlap:
                </h4>
                <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                  {blockOverlaps.map((overlap, index) => (
                    <li key={index}>{overlap}</li>
                  ))}
                </ul>
              </div>
            )}

            {conflicts.length > 0 && (
              <div className="rounded-md bg-red-50 border border-red-200 p-4 space-y-3">
                <div>
                  <h4 className="text-sm font-medium text-red-800 mb-2">
                    Schedule Conflicts Detected:
                  </h4>
                  <ul className="list-disc list-inside text-sm text-red-700 space-y-1">
                    {conflicts.map((conflict, index) => (
                      <li key={index}>{conflict}</li>
                    ))}
                  </ul>
                </div>
                <label className="flex items-start gap-3 cursor-pointer border-t border-red-200 pt-3">
                  <Checkbox
                    checked={overrideConflicts}
                    onChange={(e) => setOverrideConflicts(e.target.checked)}
                    disabled={isSubmitting}
                    className="mt-0.5"
                  />
                  <span className="text-sm text-red-800">
                    Save anyway — this double-booking is intentional
                    <span className="block text-xs font-normal text-red-700 mt-0.5">
                      For combined classes, e.g. two grade levels handled
                      together in one room by the same teacher. The schedule is
                      kept and marked as a shared slot.
                    </span>
                  </span>
                </label>
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
                disabled={
                  isSubmitting ||
                  blockOverlaps.length > 0 ||
                  (conflicts.length > 0 && !overrideConflicts)
                }
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
