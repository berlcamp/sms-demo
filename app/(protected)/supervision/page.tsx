"use client";

import { TableSkeleton } from "@/components/TableSkeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useStaffModuleAccess } from "@/hooks/useStaffModuleAccess";
import {
  formatFocusList,
  SCHEDULE_STATUS_LABELS,
  SUPERVISION_TERMS,
} from "@/lib/constants/supervision";
import { downloadIcs } from "@/lib/utils/calendar";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { fetchSchoolSettings } from "@/lib/utils/schoolSettings";
import { fromDatetimeLocal, scheduleToCalendarEvent } from "@/lib/utils/supervision";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import type { SupervisionScheduleStatusValue } from "@/types";
import {
  CalendarDays,
  Download,
  Plus,
  Telescope,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ObservationPanel } from "./components/ObservationPanel";
import { ScheduleModal, type ScheduleFormValues } from "./components/ScheduleModal";
import { ScheduleTable } from "./components/ScheduleTable";
import {
  useDesignatedObservers,
  useSupervisionSchedules,
  useSupervisionStaff,
  type ScheduleBundle,
  type SupervisionStaff,
} from "./useSupervision";

type StatusFilter = "all" | SupervisionScheduleStatusValue;

const STATUS_FILTERS: StatusFilter[] = [
  "all",
  "proposed",
  "approved",
  "completed",
  "rejected",
  "cancelled",
];

