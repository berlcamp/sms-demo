"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useStaffModuleAccess } from "@/hooks/useStaffModuleAccess";
import {
  CAREER_STAGE_ORDER,
  CAREER_STAGES,
  careerStageLabel,
  cotIndicators,
  kraForIndicator,
  MAX_OBSERVERS_PER_OBSERVATION,
  parseFocusList,
  RPMS_KRAS,
  suggestCareerStage,
  SUPERVISION_TERMS,
  SUPERVISION_TYPE_LABELS,
  type CareerStage,
  type SupervisionType,
} from "@/lib/constants/supervision";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  LESSON_PLAN_ACCEPT,
  LESSON_PLAN_MAX_BYTES,
  lessonPlanPath,
  lessonPlanSignedUrl,
  SUPERVISION_BUCKET,
  toDatetimeLocal,
} from "@/lib/utils/supervision";
import type { SupervisionSchedule, SupervisionScheduleObserver } from "@/types";
import {
  CalendarClock,
  ExternalLink,
  GraduationCap,
  Loader2,
  Paperclip,
  RefreshCw,
  StickyNote,
  Target,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SupervisionStaff } from "../useSupervision";

export interface ScheduleFormValues {
  teacher_id: string;
  teacher_position: string;
  career_stage: CareerStage;
  supervision_type: SupervisionType;
  term: number;
  observation_round: number;
  quarter: number | null;
  class_label: string;
  pre_conference_at: string;
  observation_at: string;
  observation_end_at: string;
  /** Several KRAs / indicators may be the focus of one observation. */
  focus_kra: string[];
  focus_indicator: string[];
  /** Storage object path under supervision-lesson-plans/, or "" when unattached. */
  lesson_plan_path: string;
  lesson_plan_name: string;
  notes: string;
  observer_ids: string[];
}

interface ScheduleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolYear: string;
  /** Needed to namespace lesson plan uploads by school. */
  schoolId: string | number | null;
  /** Editing an existing slot, or null to propose a new one. */
  existing: {
    schedule: SupervisionSchedule;
    observers: SupervisionScheduleObserver[];
  } | null;
  staff: SupervisionStaff[];
  /** Designated observers for the school year — the assignable pool. */
  observerPool: SupervisionStaff[];
  /**
   * Whether the pool is still being fetched. Without it an empty pool mid-fetch
   * is indistinguishable from "nobody is designated", which reads as a bug.
   */
  observersLoading?: boolean;
  /**
   * A teacher proposing their own slot: the teacher select is locked to them
   * and observer assignment is hidden, since the School Head assigns observers.
   */
  lockedTeacher?: SupervisionStaff | null;
  /**
   * Whether this view may assign observers. Explicit rather than inferred from
   * `lockedTeacher`: deriving it from a looked-up staff record made the section
   * render against an empty pool whenever that lookup missed.
   */
  canAssignObservers?: boolean;
  submitting?: boolean;
  /** Re-reads the designated-observer pool after one is added in another tab. */
  onObserversChanged?: () => void;
  onSubmit: (values: ScheduleFormValues) => void | Promise<void>;
}

function blankValues(): ScheduleFormValues {
  // Default to the term the current date falls in, so the common case needs no
  // change. December belongs to no term in the plan; it falls through to Term 3,
  // which is the next one to be planned.
  const month = new Date().getMonth();
  const term = month >= 5 && month <= 7 ? 1 : month >= 8 && month <= 10 ? 2 : 3;
  return {
    teacher_id: "",
    teacher_position: "",
    career_stage: "proficient_a",
    supervision_type: "rated",
    term,
    observation_round: 1,
    quarter: null,
    class_label: "",
    pre_conference_at: "",
    observation_at: "",
    observation_end_at: "",
    focus_kra: [],
    focus_indicator: [],
    lesson_plan_path: "",
    lesson_plan_name: "",
    notes: "",
    observer_ids: [],
  };
}

/**
 * A titled box grouping related fields. The form is long enough that a flat
 * stack reads as a wall of inputs; the boxes give the School Head the same
 * chunks the paper slip has.
 */
function Section({
  title,
  icon: Icon,
  description,
  children,
}: {
  title: string;
  icon: LucideIcon;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-lg border">
      <header className="border-b bg-muted/40 px-4 py-2.5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {title}
        </h3>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </header>
      <div className="divide-y">{children}</div>
    </section>
  );
}

