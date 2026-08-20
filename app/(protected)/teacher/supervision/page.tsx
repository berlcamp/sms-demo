"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatFocusList } from "@/lib/constants/supervision";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { fetchSchoolSettings } from "@/lib/utils/schoolSettings";
import { fromDatetimeLocal } from "@/lib/utils/supervision";
import {
  getCurrentSchoolYear,
  getSchoolYearOptions,
} from "@/lib/utils/schoolYear";
import { Loader2, Plus, Telescope } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { ObservationPanel } from "../../supervision/components/ObservationPanel";
import { ScheduleCard } from "../../supervision/components/ScheduleCard";
import {
  ScheduleModal,
  type ScheduleFormValues,
} from "../../supervision/components/ScheduleModal";
import {
  useDesignatedObservers,
  useSupervisionSchedules,
  useSupervisionStaff,
  type SupervisionStaff,
} from "../../supervision/useSupervision";

/**
 * The teacher's own view of instructional supervision.
 *
 * Two tabs, because a master teacher is routinely both:
 *   "My observations"      — slots where this user is the teacher observed. They
 *                            may suggest a schedule; the School Head approves.
 *   "Observations I conduct" — slots where this user is an assigned observer.
 *                            COT forms are restricted to their own sheet, so one
 *                            observer cannot edit another's rating.
 */
export default function Page() {
  const user = useAppSelector((state) => state.user.user);
  const schoolId = user?.school_id ?? null;
  // `user.id` is the Supabase AUTH uuid; `sms_users.id` is `system_user_id`.
  // Every foreign key in this module points at sms_users, so using user.id
  // yields NaN on Number() and a null insert.
  const userId = user?.system_user_id ?? null;

  const [schoolYear, setSchoolYear] = useState(getCurrentSchoolYear());
  const { staff } = useSupervisionStaff(schoolId);
  const {
    observers: designated,
    loading: observersLoading,
    reload: reloadObservers,
  } = useDesignatedObservers(schoolId, schoolYear);

  // Every schedule at the school for the year: the observer tab needs slots
  // where this user is an observer, not the teacher, so it cannot be filtered
  // by teacher_id at the query level.
  const { bundles, loading, reload } = useSupervisionSchedules({
    schoolId,
    schoolYear,
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

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  /**
   * The signed-in teacher, for locking the "Name of teacher" field.
   *
   * Falls back to the Redux user when the staff list has not resolved yet (or
   * does not contain them): `staff` loads asynchronously, so a plain lookup is
   * null on first render and the locked name would flash empty.
   */
  const me = useMemo<SupervisionStaff | null>(() => {
    if (!userId) return null;
    return (
      staffById.get(String(userId)) ?? {
        id: String(userId),
        name: user?.name ?? "",
        // Redux carries no plantilla position; it fills in once `staff` loads,
        // and the Position field in the dialog is editable either way.
        position: null,
        type: user?.type ?? null,
      }
    );
  }, [userId, staffById, user]);

  /**
   * The observers a teacher may propose — the same designated pool the School
   * Head sees. The teacher's pick is a PREFERENCE: the School Head confirms or
   * changes it when approving, and editing a slot returns it to 'proposed'.
   *
   * An unresolved designation is shown rather than dropped, matching the board.
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

  const mine = useMemo(
    () =>
      bundles.filter((b) => String(b.schedule.teacher_id) === String(userId)),
    [bundles, userId],
  );

  const toObserve = useMemo(
    () =>
      bundles.filter((b) =>
        b.observers.some((o) => String(o.user_id) === String(userId)),
      ),
    [bundles, userId],
  );

  const isDesignated = useMemo(
    () =>
      designated.some(
        (o) => o.is_active && String(o.user_id) === String(userId),
      ),
    [designated, userId],
  );

  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const propose = async (values: ScheduleFormValues) => {
    if (schoolId == null || userId == null) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("sms_supervision_schedules")
        .insert({
          school_id: Number(schoolId),
          school_year: schoolYear,
          term: values.term,
          teacher_id: Number(userId),
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
          status: "proposed",
          proposed_by: Number(userId),
        })
        .select("id")
        .single();
      if (error) throw new Error(error.message);

      // The teacher's preferred observer/s. This insert was missing entirely,
      // so anything picked here used to be dropped on save. The School Head can
      // still change it when approving — the slot returns to 'proposed' on edit.
      if (values.observer_ids.length > 0) {
        const { error: obsErr } = await supabase
          .from("sms_supervision_schedule_observers")
          .insert(
            values.observer_ids.map((id, index) => ({
              schedule_id: Number(data.id),
              user_id: Number(id),
              slot: index + 1,
            })),
          );
        if (obsErr) throw new Error(obsErr.message);
      }

      toast.success("Suggested schedule sent for approval.");
      setModalOpen(false);
      reload();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to submit the schedule.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const renderList = (
    list: typeof bundles,
    empty: string,
    /**
     * "own" on the tab of observations this user conducts; "none" on their own
     * observations, where every form was written *about* them and must stay
     * read-only.
     */
    editMode: "own" | "none",
  ) => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      );
    }
    if (list.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {empty}
          </CardContent>
        </Card>
      );
    }
    return (
      <div className="space-y-3">
        {list.map((bundle) => (
          <ScheduleCard
            key={String(bundle.schedule.id)}
            bundle={bundle}
            staffById={staffById}
            schoolName={school?.name}
            schoolAddress={school?.address}
            principalName={principal.name}
            principalTitle={principal.title}
            onExported={reload}
          >
            <ObservationPanel
              bundle={bundle}
              teacherName={
                staffById.get(String(bundle.schedule.teacher_id))?.name ?? ""
              }
              staffById={staffById}
              schoolName={school?.name}
              schoolAddress={school?.address}
              editMode={editMode}
              currentUserId={userId != null ? String(userId) : null}
              onChanged={reload}
            />
          </ScheduleCard>
        ))}
      </div>
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Telescope className="h-6 w-6" />
            Instructional Supervision
          </h1>
          <p className="text-sm text-muted-foreground">
            Suggest when you would like to be observed, then add the approved slot
            to your calendar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36">
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
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Suggest schedule
          </Button>
        </div>
      </div>

      <Tabs defaultValue="mine">
        <TabsList>
          <TabsTrigger value="mine">
            My observations
            {mine.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {mine.length}
              </Badge>
            )}
          </TabsTrigger>
          {isDesignated && (
            <TabsTrigger value="conduct">
              Observations I conduct
              {toObserve.length > 0 && (
                <Badge variant="secondary" className="ml-2">
                  {toObserve.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="mine" className="mt-4">
          {renderList(
            mine,
            "No observation schedules yet. Suggest one and the School Head will approve it.",
            "none",
          )}
        </TabsContent>

        {isDesignated && (
          <TabsContent value="conduct" className="mt-4">
            {renderList(
              toObserve,
              "You have not been assigned to observe anyone this school year.",
              "own",
            )}
          </TabsContent>
        )}
      </Tabs>

      <ScheduleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        schoolYear={schoolYear}
        schoolId={schoolId}
        existing={null}
        staff={staff}
        observerPool={observerPool}
        observersLoading={observersLoading}
        lockedTeacher={me}
        onObserversChanged={reloadObservers}
        submitting={submitting}
        onSubmit={propose}
      />
    </div>
  );
}
