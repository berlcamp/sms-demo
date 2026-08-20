"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CAREER_STAGES,
  indicatorText,
  parseFocusList,
  needsAgreementForm,
  SCHEDULE_STATUS_LABELS,
  SUPERVISION_TYPE_LABELS,
  termLabel,
  type CareerStage,
} from "@/lib/constants/supervision";
import { generateSupervisoryPlanSlip } from "@/lib/pdf/generateSupervisoryPlan";
import { supabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { downloadIcs, googleCalendarUrl } from "@/lib/utils/calendar";
import {
  formatSlot,
  formatSlotDate,
  formatSlotTime,
  lessonPlanSignedUrl,
  preConferenceEvent,
  scheduleToCalendarEvent,
} from "@/lib/utils/supervision";
import type { SupervisionScheduleStatusValue } from "@/types";
import {
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  FileSignature,
  MoreVertical,
  Paperclip,
  Pencil,
  XCircle,
} from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import type { ScheduleBundle, SupervisionStaff } from "../useSupervision";

const STATUS_STYLES: Record<SupervisionScheduleStatusValue, string> = {
  proposed: "bg-amber-100 text-amber-900 hover:bg-amber-100",
  approved: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
  rejected: "bg-red-100 text-red-900 hover:bg-red-100",
  completed: "bg-blue-100 text-blue-900 hover:bg-blue-100",
  cancelled: "bg-muted text-muted-foreground hover:bg-muted",
};

/**
 * How many COT forms this slot still owes.
 *
 * A rated observation expects one Annex E-2 per observer, plus an E-3 when
 * there is more than one (with a single observer the E-2 *is* the final rating
 * sheet). A non-rated, fleeting observation expects notes only.
 *
 * Returns null when nothing can be expected yet — no observer is assigned — so
 * the column can say "no observer" rather than a misleading "0 of 0".
 */
function cotProgress(bundle: ScheduleBundle): { done: number; total: number } | null {
  const observerCount = bundle.observers.length;
  if (observerCount === 0) return null;

  const submitted = bundle.observations.filter((o) => o.status === "submitted");
  if (bundle.schedule.supervision_type === "non_rated") {
    return {
      done: submitted.filter((o) => o.kind === "notes").length,
      total: observerCount,
    };
  }
  return {
    done: submitted.filter((o) => o.kind === "rating" || o.kind === "agreement").length,
    total: observerCount + (needsAgreementForm(observerCount) ? 1 : 0),
  };
}

interface ScheduleTableProps {
  bundles: ScheduleBundle[];
  staffById: Map<string, SupervisionStaff>;
  schoolName?: string | null;
  schoolAddress?: string | null;
  principalName?: string | null;
  principalTitle?: string | null;
  /** Approve / reject controls — School Head and admin only. */
  canDecide?: boolean;
  /** Id of the row whose approve/reject is in flight. */
  decidingId?: string | null;
  onEdit?: (bundle: ScheduleBundle) => void;
  onDecide?: (bundle: ScheduleBundle, status: "approved" | "rejected") => void;
  onExported?: () => void;
  /** The COT panel for an expanded row. */
  renderDetail: (bundle: ScheduleBundle) => ReactNode;
}

export function ScheduleTable({
  bundles,
  staffById,
  schoolName,
  schoolAddress,
  principalName,
  principalTitle,
  canDecide,
  decidingId,
  onEdit,
  onDecide,
  onExported,
  renderDetail,
}: ScheduleTableProps) {
  // Several rows can be open at once: comparing two teachers' filed forms is a
  // normal thing to want, and an accordion would fight that.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="app__table_container">
      <div className="app__table_wrapper">
        <table className="app__table">
          <thead className="app__table_thead">
            {/* Six columns, deliberately: the wrapper allows horizontal scroll
                and we do not want it to have to. Everything else — focus
                indicator, pre-conference, lesson plan, notes — lives in the
                expanded row, where it has room to be read rather than
                truncated. */}
            <tr>
              <th className="app__table_th">Teacher</th>
              <th className="app__table_th w-[8.5rem]">Observation</th>
              <th className="app__table_th">Term &amp; class</th>
              <th className="app__table_th">Observer/s</th>
              <th className="app__table_th w-[7.5rem]">Status</th>
              <th className="app__table_th_right w-[9.5rem]">Actions</th>
            </tr>
          </thead>
          <tbody className="app__table_tbody">
            {bundles.map((bundle) => (
              <ScheduleRow
                key={String(bundle.schedule.id)}
                bundle={bundle}
                staffById={staffById}
                schoolName={schoolName}
                schoolAddress={schoolAddress}
                principalName={principalName}
                principalTitle={principalTitle}
                canDecide={canDecide}
                deciding={decidingId === String(bundle.schedule.id)}
                open={expanded.has(String(bundle.schedule.id))}
                onToggle={() => toggle(String(bundle.schedule.id))}
                onEdit={onEdit}
                onDecide={onDecide}
                onExported={onExported}
                renderDetail={renderDetail}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ScheduleRowProps
  extends Omit<ScheduleTableProps, "bundles" | "decidingId"> {
  bundle: ScheduleBundle;
  deciding: boolean;
  open: boolean;
  onToggle: () => void;
}

function ScheduleRow({
  bundle,
  staffById,
  schoolName,
  schoolAddress,
  principalName,
  principalTitle,
  canDecide,
  deciding,
  open,
  onToggle,
  onEdit,
  onDecide,
  onExported,
  renderDetail,
}: ScheduleRowProps) {
  const { schedule, observers } = bundle;
  const teacher = staffById.get(String(schedule.teacher_id));
  const teacherName = teacher?.name ?? "—";
  const observerNames = observers
    .map((o) => staffById.get(String(o.user_id))?.name ?? "")
    .filter(Boolean);
  const stage = CAREER_STAGES[schedule.career_stage as CareerStage];
  const focusKras = parseFocusList(schedule.focus_kra);
  const focusIndicators = parseFocusList(schedule.focus_indicator);
  const isApproved =
    schedule.status === "approved" || schedule.status === "completed";
  const progress = cotProgress(bundle);

  const eventContext = { teacherName, observerNames, schoolName };

  /** Advisory only — that someone took the export, not that an event exists. */
  const markExported = async () => {
    const { error } = await supabase
      .from("sms_supervision_schedules")
      .update({ calendar_exported_at: new Date().toISOString() })
      .eq("id", Number(schedule.id));
    if (!error) onExported?.();
  };

  const addToGoogle = () => {
    window.open(
      googleCalendarUrl(scheduleToCalendarEvent(schedule, eventContext)),
      "_blank",
      "noopener,noreferrer",
    );
    markExported();
  };

  const downloadInvite = () => {
    const events = [scheduleToCalendarEvent(schedule, eventContext)];
    const pre = preConferenceEvent(schedule, eventContext);
    if (pre) events.unshift(pre);
    downloadIcs(events, `observation-${teacherName.replace(/\s+/g, "-")}`);
    toast.success(
      pre
        ? "Downloaded — includes the pre-conference and the observation."
        : "Downloaded. Import the .ics into Google Calendar, Outlook or Apple Calendar.",
    );
    markExported();
  };

  const openLessonPlan = async () => {
    if (!schedule.lesson_plan_path) return;
    const url = await lessonPlanSignedUrl(schedule.lesson_plan_path);
    if (!url) {
      toast.error("Could not open the lesson plan.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const printSlip = () => {
    generateSupervisoryPlanSlip({
      schoolName,
      schoolAddress,
      schoolYear: schedule.school_year,
      teacherName,
      position: schedule.teacher_position,
      careerStage: schedule.career_stage as CareerStage,
      supervisionType: schedule.supervision_type,
      term: schedule.term,
      classLabel: schedule.class_label,
      preConference: schedule.pre_conference_at
        ? formatSlot(schedule.pre_conference_at)
        : null,
      observation: formatSlot(schedule.observation_at),
      focusKra: schedule.focus_kra,
      focusIndicator: schedule.focus_indicator,
      observers: observerNames,
      preparedByName: principalName,
      preparedByPosition: principalTitle,
    });
  };

  return (
    <Fragment>
      <tr className={cn("app__table_tr", open && "bg-muted/30")}>
        {/* Teacher — the chevron lives here rather than in a column of its
            own, so the expander costs no width. */}
        <td className="app__table_td">
          <div className="flex min-w-0 items-start gap-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1.5 h-6 w-6 shrink-0 text-muted-foreground"
              onClick={onToggle}
              aria-expanded={open}
              aria-label={open ? "Hide COT forms" : "Show COT forms"}
            >
              {open ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </Button>
            <div className="app__table_cell_text min-w-0">
              <button
                type="button"
                onClick={onToggle}
                className="app__table_cell_title cursor-pointer truncate text-left text-primary hover:underline"
              >
                {teacherName}
              </button>
              <div className="app__table_cell_subtitle truncate">
                {schedule.teacher_position || stage?.positionLabel || "—"}
                {stage && ` · COT ${stage.minRating}–${stage.maxRating}`}
              </div>
            </div>
          </div>
        </td>

        {/* Observation date and time. The pre-conference is in the detail. */}
        <td className="app__table_td">
          <div className="app__table_cell_text">
            <div className="app__table_cell_title whitespace-nowrap">
              {formatSlotDate(schedule.observation_at) || "—"}
            </div>
            <div className="app__table_cell_subtitle whitespace-nowrap">
              {formatSlotTime(schedule.observation_at) || "—"}
            </div>
          </div>
        </td>

        {/* Term, round and class, which are read together anyway. */}
        <td className="app__table_td">
          <div className="app__table_cell_text min-w-0">
            <div className="app__table_cell_title whitespace-nowrap">
              {termLabel(schedule.term)} ·{" "}
              {schedule.observation_round === 2 ? "2nd" : "1st"}
              {schedule.supervision_type === "non_rated" && (
                <span className="ml-1 font-normal text-muted-foreground">
                  · {SUPERVISION_TYPE_LABELS.non_rated}
                </span>
              )}
            </div>
            <div className="app__table_cell_subtitle truncate">
              {schedule.class_label || "—"}
            </div>
          </div>
        </td>

        {/* Observer/s, with COT progress underneath — the two are read as one
            question: who is observing, and have they filed yet. */}
        <td className="app__table_td">
          <div className="app__table_cell_text min-w-0">
            <div className="app__table_cell_title truncate" title={observerNames.join(", ")}>
              {observerNames.length === 0
                ? "—"
                : observerNames.length === 1
                  ? observerNames[0]
                  : `${observerNames[0]} +${observerNames.length - 1}`}
            </div>
            <div className="app__table_cell_subtitle whitespace-nowrap">
              {progress ? (
                <>
                  <span
                    className={cn(
                      "mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                      progress.done === 0
                        ? "bg-muted-foreground/40"
                        : progress.done >= progress.total
                          ? "bg-emerald-500"
                          : "bg-amber-400",
                    )}
                  />
                  {progress.done} of {progress.total} filed
                </>
              ) : (
                "Not yet assigned"
              )}
            </div>
          </div>
        </td>

        {/* Status */}
        <td className="app__table_td">
          <Badge
            className={cn("w-fit", STATUS_STYLES[schedule.status])}
            // The full reason is in the expanded row; this makes it reachable
            // without opening one.
            title={schedule.decision_notes ?? undefined}
          >
            {SCHEDULE_STATUS_LABELS[schedule.status]}
          </Badge>
        </td>

        {/* Actions */}
        <td className="app__table_td_actions">
          <div className="app__table_action_container gap-1">
            {canDecide && schedule.status === "proposed" && onDecide && (
              <Button
                size="sm"
                disabled={deciding}
                onClick={() => onDecide(bundle, "approved")}
              >
                <CheckCircle2 className="mr-1.5 h-4 w-4" />
                Approve
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                >
                  <MoreVertical className="h-4 w-4" />
                  <span className="sr-only">Open menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {canDecide && schedule.status === "proposed" && onDecide && (
                  <>
                    <DropdownMenuItem
                      disabled={deciding}
                      onClick={() => onDecide(bundle, "rejected")}
                      className="cursor-pointer text-destructive focus:text-destructive"
                    >
                      <XCircle className="mr-2 h-4 w-4" />
                      Reject
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {onEdit && (
                  <DropdownMenuItem
                    onClick={() => onEdit(bundle)}
                    className="cursor-pointer"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit schedule
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={printSlip} className="cursor-pointer">
                  <FileSignature className="mr-2 h-4 w-4" />
                  Print slip
                </DropdownMenuItem>
                {schedule.lesson_plan_path && (
                  <DropdownMenuItem
                    onClick={openLessonPlan}
                    className="cursor-pointer"
                  >
                    <Paperclip className="mr-2 h-4 w-4" />
                    Open lesson plan
                  </DropdownMenuItem>
                )}
                {/* Calendar actions exist only once a slot is approved — an
                    unapproved date is not something to put in a calendar. */}
                {isApproved && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={addToGoogle}
                      className="cursor-pointer"
                    >
                      <CalendarPlus className="mr-2 h-4 w-4" />
                      Add to Google Calendar
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={downloadInvite}
                      className="cursor-pointer"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download invite (.ics)
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </td>
      </tr>

      {open && (
        <tr className="bg-muted/20">
          <td colSpan={6} className="px-6 pb-4 pt-0">
            <div className="space-y-3 rounded-md border bg-background p-4">
              {/* The long-form fields that do not earn a column of their own. */}
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                <Detail label="Pre-conference">
                  {schedule.pre_conference_at
                    ? formatSlot(schedule.pre_conference_at)
                    : "—"}
                </Detail>
                <Detail label="Observation">
                  {formatSlot(schedule.observation_at)}
                </Detail>
                <Detail label="Observer/s">
                  {observerNames.length
                    ? observerNames.join(", ")
                    : "Not yet assigned"}
                </Detail>
                <Detail label="Career stage">
                  {stage
                    ? `${stage.formLabel} · levels ${stage.minRating}–${stage.maxRating}, “Not Observed” scores ${stage.notObserved}`
                    : schedule.career_stage}
                </Detail>
                {focusKras.length > 0 && (
                  <Detail
                    label={`Focus KRA${focusKras.length > 1 ? "s" : ""}`}
                    wide
                  >
                    {focusKras.join("; ")}
                  </Detail>
                )}
                {focusIndicators.length > 0 && (
                  <Detail
                    label={`Focus indicator${focusIndicators.length > 1 ? "s" : ""}`}
                    wide
                  >
                    {focusIndicators.map((code) => (
                      <span key={code} className="block">
                        {code} — {indicatorText(code)}
                      </span>
                    ))}
                  </Detail>
                )}
                {schedule.lesson_plan_path && (
                  <Detail label="ILAW lesson plan" wide>
                    <button
                      type="button"
                      onClick={openLessonPlan}
                      className="inline-flex items-center gap-1 text-primary underline"
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      {schedule.lesson_plan_name || "Open attachment"}
                    </button>
                  </Detail>
                )}
                {schedule.notes && (
                  <Detail label="Notes" wide>
                    {schedule.notes}
                  </Detail>
                )}
                {/* No longer a column, so it has to surface here — a rejection
                    reason the School Head typed must stay readable. */}
                {schedule.decision_notes && (
                  <Detail label="Decision" wide>
                    {schedule.decision_notes}
                  </Detail>
                )}
                {schedule.calendar_exported_at && (
                  <Detail label="Calendar" wide>
                    Last exported{" "}
                    {formatSlotDate(schedule.calendar_exported_at)} — advisory
                    only; each participant adds the event to their own calendar.
                  </Detail>
                )}
              </dl>

              <div className="border-t pt-3">{renderDetail(bundle)}</div>
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

function Detail({
  label,
  wide,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="inline font-medium">{label}: </dt>
      <dd className="inline text-muted-foreground">{children}</dd>
    </div>
  );
}
