"use client";

import { ConfirmationModal } from "@/components/ConfirmationModal";
import { TemporaryScheduleBadge } from "@/components/TemporaryScheduleBadge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getGradeLevelLabel,
  getStrandLabel,
  isShsGrade,
  SECTION_TYPE_LABELS,
} from "@/lib/constants";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { deleteItem } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { formatRoomDimension } from "@/lib/utils/roomDimension";
import { fetchStaffNames } from "@/lib/utils/staff";
import { RootState, Section } from "@/types";
import {
  BookOpen,
  Copy,
  MoreVertical,
  Pencil,
  Printer,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { AddModal } from "./AddModal";
import { DuplicateModal } from "./DuplicateModal";
import { generateSectionStudentsPrint } from "@/lib/pdf/generateSectionStudents";
import { ViewStudentsModal } from "./ViewStudentsModal";
import { ViewSubjectsModal } from "./ViewSubjectsModal";

type ItemType = Section;
const table: string = "sms_sections";

export const List = () => {
  const dispatch = useAppDispatch();
  const list = useSelector((state: RootState) => state.list.value);
  const user = useAppSelector((state) => state.user.user);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [modalDuplicateOpen, setModalDuplicateOpen] = useState(false);
  const [modalViewStudentsOpen, setModalViewStudentsOpen] = useState(false);
  const [modalViewSubjectsOpen, setModalViewSubjectsOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemType | null>(null);
  const [adviserNames, setAdviserNames] = useState<Record<string, string>>({});
  const [rooms, setRooms] = useState<
    Record<string, { name: string; dimension: string | null }>
  >({});
  const [scheduleCounts, setScheduleCounts] = useState<
    Record<string, { scheduled: number; total: number }>
  >({});
  // Section ids with at least one schedule that has no teacher assigned
  const [temporarySections, setTemporarySections] = useState<Set<string>>(
    new Set(),
  );

  // Fetch adviser names
  useEffect(() => {
    const fetchAdvisers = async () => {
      const adviserIds = Array.from(
        new Set(
          (list as ItemType[])
            .map((item) => item.section_adviser_id)
            .filter(Boolean) as string[],
        ),
      );

      if (adviserIds.length === 0) return;

      // Not school-scoped: an adviser who has since moved schools is still the
      // adviser this section was signed under, and SF9 / the report card print
      // their name by id anyway — the filter only made the list disagree.
      setAdviserNames(await fetchStaffNames(adviserIds));
    };

    if (list.length > 0) {
      fetchAdvisers();
    }
  }, [list]);

  // Classroom names for the sections that have one assigned (migration 138)
  useEffect(() => {
    const fetchRooms = async () => {
      const roomIds = Array.from(
        new Set(
          (list as ItemType[])
            .map((item) => item.room_id)
            .filter(Boolean) as string[],
        ),
      );

      if (roomIds.length === 0) return;

      let query = supabase
        .from("sms_rooms")
        .select("id, name, dimension")
        .in("id", roomIds);
      if (user?.school_id != null) {
        query = query.eq("school_id", user.school_id);
      }
      const { data } = await query;

      if (data) {
        const map: Record<string, { name: string; dimension: string | null }> =
          {};
        data.forEach((room) => {
          map[room.id] = { name: room.name, dimension: room.dimension };
        });
        setRooms(map);
      }
    };

    if (list.length > 0) {
      fetchRooms();
    }
  }, [list, user?.school_id]);

  // Fetch schedule counts (scheduled subjects vs total subjects per section)
  const fetchScheduleCounts = useCallback(async () => {
    const sections = list as ItemType[];
    if (sections.length === 0) return;

    const gradeLevels = Array.from(
      new Set(sections.map((s) => s.grade_level)),
    );

    // Total subjects per grade level
    const totalByGrade: Record<number, number> = {};
    await Promise.all(
      gradeLevels.map(async (gl) => {
        let query = supabase
          .from("sms_subjects")
          .select("*", { count: "exact", head: true })
          .eq("grade_level", gl)
          .eq("is_active", true);
        if (user?.school_id != null) {
          query = query.eq("school_id", user.school_id);
        }
        const { count } = await query;
        totalByGrade[gl] = count ?? 0;
      }),
    );

    // Scheduled subjects per section (school-scoped)
    let schedulesQuery = supabase
      .from("sms_subject_schedules")
      .select("section_id, subject_id, school_year, teacher_id")
      .in(
        "section_id",
        sections.map((s) => s.id),
      );
    if (user?.school_id != null) {
      schedulesQuery = schedulesQuery.eq("school_id", user.school_id);
    }
    const { data: schedulesData } = await schedulesQuery;

    const scheduledBySection: Record<string, Set<string>> = {};
    // Sections holding at least one Temporary schedule (no teacher assigned)
    const temporaryBySection = new Set<string>();
    for (const s of schedulesData ?? []) {
      const section = sections.find(
        (sec) =>
          String(sec.id) === String(s.section_id) &&
          sec.school_year === s.school_year,
      );
      if (section) {
        const key = section.id;
        if (!scheduledBySection[key]) scheduledBySection[key] = new Set();
        scheduledBySection[key].add(String(s.subject_id));
        if (s.teacher_id == null) temporaryBySection.add(String(key));
      }
    }
    setTemporarySections(temporaryBySection);

    const counts: Record<string, { scheduled: number; total: number }> = {};
    for (const section of sections) {
      const total = totalByGrade[section.grade_level] ?? 0;
      const scheduled = scheduledBySection[section.id]?.size ?? 0;
      counts[section.id] = { scheduled, total };
    }
    setScheduleCounts(counts);
    // Depends on `user`, not `user?.school_id`: React Compiler infers the whole
    // object and refuses to preserve a manual memo whose declared dependency is
    // narrower than the inferred one.
  }, [list, user]);

  useEffect(() => {
    if (list.length > 0) {
      fetchScheduleCounts();
    }
  }, [list, fetchScheduleCounts]);

  const handleDeleteConfirmation = (item: ItemType) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleEdit = (item: ItemType) => {
    setSelectedItem(item);
    setModalAddOpen(true);
  };

  const handleViewStudents = (item: ItemType) => {
    setSelectedItem(item);
    setModalViewStudentsOpen(true);
  };

  const handleViewSubjects = (item: ItemType) => {
    setSelectedItem(item);
    setModalViewSubjectsOpen(true);
  };

  const handleDuplicate = (item: ItemType) => {
    setSelectedItem(item);
    setModalDuplicateOpen(true);
  };

  const handlePrintStudents = async (item: ItemType) => {
    if (!user?.school_id) {
      toast.error("School not found");
      return;
    }
    try {
      await generateSectionStudentsPrint({
        schoolId: user.school_id,
        sectionId: item.id,
        sectionName: item.name,
        gradeLevel: item.grade_level,
        schoolYear: item.school_year,
        adviserName: item.section_adviser_id
          ? adviserNames[item.section_adviser_id] || ""
          : "",
      });
    } catch {
      toast.error("Failed to generate print. Please try again.");
    }
  };

  const handleDelete = async () => {
    if (selectedItem) {
      // Check for enrolled students before deleting
      const enrollmentQuery = supabase
        .from("sms_enrollments")
        .select("*", { count: "exact", head: true })
        .eq("section_id", selectedItem.id);
      const { count: enrolledCount } = await enrollmentQuery;

      if (enrolledCount != null && enrolledCount > 0) {
        toast.error(
          "Section cannot be deleted because it has enrolled students.",
        );
        return;
      }

      let deleteQuery = supabase.from(table).delete().eq("id", selectedItem.id);
      if (user?.school_id != null) {
        deleteQuery = deleteQuery.eq("school_id", user.school_id);
      }
      const { error } = await deleteQuery;

      if (error) {
        if (error.code === "23503") {
          toast.error("Selected record cannot be deleted.");
        } else {
          toast.error(error.message);
        }
      } else {
        toast.success("Successfully deleted!");
        dispatch(deleteItem(selectedItem));
        setIsModalOpen(false);
      }
    }
  };

  return (
    <div className="app__table_container">
      <div className="app__table_wrapper">
        <table className="app__table">
          <thead className="app__table_thead">
            <tr>
              <th className="app__table_th">Section</th>
              <th className="app__table_th">Grade Level</th>
              <th className="app__table_th">Adviser</th>
              <th className="app__table_th">Classroom</th>
              <th className="app__table_th">Scheduled Subjects</th>
              <th className="app__table_th_right">Actions</th>
            </tr>
          </thead>
          <tbody className="app__table_tbody">
            {(list as ItemType[]).map((item: ItemType) => (
              <tr key={item.id} className="app__table_tr">
                {/* Section name carries the school year and the active flag —
                    three narrow columns of one value each only forced the
                    table into a horizontal scrollbar. */}
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title flex items-center gap-2">
                      <span>{item.name}</span>
                      {!item.is_active && (
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800">
                          Inactive
                        </span>
                      )}
                    </div>
                    <div className="app__table_cell_subtitle">
                      {item.school_year}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div>
                      <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                        {getGradeLevelLabel(item.grade_level)}
                      </span>
                    </div>
                    {/* Section type, and for Grades 11-12 the strand. A SHS
                        section with no strand recorded drops out of the
                        division's Track & Strand report entirely, so flag it
                        here rather than letting it fail silently. */}
                    <div className="app__table_cell_subtitle">
                      {item.section_type
                        ? SECTION_TYPE_LABELS[item.section_type] ??
                          item.section_type
                        : "-"}
                      {isShsGrade(item.grade_level) &&
                        (item.strand ? (
                          <span>
                            {" · "}
                            {getStrandLabel(item.strand)}
                            {item.specialization
                              ? ` — ${item.specialization}`
                              : ""}
                          </span>
                        ) : (
                          <span className="ml-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800">
                            Strand not set
                          </span>
                        ))}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {item.section_adviser_id
                        ? adviserNames[item.section_adviser_id] || "-"
                        : "-"}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {item.room_id ? rooms[item.room_id]?.name || "-" : "-"}
                    </div>
                    {item.room_id &&
                      formatRoomDimension(rooms[item.room_id]?.dimension) && (
                        <div className="app__table_cell_subtitle">
                          {formatRoomDimension(rooms[item.room_id]?.dimension)}
                        </div>
                      )}
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="flex flex-wrap items-center gap-1">
                    {scheduleCounts[item.id] &&
                    scheduleCounts[item.id].total > 0 ? (
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          scheduleCounts[item.id].scheduled ===
                          scheduleCounts[item.id].total
                            ? "bg-green-100 text-green-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {scheduleCounts[item.id].scheduled} of{" "}
                        {scheduleCounts[item.id].total}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                    {temporarySections.has(String(item.id)) && (
                      <TemporaryScheduleBadge />
                    )}
                  </div>
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
                      <DropdownMenuContent align="end" className="w-48">
                        <DropdownMenuItem
                          onClick={() => handleViewStudents(item)}
                          className="cursor-pointer"
                        >
                          <Users className="mr-2 h-4 w-4" />
                          View Students
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handlePrintStudents(item)}
                          className="cursor-pointer"
                        >
                          <Printer className="mr-2 h-4 w-4" />
                          Print Students
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleViewSubjects(item)}
                          className="cursor-pointer"
                        >
                          <BookOpen className="mr-2 h-4 w-4" />
                          Manage Schedules
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDuplicate(item)}
                          className="cursor-pointer"
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleEdit(item)}
                          className="cursor-pointer"
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDeleteConfirmation(item)}
                          variant="destructive"
                          className="cursor-pointer"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
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
        onClose={() => setIsModalOpen(false)}
        onConfirm={handleDelete}
        message="Are you sure you want to delete this section?"
      />
      <AddModal
        isOpen={modalAddOpen}
        editData={selectedItem}
        onClose={() => {
          setModalAddOpen(false);
          setSelectedItem(null);
        }}
      />
      <DuplicateModal
        isOpen={modalDuplicateOpen}
        onClose={() => {
          setModalDuplicateOpen(false);
          setSelectedItem(null);
        }}
        sourceSection={selectedItem}
      />
      <ViewStudentsModal
        isOpen={modalViewStudentsOpen}
        section={selectedItem}
        onClose={() => {
          setModalViewStudentsOpen(false);
          setSelectedItem(null);
        }}
      />
      <ViewSubjectsModal
        isOpen={modalViewSubjectsOpen}
        section={selectedItem}
        onClose={() => {
          setModalViewSubjectsOpen(false);
          setSelectedItem(null);
        }}
        onScheduleUpdate={fetchScheduleCounts}
      />
    </div>
  );
};
