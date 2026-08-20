"use client";

import { ConfirmationModal } from "@/components/ConfirmationModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getGradeLevelLabel,
  getMapehComponent,
  getMapehComponentLabel,
  getMapehComponentShortLabel,
  getSubjectProgram,
  getSubjectProgramLabel,
} from "@/lib/constants";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { deleteItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { RootState, Subject } from "@/types";
import { Ban, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { AddModal } from "./AddModal";

type ItemType = Subject;
const table = "sms_subjects";

// Everything that hangs off a subject. `blocks` marks what stops an ordinary
// delete; `destroyed` marks what the ON DELETE CASCADE actually takes with it.
// The two differ for enrollees: sms_enrollments has no subject_id, so learners
// stay enrolled in their section — it just loses this subject. That check is a
// signal the subject is in live use, not a guard against data loss, which is
// why a super admin may override it.
type Dependency = {
  label: string;
  count: number;
  blocks: boolean;
  destroyed: boolean;
};

type DeletePlan =
  // Nothing blocks: delete, cascading `removed`.
  | { mode: "hard"; removed: Dependency[] }
  // Blocked: deactivate instead.
  | { mode: "soft"; blockers: Dependency[] }
  // Blocked, but the user is a super admin: offer an irreversible force delete.
  | { mode: "force"; blockers: Dependency[]; removed: Dependency[] };

const plural = (count: number, noun: string, pluralNoun = `${noun}s`) =>
  `${count} ${count === 1 ? noun : pluralNoun}`;

// BIGINT ids arrive as numbers but are typed as strings across the app, so
// normalise before comparing schedule rows against enrollment rows.
type SectionYearRef = { section_id: number | string; school_year: string };
const sectionYearKey = (ref: SectionYearRef) =>
  `${String(ref.section_id)}|${ref.school_year}`;

const DependencyList = ({ items }: { items: Dependency[] }) => (
  <ul className="list-disc pl-5 text-muted-foreground">
    {items.map((item) => (
      <li key={item.label}>{item.label}</li>
    ))}
  </ul>
);

export const List = () => {
  const dispatch = useAppDispatch();
  const list = useSelector((state: RootState) => state.list.value);
  const user = useAppSelector((state) => state.user.user);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemType | null>(null);
  const [deletePlan, setDeletePlan] = useState<DeletePlan | null>(null);
  const [checking, setChecking] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Only a super admin may override the blockers. Migration 115 already admits
  // them to the sms_subjects DELETE policy, so this needs no server-side change.
  const isSuperAdmin = user?.type === "super admin";

  // Counts learners sitting in a section this subject is scheduled in, matching
  // on section + school year so a schedule from a past year doesn't get blocked
  // by this year's enrollees (or vice versa).
  const countScheduledEnrollees = async (schedules: SectionYearRef[]) => {
    const sectionIds = [
      ...new Set(schedules.map((s) => Number(s.section_id))),
    ];
    if (sectionIds.length === 0) return 0;

    // `status` is the approval column — pending counts as a blocker, since a
    // learner awaiting approval is still on the roster. Deliberately not using
    // `enrollment_status`: a section whose learners all transferred out should
    // still not have its subject wiped mid-year.
    const { data, error } = await supabase
      .from("sms_enrollments")
      .select("section_id, school_year")
      .in("section_id", sectionIds)
      .neq("status", "rejected");
    if (error) throw new Error(error.message);

    const scheduled = new Set(schedules.map(sectionYearKey));
    return ((data ?? []) as SectionYearRef[]).filter((e) =>
      scheduled.has(sectionYearKey(e)),
    ).length;
  };

  const countBySubject = async (referencingTable: string, subjectId: string) => {
    const { count, error } = await supabase
      .from(referencingTable)
      .select("*", { count: "exact", head: true })
      .eq("subject_id", Number(subjectId));
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const buildDeletePlan = async (item: ItemType): Promise<DeletePlan> => {
    let scheduleQuery = supabase
      .from("sms_subject_schedules")
      .select("section_id, school_year")
      .eq("subject_id", Number(item.id));
    if (user?.school_id != null) {
      scheduleQuery = scheduleQuery.eq("school_id", user.school_id);
    }
    const { data, error: scheduleError } = await scheduleQuery;
    if (scheduleError) throw new Error(scheduleError.message);
    const schedules = (data ?? []) as SectionYearRef[];

    // No teacher-assignment count here: migration 022 dropped
    // sms_subject_assignments and moved teacher↔subject assignment onto
    // sms_subject_schedules.teacher_id, so `schedules` already covers it.
    const [
      enrolleeCount,
      gradeCount,
      classRecordCount,
      mpsCount,
      studentSubjectCount,
    ] = await Promise.all([
      countScheduledEnrollees(schedules),
      countBySubject("sms_grades", item.id),
      countBySubject("sms_class_records", item.id),
      countBySubject("sms_mps", item.id),
      countBySubject("sms_student_subjects", item.id),
    ]);

    const dependencies: Dependency[] = [
      {
        label: `${plural(enrolleeCount, "learner")} enrolled in a section it is scheduled in`,
        count: enrolleeCount,
        blocks: true,
        destroyed: false,
      },
      {
        label: plural(gradeCount, "grade record"),
        count: gradeCount,
        blocks: true,
        destroyed: true,
      },
      {
        label: plural(classRecordCount, "class record"),
        count: classRecordCount,
        blocks: true,
        destroyed: true,
      },
      {
        label: plural(mpsCount, "MPS entry", "MPS entries"),
        count: mpsCount,
        blocks: true,
        destroyed: true,
      },
      {
        label: plural(studentSubjectCount, "Madrasah subject enrollment"),
        count: studentSubjectCount,
        blocks: true,
        destroyed: true,
      },
      {
        label: plural(schedules.length, "schedule"),
        count: schedules.length,
        blocks: false,
        destroyed: true,
      },
    ].filter((dependency) => dependency.count > 0);

    const blockers = dependencies.filter((d) => d.blocks);
    const removed = dependencies.filter((d) => d.destroyed);

    if (blockers.length === 0) return { mode: "hard", removed };
    if (isSuperAdmin) return { mode: "force", blockers, removed };
    return { mode: "soft", blockers };
  };

  const handleDeleteConfirmation = async (item: ItemType) => {
    if (checking) return;
    setChecking(true);
    try {
      const plan = await buildDeletePlan(item);
      setSelectedItem(item);
      setDeletePlan(plan);
      setIsModalOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to check this subject's records.",
      );
    } finally {
      setChecking(false);
    }
  };

  const closeDeleteModal = () => {
    setIsModalOpen(false);
    setDeletePlan(null);
  };

  const handleEdit = (item: ItemType) => {
    setSelectedItem(item);
    setModalAddOpen(true);
  };

  // Takes a subject in or out of active use directly, rather than only as the
  // side effect of a blocked delete below. Deliberately not confirmed: the flag
  // destroys nothing and the opposite action sits in the same menu.
  const handleSetActive = async (item: ItemType, isActive: boolean) => {
    if (togglingId) return;
    setTogglingId(item.id);
    try {
      let query = supabase
        .from(table)
        .update({ is_active: isActive })
        .eq("id", item.id);
      if (user?.school_id != null) {
        query = query.eq("school_id", user.school_id);
      }
      const { error } = await query;

      if (error) {
        toast.error(error.message);
        return;
      }

      toast.success(isActive ? "Subject reactivated." : "Subject deactivated.");
      dispatch(updateList({ ...item, is_active: isActive }));
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async () => {
    if (!selectedItem || !deletePlan) return;

    // Blocked by learner data — deactivate instead so the subject can still be
    // taken out of active use without destroying records.
    if (deletePlan.mode === "soft") {
      let deactivateQuery = supabase
        .from(table)
        .update({ is_active: false })
        .eq("id", selectedItem.id);
      if (user?.school_id != null) {
        deactivateQuery = deactivateQuery.eq("school_id", user.school_id);
      }
      const { error } = await deactivateQuery;

      if (error) {
        toast.error(error.message);
      } else {
        toast.success("Subject deactivated.");
        dispatch(updateList({ ...selectedItem, is_active: false }));
        closeDeleteModal();
      }
      return;
    }

    // Nothing blocks, or a super admin is forcing it through. Dependent rows go
    // via the ON DELETE CASCADE on their subject_id foreign keys.
    let deleteQuery = supabase.from(table).delete().eq("id", selectedItem.id);
    if (user?.school_id != null) {
      deleteQuery = deleteQuery.eq("school_id", user.school_id);
    }
    const { error } = await deleteQuery;

    if (error) {
      // A 23503 here means some table still references this subject through a
      // foreign key that does not cascade — i.e. a dependency this plan does
      // not know about. Surface the constraint detail rather than a bare
      // "cannot be deleted", which hides the one fact needed to fix it.
      if (error.code === "23503") {
        toast.error(
          `Subject is still referenced by other records: ${
            error.details || error.message
          }`,
        );
      } else {
        toast.error(error.message);
      }
    } else {
      toast.success("Successfully deleted!");
      dispatch(deleteItem(selectedItem));
      closeDeleteModal();
    }
  };

  return (
    <div className="app__table_container">
      <div className="app__table_wrapper">
        <table className="app__table">
          <thead className="app__table_thead">
            <tr>
              <th className="app__table_th">Code</th>
              <th className="app__table_th">Name</th>
              <th className="app__table_th">Grade Level</th>
              <th className="app__table_th">Grading</th>
              <th className="app__table_th">Program</th>
              <th className="app__table_th">Status</th>
              <th className="app__table_th_right">Actions</th>
            </tr>
          </thead>
          <tbody className="app__table_tbody">
            {(list as ItemType[]).map((item: ItemType) => (
              <tr key={item.id} className="app__table_tr">
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title font-mono">
                      {item.code}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">{item.name}</div>
                    {item.description && (
                      <div className="app__table_cell_subtitle">
                        {item.description}
                      </div>
                    )}
                  </div>
                </td>
                <td className="app__table_td">
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                    {getGradeLevelLabel(item.grade_level)}
                  </span>
                </td>
                <td className="app__table_td">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      item.is_graded !== false
                        ? "bg-blue-100 text-blue-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {item.is_graded !== false ? "Graded" : "Not graded"}
                  </span>
                </td>
                <td className="app__table_td">
                  {(() => {
                    const program = getSubjectProgram(item);
                    return (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          program === "madrasah"
                            ? "bg-amber-100 text-amber-800"
                            : program === "als"
                              ? "bg-purple-100 text-purple-800"
                              : "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {getSubjectProgramLabel(program)}
                      </span>
                    );
                  })()}
                  {(() => {
                    // Tagged components print under a computed MAPEH row on
                    // the report card and SF9 (migration 153).
                    const component = getMapehComponent(item);
                    if (!component) return null;
                    return (
                      <span
                        className="ml-1 inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800"
                        title={`MAPEH — ${getMapehComponentLabel(component)}`}
                      >
                        MAPEH · {getMapehComponentShortLabel(component)}
                      </span>
                    );
                  })()}
                </td>
                <td className="app__table_td">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      item.is_active
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {item.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="app__table_td_actions">
                  <div className="app__table_action_container">
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
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => handleEdit(item)}
                          className="cursor-pointer"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleSetActive(item, !item.is_active)}
                          disabled={togglingId !== null}
                          className="cursor-pointer"
                        >
                          {item.is_active ? (
                            <Ban className="mr-2 h-4 w-4" />
                          ) : (
                            <RotateCcw className="mr-2 h-4 w-4" />
                          )}
                          {togglingId === item.id
                            ? "Saving..."
                            : item.is_active
                              ? "Mark as Inactive"
                              : "Reactivate"}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteConfirmation(item)}
                          disabled={checking}
                          variant="destructive"
                          className="cursor-pointer"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {checking ? "Checking..." : "Delete"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmationModal
        isOpen={isModalOpen}
        onClose={closeDeleteModal}
        onConfirm={handleDelete}
        // Force delete is irreversible and destroys learner records, so it is
        // gated on typing the subject code rather than a single click.
        confirmPhrase={
          deletePlan?.mode === "force" ? selectedItem?.code : undefined
        }
        destructive={deletePlan?.mode === "force"}
        message={
          deletePlan?.mode === "soft" ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium">
                  &ldquo;{selectedItem?.name}&rdquo;
                </span>{" "}
                cannot be deleted because it still has:
              </p>
              <DependencyList items={deletePlan.blockers} />
              <p>It will be deactivated instead. Continue?</p>
            </div>
          ) : deletePlan?.mode === "force" ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-medium">
                  &ldquo;{selectedItem?.name}&rdquo;
                </span>{" "}
                is still in use:
              </p>
              <DependencyList items={deletePlan.blockers} />
              <p className="font-medium text-destructive">
                Deleting it permanently destroys:
              </p>
              <DependencyList items={deletePlan.removed} />
              <p className="text-muted-foreground">
                Enrollments are not affected — learners stay in their section,
                which simply loses this subject. Everything above cannot be
                recovered.
              </p>
            </div>
          ) : deletePlan?.mode === "hard" ? (
            <div className="space-y-2 text-sm">
              <p>
                Delete{" "}
                <span className="font-medium">
                  &ldquo;{selectedItem?.name}&rdquo;
                </span>
                ?
              </p>
              {deletePlan.removed.length > 0 && (
                <p className="text-muted-foreground">
                  Its{" "}
                  {deletePlan.removed.map((d) => d.label).join(" and ")} will
                  also be deleted.
                </p>
              )}
              <p className="text-muted-foreground">This cannot be undone.</p>
            </div>
          ) : (
            "Are you sure you want to delete this subject?"
          )
        }
      />
      <AddModal
        isOpen={modalAddOpen}
        editData={selectedItem}
        onClose={() => {
          setModalAddOpen(false);
          setSelectedItem(null);
        }}
      />
    </div>
  );
};
