/**
 * Shared formatting and calendar helpers for the Instructional Supervision
 * module — used by both the School Head board and the teacher's own view.
 */
import {
  CAREER_STAGES,
  indicatorLabels,
  parseFocusList,
  SUPERVISION_TYPE_LABELS,
  termLabel,
  type CareerStage,
} from "@/lib/constants/supervision";
import { supabase } from "@/lib/supabase/client";
import type { CalendarEvent } from "@/lib/utils/calendar";
import type { SupervisionSchedule } from "@/types";

/**
 * ILAW lesson plan attachments live under their own prefix of the shared
 * `school-management` bucket, alongside crla-materials / philiri-materials
 * (migration 122).
 *
 * That bucket is PUBLIC: an object URL resolves without authentication. The
 * uuid in the path keeps URLs unguessable, but this is obscurity, not access
 * control — see the privacy note in migration 122.
 */
export const SUPERVISION_BUCKET = "school-management";
export const LESSON_PLAN_PREFIX = "supervision-lesson-plans";

/** What the lesson plan file picker accepts. */
export const LESSON_PLAN_ACCEPT =
  ".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png";

/** 15 MB — a lesson plan with images, comfortably. */
export const LESSON_PLAN_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Object path for a lesson plan upload:
 * `supervision-lesson-plans/<school>/<school year>/<uuid>-<name>`.
 *
 * The leading prefix is load-bearing, not cosmetic: migration 122's write
 * policies match on `split_part(name, '/', 1)`, so an upload outside this
 * prefix is rejected by RLS.
 *
 * The uuid lets a teacher attach the plan BEFORE the schedule row exists (the
 * modal uploads on pick, not on submit) and keeps two teachers who both upload
 * "ILAW.docx" from colliding. The filename is sanitised because Supabase
 * storage keys reject spaces and most punctuation.
 */
export function lessonPlanPath(
  schoolId: string | number,
  schoolYear: string,
  filename: string,
): string {
  const safe = filename
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-80);
  return `${LESSON_PLAN_PREFIX}/${schoolId}/${schoolYear}/${crypto.randomUUID()}-${safe || "lesson-plan"}`;
}

/**
 * A short-lived signed URL for an attachment.
 *
 * The bucket is currently public, so a plain public URL would also resolve;
 * signing anyway costs one round trip and means nothing here breaks if the
 * bucket is ever made private.
 */
export async function lessonPlanSignedUrl(
  path: string,
  expiresInSeconds = 300,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(SUPERVISION_BUCKET)
    .createSignedUrl(path, expiresInSeconds);
  return error ? null : (data?.signedUrl ?? null);
}

/** "Jul 13, 2026, 8:20 AM" — the format used everywhere a slot is displayed. */
export function formatSlot(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Date only, e.g. "Jul 13, 2026". */
export function formatSlotDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Time only, e.g. "8:20 AM" — what the COT time fields print. */
export function formatSlotTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * A `<input type="date">` value for a timestamp, in LOCAL time.
 *
 * Not `iso.slice(0, 10)`: a 7:00 a.m. Manila observation is stored as the
 * previous day in UTC, so slicing the ISO string would date the COT form a day
 * early for every observation before 8:00 a.m.
 */
export function toDateInputValue(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A `datetime-local` input value for an existing timestamp.
 *
 * Built from the LOCAL clock parts rather than `toISOString().slice(0,16)`,
 * which would silently shift the shown time by the UTC offset — an 8:20 a.m.
 * observation in Manila would come back as 12:20 a.m.
 */
export function toDatetimeLocal(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Inverse of `toDatetimeLocal`: local input value → ISO timestamp, or null. */
export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export interface ScheduleEventContext {
  teacherName: string;
  observerNames: string[];
  schoolName?: string | null;
}

/**
 * The calendar event for an approved observation.
 *
 * The UID is derived from the schedule id so re-importing the .ics after a
 * reschedule updates the existing entry instead of leaving a stale duplicate.
 * When no end time was set, `buildIcs` / `googleCalendarUrl` default to one
 * hour, which matches the one-period slots the plans use.
 */
export function scheduleToCalendarEvent(
  schedule: SupervisionSchedule,
  context: ScheduleEventContext,
): CalendarEvent {
  const stage = CAREER_STAGES[schedule.career_stage as CareerStage];
  const focusKras = parseFocusList(schedule.focus_kra);
  const focusIndicators = indicatorLabels(schedule.focus_indicator);
  const lines = [
    `Teacher observed: ${context.teacherName}`,
    `Type: ${SUPERVISION_TYPE_LABELS[schedule.supervision_type]}`,
    `${termLabel(schedule.term)} · Observation ${schedule.observation_round}`,
    schedule.class_label ? `Class: ${schedule.class_label}` : "",
    context.observerNames.length
      ? `Observer/s: ${context.observerNames.join(", ")}`
      : "",
    focusKras.length
      ? `Focus KRA${focusKras.length > 1 ? "s" : ""}: ${focusKras.join("; ")}`
      : "",
    focusIndicators.length
      ? `Focus indicator${focusIndicators.length > 1 ? "s" : ""}: ${focusIndicators.join("; ")}`
      : "",
    stage ? `COT scale: ${stage.minRating}–${stage.maxRating} (${stage.formLabel})` : "",
    schedule.pre_conference_at
      ? `Pre-conference: ${formatSlot(schedule.pre_conference_at)}`
      : "",
    schedule.notes ? `Notes: ${schedule.notes}` : "",
  ].filter(Boolean);

  return {
    uid: `supervision-${schedule.id}@sms.deped`,
    title: `Classroom Observation — ${context.teacherName}`,
    description: lines.join("\n"),
    location: context.schoolName ?? null,
    start: new Date(schedule.observation_at),
    end: schedule.observation_end_at ? new Date(schedule.observation_end_at) : null,
  };
}

/** The pre-conference as its own calendar event, when one was scheduled. */
export function preConferenceEvent(
  schedule: SupervisionSchedule,
  context: ScheduleEventContext,
): CalendarEvent | null {
  if (!schedule.pre_conference_at) return null;
  return {
    uid: `supervision-pre-${schedule.id}@sms.deped`,
    title: `Pre-Observation Conference — ${context.teacherName}`,
    description: [
      `Ahead of the classroom observation on ${formatSlot(schedule.observation_at)}.`,
      context.observerNames.length
        ? `Observer/s: ${context.observerNames.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    location: context.schoolName ?? null,
    start: new Date(schedule.pre_conference_at),
    end: null,
  };
}