/**
 * One field per row: label in a fixed left column, control on the right.
 *
 * `controlClassName` caps controls that hold short values (a quarter number, a
 * timestamp) so they do not stretch the full width of a 4xl dialog, which is
 * what made the previous multi-column layout feel arbitrary.
 */
function Field({
  label,
  htmlFor,
  description,
  controlClassName,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  controlClassName?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5 px-4 py-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-start sm:gap-4">
      <Label htmlFor={htmlFor} className="sm:pt-2">
        {label}
      </Label>
      <div className={cn("min-w-0 space-y-1.5", controlClassName)}>
        {children}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

export function ScheduleModal({
  open,
  onOpenChange,
  schoolYear,
  schoolId,
  existing,
  staff,
  observerPool,
  observersLoading,
  lockedTeacher,
  canAssignObservers = true,
  submitting,
  onObserversChanged,
  onSubmit,
}: ScheduleModalProps) {
  // Only School Head / admin can reach /supervision/observers, so the button
  // pointing there must not be offered to a teacher.
  const canDesignateObservers = useStaffModuleAccess();

  const [values, setValues] = useState<ScheduleFormValues>(blankValues);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Paths uploaded during THIS dialog session — the only ones safe to delete,
  // since no saved row references them yet.
  const [sessionUploads, setSessionUploads] = useState<string[]>([]);

  // Re-seed whenever the dialog opens or targets a different slot.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setSessionUploads([]);
    if (existing) {
      const s = existing.schedule;
      setValues({
        teacher_id: String(s.teacher_id),
        teacher_position: s.teacher_position ?? "",
        career_stage: s.career_stage as CareerStage,
        supervision_type: s.supervision_type,
        term: s.term,
        observation_round: s.observation_round,
        quarter: s.quarter,
        class_label: s.class_label ?? "",
        pre_conference_at: toDatetimeLocal(s.pre_conference_at),
        observation_at: toDatetimeLocal(s.observation_at),
        observation_end_at: toDatetimeLocal(s.observation_end_at),
        focus_kra: parseFocusList(s.focus_kra),
        focus_indicator: parseFocusList(s.focus_indicator),
        lesson_plan_path: s.lesson_plan_path ?? "",
        lesson_plan_name: s.lesson_plan_name ?? "",
        notes: s.notes ?? "",
        observer_ids: existing.observers
          .slice()
          .sort((a, b) => a.slot - b.slot)
          .map((o) => String(o.user_id)),
      });
      return;
    }
    const base = blankValues();
    if (lockedTeacher) {
      base.teacher_id = lockedTeacher.id;
      base.teacher_position = lockedTeacher.position ?? "";
      base.career_stage = suggestCareerStage(lockedTeacher.position) ?? "proficient_a";
    }
    setValues(base);
  }, [open, existing, lockedTeacher, schoolYear]);

  /**
   * Re-read the observer pool when this tab regains focus while the pool is
   * empty — the "Designate observers" button opens a second tab, and coming
   * back to a still-empty list looks like the designation did not save.
   */
  useEffect(() => {
    if (!open || observerPool.length > 0 || !onObserversChanged) return;
    const onFocus = () => onObserversChanged();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [open, observerPool.length, onObserversChanged]);

  const indicators = useMemo(() => cotIndicators(schoolYear), [schoolYear]);
  const stage = CAREER_STAGES[values.career_stage];
  /**
   * Whether the free-text position actually resolved to a stage. When it did
   * not, the select still shows a value — but it is a bare default, not a
   * suggestion, and saying "suggested from the position" would invite the user
   * to confirm a scale nothing derived.
   */
  const stageSuggestion = suggestCareerStage(values.teacher_position);

  const set = <K extends keyof ScheduleFormValues>(
    key: K,
    value: ScheduleFormValues[K],
  ) => setValues((prev) => ({ ...prev, [key]: value }));

  /** Picking a teacher re-suggests their career stage from their position. */
  const onTeacherChange = (id: string) => {
    const picked = staff.find((s) => s.id === id);
    setValues((prev) => ({
      ...prev,
      teacher_id: id,
      teacher_position: picked?.position ?? "",
      career_stage: suggestCareerStage(picked?.position) ?? prev.career_stage,
    }));
  };

  const toggleKra = (label: string) =>
    setValues((prev) => ({
      ...prev,
      focus_kra: prev.focus_kra.includes(label)
        ? prev.focus_kra.filter((k) => k !== label)
        : [...prev.focus_kra, label],
    }));

  /**
   * Ticking a focus indicator also ticks the KRA it belongs to. Unticking one
   * leaves the KRA alone — another indicator may still sit under it, and the
   * KRA can be chosen on its own.
   */
  const toggleIndicator = (code: string) => {
    setValues((prev) => {
      if (prev.focus_indicator.includes(code)) {
        return {
          ...prev,
          focus_indicator: prev.focus_indicator.filter((c) => c !== code),
        };
      }
      const kra = kraForIndicator(code)?.label;
      return {
        ...prev,
        focus_indicator: [...prev.focus_indicator, code],
        focus_kra:
          kra && !prev.focus_kra.includes(kra)
            ? [...prev.focus_kra, kra]
            : prev.focus_kra,
      };
    });
  };

  /**
   * Uploads on pick rather than on submit, so the teacher sees the attachment
   * land before committing the form. A file picked and then abandoned leaves an
   * orphan object in the bucket; that is the accepted cost of the immediate
   * feedback, and orphans carry no row that references them.
   */
  const uploadLessonPlan = async (file: File | null) => {
    if (!file) return;
    if (schoolId == null) {
      setError("No school is set for your account, so the file cannot be stored.");
      return;
    }
    if (file.size > LESSON_PLAN_MAX_BYTES) {
      setError(
        `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 15 MB.`,
      );
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const path = lessonPlanPath(schoolId, schoolYear, file.name);
      const { error: upErr } = await supabase.storage
        .from(SUPERVISION_BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw new Error(upErr.message);
      setSessionUploads((prev) => [...prev, path]);
      setValues((prev) => ({
        ...prev,
        lesson_plan_path: path,
        lesson_plan_name: file.name,
      }));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to upload the lesson plan.",
      );
    } finally {
      setUploading(false);
    }
  };

  /**
   * Mint a signed URL rather than composing the public one. The bucket is
   * public today (migration 122), so this buys nothing against a determined
   * reader — it means nothing here breaks if the bucket is ever made private.
   */
  const openLessonPlan = async () => {
    const url = await lessonPlanSignedUrl(values.lesson_plan_path);
    if (!url) {
      setError("Could not open the lesson plan.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  /**
   * Detaches the file from the form.
   *
   * The object is deleted ONLY if it was uploaded during this dialog session —
   * nothing references it, so it is a true orphan. A file that was already
   * saved on the schedule is left in the bucket: the row still points at it
   * until the form is submitted, and deleting here would leave a dangling
   * reference the moment the user cancels instead of saving.
   */
  const removeLessonPlan = async () => {
    const path = values.lesson_plan_path;
    setValues((prev) => ({ ...prev, lesson_plan_path: "", lesson_plan_name: "" }));
    if (path && sessionUploads.includes(path)) {
      setSessionUploads((prev) => prev.filter((p) => p !== path));
      await supabase.storage.from(SUPERVISION_BUCKET).remove([path]);
    }
  };

  const toggleObserver = (id: string) => {
    setValues((prev) => {
      if (prev.observer_ids.includes(id)) {
        return {
          ...prev,
          observer_ids: prev.observer_ids.filter((x) => x !== id),
        };
      }
      if (prev.observer_ids.length >= MAX_OBSERVERS_PER_OBSERVATION) return prev;
      return { ...prev, observer_ids: [...prev.observer_ids, id] };
    });
  };

  const handleSubmit = async () => {
    if (!values.teacher_id) {
      setError("Select the teacher to be observed.");
      return;
    }
    if (!values.observation_at) {
      setError("Set the date and time of the actual observation.");
      return;
    }
    if (
      values.observation_end_at &&
      new Date(values.observation_end_at) <= new Date(values.observation_at)
    ) {
      setError("The observation must end after it starts.");
      return;
    }
    setError(null);
    await onSubmit(values);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm: prefix is required — DialogContent bakes in `sm:max-w-lg`, and
          tailwind-merge will not dedupe an unprefixed `max-w-*` against it, so
          the dialog would stay pinned at 512px on every screen above mobile. */}
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Edit observation schedule" : "Suggest observation schedule"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Section title="Teacher" icon={GraduationCap}>
            <Field label="Name of teacher" controlClassName="sm:max-w-md">
              {lockedTeacher ? (
                <Input value={lockedTeacher.name} disabled />
              ) : (
                <Select value={values.teacher_id} onValueChange={onTeacherChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select teacher" />
                  </SelectTrigger>
                  <SelectContent>
                    {staff.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                        {s.position ? ` — ${s.position}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>

            <Field
              label="Position"
              htmlFor="sched-position"
              controlClassName="sm:max-w-xs"
            >
              <Input
                id="sched-position"
                value={values.teacher_position}
                onChange={(e) => set("teacher_position", e.target.value)}
                placeholder="e.g. Teacher III"
              />
            </Field>

            <Field
              label="Career stage"
              description={`${
                stageSuggestion
                  ? "Suggested from the position — confirm it."
                  : "Could not be determined from the position — set it explicitly."
              } Observers rate on a ${stage.minRating}–${stage.maxRating} scale, and “Not Observed” scores ${stage.notObserved}.`}
            >
              <Select
                value={values.career_stage}
                onValueChange={(v) => set("career_stage", v as CareerStage)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CAREER_STAGE_ORDER.map((key) => (
                    <SelectItem key={key} value={key}>
                      {careerStageLabel(key)} · levels{" "}
                      {CAREER_STAGES[key].minRating}–{CAREER_STAGES[key].maxRating}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="Supervision" icon={Target}>
            <Field label="Type of supervision" controlClassName="sm:max-w-xs">
              <Select
                value={values.supervision_type}
                onValueChange={(v) => set("supervision_type", v as SupervisionType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SUPERVISION_TYPE_LABELS) as SupervisionType[]).map(
                    (key) => (
                      <SelectItem key={key} value={key}>
                        {SUPERVISION_TYPE_LABELS[key]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Term" controlClassName="sm:max-w-xs">
              <Select
                value={String(values.term)}
                onValueChange={(v) => set("term", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPERVISION_TERMS.map((t) => (
                    <SelectItem key={t.value} value={String(t.value)}>
                      {t.label} ({t.months})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Observation" controlClassName="sm:max-w-xs">
              <Select
                value={String(values.observation_round)}
                onValueChange={(v) => set("observation_round", Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1st observation</SelectItem>
                  <SelectItem value="2">2nd observation</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="Quarter" controlClassName="sm:max-w-[10rem]">
              <Select
                value={values.quarter != null ? String(values.quarter) : "none"}
                onValueChange={(v) => set("quarter", v === "none" ? null : Number(v))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not specified</SelectItem>
                  {[1, 2, 3, 4].map((q) => (
                    <SelectItem key={q} value={String(q)}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section title="Class & schedule" icon={CalendarClock}>
            <Field
              label="Grade and section"
              htmlFor="sched-class"
              description="Printed on the COT as “Subject & grade level taught”."
            >
              <Input
                id="sched-class"
                value={values.class_label}
                onChange={(e) => set("class_label", e.target.value)}
                placeholder="e.g. Mathematics — Grade 5 Sampaguita"
              />
            </Field>

            <Field
              label="Pre-conference"
              htmlFor="sched-pre"
              controlClassName="sm:max-w-xs"
            >
              <Input
                id="sched-pre"
                type="datetime-local"
                value={values.pre_conference_at}
                onChange={(e) => set("pre_conference_at", e.target.value)}
              />
            </Field>

            <Field
              label="Actual observation"
              htmlFor="sched-obs"
              controlClassName="sm:max-w-xs"
            >
              <Input
                id="sched-obs"
                type="datetime-local"
                value={values.observation_at}
                onChange={(e) => set("observation_at", e.target.value)}
              />
            </Field>

            <Field
              label="Ends"
              htmlFor="sched-end"
              controlClassName="sm:max-w-xs"
              description="Optional — defaults to one hour on the calendar invite."
            >
              <Input
                id="sched-end"
                type="datetime-local"
                value={values.observation_end_at}
                onChange={(e) => set("observation_end_at", e.target.value)}
              />
            </Field>
          </Section>

          <Section title="Focus" icon={Paperclip}>
            <Field
              label="Focus KRA/s"
              description={
                values.focus_kra.length === 0
                  ? "Optional — tick every KRA the observation focuses on."
                  : undefined
              }
            >
              <div className="grid gap-2 rounded-md border p-3">
                {RPMS_KRAS.map((k) => (
                  <label
                    key={k.key}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={values.focus_kra.includes(k.label)}
                      onChange={() => toggleKra(k.label)}
                    />
                    <span>{k.label}</span>
                  </label>
                ))}
              </div>
            </Field>

            <Field
              label="Focus indicator/s"
              description={`The COT indicator set for S.Y. ${schoolYear}. Ticking one also ticks the KRA it belongs to.`}
            >
              <div className="grid gap-2 rounded-md border p-3">
                {indicators.map((ind) => (
                  <label
                    key={ind.code}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={values.focus_indicator.includes(ind.code)}
                      onChange={() => toggleIndicator(ind.code)}
                    />
                    <span>
                      <span className="font-medium">{ind.code}</span> — {ind.text}
                    </span>
                  </label>
                ))}
              </div>
            </Field>

            <Field
              label="ILAW lesson plan"
              description="PDF, Word, PowerPoint or an image, up to 15 MB. Anyone given the file's link can open it, so do not attach anything confidential."
            >
              {values.lesson_plan_path ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {values.lesson_plan_name || "Attached lesson plan"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={openLessonPlan}
                  >
                    View
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={removeLessonPlan}
                  >
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ) : (
                <Input
                  id="sched-plan"
                  type="file"
                  accept={LESSON_PLAN_ACCEPT}
                  disabled={uploading}
                  onChange={(e) => uploadLessonPlan(e.target.files?.[0] ?? null)}
                  className="cursor-pointer file:mr-3 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-sm"
                />
              )}
              {uploading && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading…
                </p>
              )}
            </Field>
          </Section>

          {canAssignObservers && (
            <Section
              title="Observers"
              icon={Users}
              description={
                lockedTeacher
                  ? `Up to ${MAX_OBSERVERS_PER_OBSERVATION}. Your preference — the School Head confirms it when approving.`
                  : `Up to ${MAX_OBSERVERS_PER_OBSERVATION}. The observer need not be the School Head.`
              }
            >
              <Field
                label={lockedTeacher ? "Preferred observer/s" : "Assigned observer/s"}
                description={
                  values.observer_ids.length > 1
                    ? "With more than one observer, an Inter-Observer Agreement form (Annex E-3) is required to record the final consensus rating."
                    : undefined
                }
              >
                {observersLoading ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading designated observers…
                  </p>
                ) : observerPool.length === 0 ? (
                  <div className="space-y-2 rounded-md border border-dashed p-3">
                    <p className="text-sm text-muted-foreground">
                      Nobody is designated as an observer for S.Y. {schoolYear}{" "}
                      yet, so there is no one to choose.
                    </p>
                    {/* Names the scope actually queried: a designation that
                        exists under a different school or school year is
                        otherwise indistinguishable from none at all. */}
                    <p className="text-xs text-muted-foreground">
                      Looked for designations in school{" "}
                      <code>#{schoolId ?? "—"}</code> for S.Y.{" "}
                      <code>{schoolYear}</code>.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {/* The Observers page is School Head / admin only, so a
                          teacher gets an access-denied page from this button —
                          show them who to ask instead. */}
                      {canDesignateObservers && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            window.open(
                              "/supervision/observers",
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                        >
                          <UserCheck className="mr-2 h-4 w-4" />
                          Designate observers
                          <ExternalLink className="ml-2 h-3 w-3" />
                        </Button>
                      )}
                      {onObserversChanged && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={onObserversChanged}
                        >
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Refresh list
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {canDesignateObservers
                        ? "Opens in a new tab so you don’t lose what you have entered here. Designate the staff who will observe, then come back and hit Refresh."
                        : "Ask your School Head to designate observers for this school year. You can still submit this schedule without one — the School Head assigns the observer when approving."}
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                    {observerPool.map((o) => {
                      const checked = values.observer_ids.includes(o.id);
                      return (
                        <label
                          key={o.id}
                          className="flex cursor-pointer items-start gap-2 text-sm"
                        >
                          <Checkbox
                            className="mt-0.5"
                            checked={checked}
                            onChange={() => toggleObserver(o.id)}
                            disabled={
                              !checked &&
                              values.observer_ids.length >=
                                MAX_OBSERVERS_PER_OBSERVATION
                            }
                          />
                          <span>
                            {o.name}
                            {o.position ? (
                              <span className="text-muted-foreground">
                                {" "}
                                — {o.position}
                              </span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </Field>
            </Section>
          )}

          <Section title="Notes" icon={StickyNote}>
            <Field label="Notes" htmlFor="sched-notes">
              <Textarea
                id="sched-notes"
                rows={3}
                value={values.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="Anything the observer should know beforehand"
              />
            </Field>
          </Section>

          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {existing ? "Save changes" : "Submit for approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
