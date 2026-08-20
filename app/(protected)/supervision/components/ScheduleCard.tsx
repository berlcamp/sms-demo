"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CAREER_STAGES,
  indicatorText,
  parseFocusList,
  SCHEDULE_STATUS_LABELS,
  SUPERVISION_TYPE_LABELS,
  termLabel,
  type CareerStage,
} from "@/lib/constants/supervision";
import { downloadIcs, googleCalendarUrl } from "@/lib/utils/calendar";
import { generateSupervisoryPlanSlip } from "@/lib/pdf/generateSupervisoryPlan";
import { supabase } from "@/lib/supabase/client";
import {
  formatSlot,
  formatSlotDate,
  lessonPlanSignedUrl,
  preConferenceEvent,
  scheduleToCalendarEvent,
} from "@/lib/utils/supervision";
import { cn } from "@/lib/utils";
import type { SupervisionScheduleStatusValue } from "@/types";
import {
  CalendarPlus,
  CheckCircle2,
  Download,
  FileSignature,
  Paperclip,
  Pencil,
  XCircle,
} from "lucide-react";
import type { ReactNode } from "react";
import toast from "react-hot-toast";
import type { ScheduleBundle, SupervisionStaff } from "../useSupervision";

const STATUS_STYLES: Record<SupervisionScheduleStatusValue, string> = {
  proposed: "bg-amber-100 text-amber-900 hover:bg-amber-100",
  approved: "bg-emerald-100 text-emerald-900 hover:bg-emerald-100",
  rejected: "bg-red-100 text-red-900 hover:bg-red-100",
  completed: "bg-blue-100 text-blue-900 hover:bg-blue-100",
  cancelled: "bg-muted text-muted-foreground hover:bg-muted",
};

interface ScheduleCardProps {
  bundle: ScheduleBundle;
  staffById: Map<string, SupervisionStaff>;
  schoolName?: string | null;
  schoolAddress?: string | null;
  principalName?: string | null;
  principalTitle?: string | null;
  /** Approve / reject controls — School Head and admin only. */
  canDecide?: boolean;
  /** An approve/reject is in flight for this slot — block a second click. */
  deciding?: boolean;
  onEdit?: () => void;
  onDecide?: (status: "approved" | "rejected") => void;
  onExported?: () => void;
  children?: ReactNode;
}

export function ScheduleCard({
  bundle,
  staffById,
  schoolName,
  schoolAddress,
  principalName,
  principalTitle,
  canDecide,
  deciding,
  onEdit,
  onDecide,
  onExported,
  children,
}: ScheduleCardProps) {
  const { schedule, observers } = bundle;
  const teacher = staffById.get(String(schedule.teacher_id));
  const teacherName = teacher?.name ?? "—";
  const observerNames = observers
    .map((o) => staffById.get(String(o.user_id))?.name ?? "")
    .filter(Boolean);
  const stage = CAREER_STAGES[schedule.career_stage as CareerStage];
  const focusKras = parseFocusList(schedule.focus_kra);
  const focusIndicators = parseFocusList(schedule.focus_indicator);
  const isApproved = schedule.status === "approved" || schedule.status === "completed";

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
    const url = googleCalendarUrl(
      scheduleToCalendarEvent(schedule, eventContext),
    );
    window.open(url, "_blank", "noopener,noreferrer");
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
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{teacherName}</h3>
            <Badge className={cn(STATUS_STYLES[schedule.status])}>
              {SCHEDULE_STATUS_LABELS[schedule.status]}
            </Badge>
            <Badge variant="outline">
              {SUPERVISION_TYPE_LABELS[schedule.supervision_type]}
            </Badge>
            <Badge variant="outline">{termLabel(schedule.term)}</Badge>
            <Badge variant="outline">
              {schedule.observation_round === 2 ? "2nd" : "1st"} observation
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {schedule.teacher_position || stage?.positionLabel} ·{" "}
            {stage ? `COT scale ${stage.minRating}–${stage.maxRating}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={printSlip}>
            <FileSignature className="mr-2 h-4 w-4" />
            Print slip
          </Button>
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div>
          <dt className="inline font-medium">Class: </dt>
          <dd className="inline text-muted-foreground">
            {schedule.class_label || "—"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Observer/s: </dt>
          <dd className="inline text-muted-foreground">
            {observerNames.length ? observerNames.join(", ") : "Not yet assigned"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Pre-conference: </dt>
          <dd className="inline text-muted-foreground">
            {schedule.pre_conference_at
              ? formatSlot(schedule.pre_conference_at)
              : "—"}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Observation: </dt>
          <dd className="inline text-muted-foreground">
            {formatSlot(schedule.observation_at)}
          </dd>
        </div>
        {focusKras.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="inline font-medium">
              Focus KRA{focusKras.length > 1 ? "s" : ""}:{" "}
            </dt>
            <dd className="inline text-muted-foreground">
              {focusKras.join("; ")}
            </dd>
          </div>
        )}
        {focusIndicators.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="inline font-medium">
              Focus indicator{focusIndicators.length > 1 ? "s" : ""}:{" "}
            </dt>
            <dd className="inline text-muted-foreground">
              {focusIndicators.map((code) => (
                <span key={code} className="block">
                  {code} — {indicatorText(code)}
                </span>
              ))}
            </dd>
          </div>
        )}
        {schedule.lesson_plan_path && (
          <div className="sm:col-span-2">
            <dt className="inline font-medium">ILAW lesson plan: </dt>
            <dd className="inline">
              {/* Mints a signed URL on click. The bucket is public (migration
                  122), so this is for forward-compatibility with a private
                  bucket, not access control. */}
              <button
                type="button"
                onClick={openLessonPlan}
                className="inline-flex items-center gap-1 text-primary underline"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {schedule.lesson_plan_name || "Open attachment"}
              </button>
            </dd>
          </div>
        )}
        {schedule.notes && (
          <div className="sm:col-span-2">
            <dt className="inline font-medium">Notes: </dt>
            <dd className="inline text-muted-foreground">{schedule.notes}</dd>
          </div>
        )}
        {schedule.decision_notes && (
          <div className="sm:col-span-2">
            <dt className="inline font-medium">Decision: </dt>
            <dd className="inline text-muted-foreground">
              {schedule.decision_notes}
            </dd>
          </div>
        )}
      </dl>

      {canDecide && schedule.status === "proposed" && onDecide && (
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button size="sm" disabled={deciding} onClick={() => onDecide("approved")}>
            <CheckCircle2 className="mr-2 h-4 w-4" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={deciding}
            onClick={() => onDecide("rejected")}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Reject
          </Button>
        </div>
      )}

      {isApproved && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={addToGoogle}>
              <CalendarPlus className="mr-2 h-4 w-4" />
              Add to Google Calendar
            </Button>
            <Button size="sm" variant="outline" onClick={downloadInvite}>
              <Download className="mr-2 h-4 w-4" />
              Download invite (.ics)
            </Button>
            {schedule.calendar_exported_at && (
              <span className="text-xs text-muted-foreground">
                Last exported {formatSlotDate(schedule.calendar_exported_at)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Each participant adds the event to their own calendar — the link
            opens it pre-filled, the .ics also imports into Outlook and Apple
            Calendar.
          </p>
        </div>
      )}

      {children && <div className="border-t pt-3">{children}</div>}
    </div>
  );
}