export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const hasAccess = useStaffModuleAccess();
  const schoolId = user?.school_id ?? null;

  const [schoolYear, setSchoolYear] = useState(getCurrentSchoolYear());
  const [term, setTerm] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const { staff } = useSupervisionStaff(schoolId);
  const {
    observers: designated,
    loading: observersLoading,
    reload: reloadObservers,
  } = useDesignatedObservers(schoolId, schoolYear);
  const { bundles, loading, reload } = useSupervisionSchedules({
    schoolId,
    schoolYear,
    term,
  });

  const [school, setSchool] = useState<{ name: string; address: string } | null>(
    null,
  );
  const [principal, setPrincipal] = useState<{ name: string; title: string }>({
    name: "",
    title: "Principal",
  });

  useEffect(() => {
    let isMounted = true;
    if (schoolId == null) return;
    (async () => {
      const [{ data }, settings] = await Promise.all([
        supabase
          .from("sms_schools")
          .select("name, address")
          .eq("id", Number(schoolId))
          .maybeSingle(),
        fetchSchoolSettings(String(schoolId)),
      ]);
      if (!isMounted) return;
      setSchool({
        name: (data?.name as string) ?? "",
        address: (data?.address as string) ?? "",
      });
      setPrincipal({
        name: settings.principal_name ?? "",
        title: settings.principal_title ?? "Principal",
      });
    })();
    return () => {
      isMounted = false;
    };
  }, [schoolId]);

  const staffById = useMemo(
    () => new Map(staff.map((s) => [s.id, s])),
    [staff],
  );

  /**
   * Only actively designated observers may be assigned to a new slot.
   *
   * A designation whose `sms_users` row is missing from `staff` is shown as
   * unresolved rather than dropped. `staff` is filtered to this school's ACTIVE
   * users, so a designated observer who was later deactivated — or whose
   * school_id no longer matches — would otherwise disappear from this list with
   * no error anywhere, which reads as "I designated them and nothing happened".
   */
  const observerPool = useMemo(
    () =>
      designated
        .filter((o) => o.is_active)
        .map((o): SupervisionStaff => {
          const match = staffById.get(String(o.user_id));
          if (match) return match;
          return {
            id: String(o.user_id),
            name: `Unresolved staff #${o.user_id}`,
            position: "not an active user of this school",
            type: null,
          };
        }),
    [designated, staffById],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleBundle | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Id of the slot whose approve/reject is in flight, to block a double-click. */
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return bundles.filter((b) => {
      if (status !== "all" && b.schedule.status !== status) return false;
      if (!needle) return true;
      const teacher = staffById.get(String(b.schedule.teacher_id))?.name ?? "";
      return `${teacher} ${b.schedule.class_label ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [bundles, status, search, staffById]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of bundles) {
      out[b.schedule.status] = (out[b.schedule.status] ?? 0) + 1;
    }
    return out;
  }, [bundles]);

  const saveSchedule = async (values: ScheduleFormValues) => {
    if (schoolId == null) return;
    setSubmitting(true);
    try {
      const payload = {
        school_id: Number(schoolId),
        school_year: schoolYear,
        term: values.term,
        teacher_id: Number(values.teacher_id),
        teacher_position: values.teacher_position || null,
        career_stage: values.career_stage,
        supervision_type: values.supervision_type,
        observation_round: values.observation_round,
        quarter: values.quarter,
        class_label: values.class_label || null,
        pre_conference_at: fromDatetimeLocal(values.pre_conference_at),
        observation_at: fromDatetimeLocal(values.observation_at),
        observation_end_at: fromDatetimeLocal(values.observation_end_at),
        focus_kra: formatFocusList(values.focus_kra) || null,
        focus_indicator: formatFocusList(values.focus_indicator) || null,
        lesson_plan_path: values.lesson_plan_path || null,
        lesson_plan_name: values.lesson_plan_name || null,
        notes: values.notes || null,
      };

      let scheduleId = editing?.schedule.id ?? null;
      if (scheduleId) {
        // Editing a slot returns it to 'proposed' and clears the old decision:
        // an approved-then-moved observation must be re-approved, not silently
        // keep an approval that referred to a different date.
        const { error } = await supabase
          .from("sms_supervision_schedules")
          .update({
            ...payload,
            status: "proposed",
            decided_by: null,
            decided_at: null,
            decision_notes: null,
          })
          .eq("id", Number(scheduleId));
        if (error) throw new Error(error.message);
      } else {
        const { data, error } = await supabase
          .from("sms_supervision_schedules")
          .insert({
            ...payload,
            status: "proposed",
            proposed_by: user?.system_user_id ?? null,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        scheduleId = String(data.id);
      }

      // Replace the observer assignment wholesale — slots are positional and a
      // partial update would leave gaps in the E-3 signature lines.
      const { error: delErr } = await supabase
        .from("sms_supervision_schedule_observers")
        .delete()
        .eq("schedule_id", Number(scheduleId));
      if (delErr) throw new Error(delErr.message);

      if (values.observer_ids.length > 0) {
        const { error: insErr } = await supabase
          .from("sms_supervision_schedule_observers")
          .insert(
            values.observer_ids.map((id, index) => ({
              schedule_id: Number(scheduleId),
              user_id: Number(id),
              slot: index + 1,
            })),
          );
        if (insErr) throw new Error(insErr.message);
      }

      toast.success(editing ? "Schedule updated." : "Schedule submitted.");
      setModalOpen(false);
      setEditing(null);
      reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save the schedule.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const decide = async (
    bundle: ScheduleBundle,
    next: "approved" | "rejected",
  ) => {
    let notes = "";
    if (next === "rejected") {
      // `prompt` returns null on Cancel/Escape. Coercing that to "" would have
      // rejected the slot anyway, for someone who was backing out.
      const answer = window.prompt("Reason for rejecting this schedule (optional):");
      if (answer === null) return;
      notes = answer;
    }

    if (decidingId) return;
    setDecidingId(String(bundle.schedule.id));
    try {
      // An approval refers to a specific date. If the teacher moved the slot
      // since this board was loaded, editing returned it to `proposed` and
      // bumped `updated_at` — so match on both and decline to decide on a
      // version the School Head never saw.
      const { data, error } = await supabase
        .from("sms_supervision_schedules")
        .update({
          status: next,
          decided_by: user?.system_user_id ?? null,
          decided_at: new Date().toISOString(),
          decision_notes: notes || null,
        })
        .eq("id", Number(bundle.schedule.id))
        .eq("status", bundle.schedule.status)
        .eq("updated_at", bundle.schedule.updated_at)
        .select("id");
      if (error) {
        toast.error(error.message);
        return;
      }
      if (!data || data.length === 0) {
        toast.error(
          "This slot changed since you loaded it. Refreshing — please review the new date.",
        );
        reload();
        return;
      }
      toast.success(next === "approved" ? "Schedule approved." : "Schedule rejected.");
      reload();
    } finally {
      setDecidingId(null);
    }
  };

  /** One .ics holding every approved observation currently in view. */
  const exportAll = () => {
    const approved = filtered.filter(
      (b) => b.schedule.status === "approved" || b.schedule.status === "completed",
    );
    if (approved.length === 0) {
      toast.error("No approved schedules to export.");
      return;
    }
    downloadIcs(
      approved.map((b) =>
        scheduleToCalendarEvent(b.schedule, {
          teacherName: staffById.get(String(b.schedule.teacher_id))?.name ?? "",
          observerNames: b.observers
            .map((o) => staffById.get(String(o.user_id))?.name ?? "")
            .filter(Boolean),
          schoolName: school?.name,
        }),
      ),
      `observation-schedule-${schoolYear}`,
    );
    toast.success(`Exported ${approved.length} observation(s).`);
  };

  if (!hasAccess) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            You do not have access to Instructional Supervision.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Telescope className="h-6 w-6" />
            Instructional Supervision
          </h1>
          <p className="text-sm text-muted-foreground">
            Suggested and approved classroom observations, and the COT forms filed
            against them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/supervision/observers">
              <UserCheck className="mr-2 h-4 w-4" />
              Observers
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/supervision/plan">
              <CalendarDays className="mr-2 h-4 w-4" />
              Supervisory Plan
            </Link>
          </Button>
          <Button variant="outline" onClick={exportAll}>
            <Download className="mr-2 h-4 w-4" />
            Export approved
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            New schedule
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap gap-3 p-4">
          <div className="w-40">
            <Select value={schoolYear} onValueChange={setSchoolYear}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {getSchoolYearOptions().map((sy) => (
                  <SelectItem key={sy} value={sy}>
                    {sy}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-44">
            <Select
              value={term != null ? String(term) : "all"}
              onValueChange={(v) => setTerm(v === "all" ? null : Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All terms</SelectItem>
                {SUPERVISION_TERMS.map((t) => (
                  <SelectItem key={t.value} value={String(t.value)}>
                    {t.label} ({t.months})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-48">
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as StatusFilter)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all"
                      ? `All statuses (${bundles.length})`
                      : `${SCHEDULE_STATUS_LABELS[s]} (${counts[s] ?? 0})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Input
            className="w-64"
            placeholder="Search teacher or class…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </CardContent>
      </Card>

      {/* First-run guidance: without designated observers a schedule can be
          created but nobody can be assigned to it, and nothing else on this
          page surfaces that until you are already inside the dialog. */}
      {observerPool.length === 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="flex flex-wrap items-center gap-3 p-4">
            <UserCheck className="h-5 w-5 shrink-0 text-amber-700" />
            <p className="min-w-0 flex-1 text-sm text-amber-900">
              No observers are designated for S.Y. {schoolYear} yet, so
              observations cannot be assigned to anyone. Designate the staff who
              will observe — it need not be the School Head.
            </p>
            <Button size="sm" variant="outline" asChild>
              <Link href="/supervision/observers">Designate observers</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <TableSkeleton />
      ) : filtered.length === 0 ? (
        <div className="app__empty_state">
          <div className="app__empty_state_icon">
            <Telescope className="mx-auto h-12 w-12 text-muted-foreground" />
          </div>
          <p className="app__empty_state_title">No observation schedules</p>
          <p className="app__empty_state_description">
            {bundles.length === 0
              ? "Nothing has been scheduled for this school year yet."
              : "No schedules match these filters."}
          </p>
        </div>
      ) : (
        <>
          <ScheduleTable
            bundles={filtered}
            staffById={staffById}
            schoolName={school?.name}
            schoolAddress={school?.address}
            principalName={principal.name}
            principalTitle={principal.title}
            canDecide
            decidingId={decidingId}
            onEdit={(bundle) => {
              setEditing(bundle);
              setModalOpen(true);
            }}
            onDecide={(bundle, next) => decide(bundle, next)}
            onExported={reload}
            renderDetail={(bundle) => (
              <ObservationPanel
                bundle={bundle}
                teacherName={
                  staffById.get(String(bundle.schedule.teacher_id))?.name ?? ""
                }
                staffById={staffById}
                schoolName={school?.name}
                schoolAddress={school?.address}
                editMode="all"
                currentUserId={
                  user?.system_user_id != null
                    ? String(user.system_user_id)
                    : null
                }
                onChanged={reload}
              />
            )}
          />
          <p className="text-xs text-muted-foreground">
            Showing {filtered.length} of {bundles.length} schedule
            {bundles.length === 1 ? "" : "s"} for S.Y. {schoolYear}. Open a row
            to file or print its COT forms.
          </p>
        </>
      )}

      <ScheduleModal
        open={modalOpen}
        onOpenChange={(v) => {
          setModalOpen(v);
          if (!v) setEditing(null);
        }}
        schoolYear={schoolYear}
        schoolId={schoolId}
        existing={
          editing
            ? { schedule: editing.schedule, observers: editing.observers }
            : null
        }
        staff={staff}
        observerPool={observerPool}
        observersLoading={observersLoading}
        onObserversChanged={reloadObservers}
        submitting={submitting}
        onSubmit={saveSchedule}
      />
    </div>
  );
}
