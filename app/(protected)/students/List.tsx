"use client";

import { ConfirmationModal } from "@/components/ConfirmationModal";
import { formatLrn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getGradeLevelLabel, isTeacherRole } from "@/lib/constants";
import { ENROLLMENT_STATUS_LABELS, ENROLLMENT_STATUS_STYLES } from "@/lib/dashboard-utils";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { deleteItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { RootState, Student } from "@/types";
import { Eye, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { AddModal } from "./AddModal";
import { ForceDeleteStudentModal } from "./ForceDeleteStudentModal";
import { ViewModal } from "./ViewModal";

type ItemType = Student;
const table = "sms_students";

type EnrollmentInfo = { grade_level: number; section_id: string; enrollment_status: string; school_year: string };

const getGradeBand = (gradeLevel: number) => {
  if (gradeLevel === 0)  return { dot: "bg-amber-400",   text: "text-amber-700 dark:text-amber-400",   bg: "bg-amber-50 dark:bg-amber-950/30",   border: "border-amber-200 dark:border-amber-800/50" };
  if (gradeLevel <= 6)   return { dot: "bg-blue-400",    text: "text-blue-700 dark:text-blue-400",    bg: "bg-blue-50 dark:bg-blue-950/30",    border: "border-blue-200 dark:border-blue-800/50" };
  if (gradeLevel <= 10)  return { dot: "bg-emerald-400", text: "text-emerald-700 dark:text-emerald-400", bg: "bg-emerald-50 dark:bg-emerald-950/30", border: "border-emerald-200 dark:border-emerald-800/50" };
  return                        { dot: "bg-violet-400",  text: "text-violet-700 dark:text-violet-400",  bg: "bg-violet-50 dark:bg-violet-950/30",  border: "border-violet-200 dark:border-violet-800/50" };
};

export const List = () => {
  const dispatch = useAppDispatch();
  const list = useSelector((state: RootState) => state.list.value);
  const user = useAppSelector((state) => state.user.user);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [forceDeleteOpen, setForceDeleteOpen] = useState(false);
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [modalViewOpen, setModalViewOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemType | null>(null);
  const [sectionNames, setSectionNames] = useState<Record<string, string>>({});
  const [sectionAdviserIds, setSectionAdviserIds] = useState<Record<string, string>>({});
  const [adviserNames, setAdviserNames] = useState<Record<string, string>>({});
  const [encoderNames, setEncoderNames] = useState<Record<string, string>>({});
  const [enrollmentByStudent, setEnrollmentByStudent] = useState<
    Record<string, EnrollmentInfo>
  >({});
  const [studentsWithEnrollment, setStudentsWithEnrollment] = useState<
    Set<string>
  >(new Set());

  useEffect(() => {
    const fetchEnrollments = async () => {
      const studentIds = (list as ItemType[])
        .map((item) => item.id)
        .filter(Boolean) as string[];

      if (studentIds.length === 0) return;

      let enrollQuery = supabase
        .from("sms_enrollments")
        .select("student_id, section_id, grade_level, school_year, status, enrollment_status")
        .in("student_id", studentIds);
      if (user?.school_id != null) {
        enrollQuery = enrollQuery.eq("school_id", user.school_id);
      }
      const { data: allEnrollments } = await enrollQuery;

      if (!allEnrollments) return;

      const studentsWithEnroll = new Set<string>();
      allEnrollments.forEach((e) => studentsWithEnroll.add(String(e.student_id)));
      setStudentsWithEnrollment(studentsWithEnroll);

      const approved = allEnrollments.filter((e) => e.status === "approved");
      const latestByStudent: Record<string, { grade_level: number; section_id: string; school_year: string; enrollment_status: string }> = {};
      approved.forEach((e) => {
        const sid = String(e.student_id);
        const existing = latestByStudent[sid];
        if (
          !existing ||
          (e.school_year && e.school_year > existing.school_year)
        ) {
          latestByStudent[sid] = {
            grade_level: e.grade_level,
            section_id: String(e.section_id),
            school_year: e.school_year || "",
            enrollment_status: e.enrollment_status ?? "",
          };
        }
      });

      const enrollmentMap: Record<string, EnrollmentInfo> = {};
      Object.entries(latestByStudent).forEach(([sid, info]) => {
        enrollmentMap[sid] = {
          grade_level: info.grade_level,
          section_id: info.section_id,
          enrollment_status: info.enrollment_status,
          school_year: info.school_year,
        };
      });
      setEnrollmentByStudent(enrollmentMap);
    };

    if (list.length > 0) {
      fetchEnrollments();
    } else {
      setEnrollmentByStudent({});
      setStudentsWithEnrollment(new Set());
    }
  }, [list, user?.school_id]);

  useEffect(() => {
    const fetchSections = async () => {
      const sectionIdsFromStudents = Array.from(
        new Set(
          (list as ItemType[])
            .map((item) => item.current_section_id)
            .filter(Boolean) as string[],
        ),
      );
      const sectionIdsFromEnrollments = Object.values(enrollmentByStudent).map(
        (e) => e.section_id,
      );
      const sectionIds = Array.from(
        new Set([...sectionIdsFromStudents, ...sectionIdsFromEnrollments]),
      );

      if (sectionIds.length === 0) return;

      let query = supabase
        .from("sms_sections")
        .select("id, name, section_adviser_id")
        .in("id", sectionIds);
      if (user?.school_id != null) {
        query = query.eq("school_id", user.school_id);
      }
      const { data } = await query;

      if (data) {
        const names: Record<string, string> = {};
        const adviserIdMap: Record<string, string> = {};
        data.forEach((section) => {
          names[section.id] = section.name;
          if (section.section_adviser_id) {
            adviserIdMap[section.id] = section.section_adviser_id;
          }
        });
        setSectionNames(names);
        setSectionAdviserIds(adviserIdMap);
      }
    };

    if (list.length > 0) {
      fetchSections();
    }
  }, [list, enrollmentByStudent, user?.school_id]);

  useEffect(() => {
    const fetchAdvisers = async () => {
      const adviserIds = Array.from(new Set(Object.values(sectionAdviserIds)));
      if (adviserIds.length === 0) return;
      const { data } = await supabase
        .from("sms_users")
        .select("id, name")
        .in("id", adviserIds);
      if (data) {
        const names: Record<string, string> = {};
        data.forEach((u) => { names[String(u.id)] = u.name; });
        setAdviserNames(names);
      }
    };
    fetchAdvisers();
  }, [sectionAdviserIds]);

  useEffect(() => {
    const fetchEncoders = async () => {
      const encoderIds = Array.from(
        new Set(
          (list as ItemType[])
            .map((item) => item.encoded_by)
            .filter(Boolean) as string[],
        ),
      );

      if (encoderIds.length === 0) return;

      const { data } = await supabase
        .from("sms_users")
        .select("id, name")
        .in("id", encoderIds);

      if (data) {
        const names: Record<string, string> = {};
        data.forEach((u) => {
          names[String(u.id)] = u.name;
        });
        setEncoderNames(names);
      }
    };

    if (list.length > 0) {
      fetchEncoders();
    }
  }, [list]);

  const handleDeleteConfirmation = (item: ItemType) => {
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleForceDeleteConfirmation = (item: ItemType) => {
    setSelectedItem(item);
    setForceDeleteOpen(true);
  };

  const handleEdit = (item: ItemType) => {
    setSelectedItem(item);
    setModalAddOpen(true);
  };

  const handleView = (item: ItemType) => {
    setSelectedItem(item);
    setModalViewOpen(true);
  };

  const handleDelete = async () => {
    if (selectedItem) {
      if (!canEditDelete(selectedItem)) {
        toast.error("You do not have permission to delete this student.");
        setIsModalOpen(false);
        return;
      }
      if (studentsWithEnrollment.has(String(selectedItem.id))) {
        toast.error(
          "Student cannot be deleted because they have enrollment record(s).",
        );
        setIsModalOpen(false);
        return;
      }
      let deleteQuery = supabase.from(table).delete().eq("id", selectedItem.id);
      if (user?.school_id != null) {
        deleteQuery = deleteQuery.eq("school_id", user.school_id);
      }
      const { error } = await deleteQuery;

      if (error) {
        if (error.code === "23503") {
          toast.error("Student cannot be deleted (has related records).");
        } else {
          toast.error(error.message);
        }
      } else {
        toast.success("Student successfully deleted!");
        dispatch(deleteItem(selectedItem));
        setIsModalOpen(false);
      }
    }
  };

  const canDeleteStudent = (item: ItemType) =>
    canEditDelete(item) && !studentsWithEnrollment.has(String(item.id));

  const isSuperAdmin = user?.type === "super admin";
  const hasSchoolManagementAccess =
    user?.type === "school_head" ||
    user?.type === "assistant_school_head" ||
    user?.type === "super admin" ||
    user?.type === "admin" ||
    user?.type === "registrar";
  const canEditDelete = (item: ItemType) =>
    hasSchoolManagementAccess ||
    (isTeacherRole(user?.type) &&
      user?.system_user_id != null &&
      String(item.encoded_by) === String(user.system_user_id));

  const getFullName = (student: ItemType) => {
    return `${student.last_name}, ${student.first_name}${
      student.middle_name ? ` ${String(student.middle_name).charAt(0)}.` : ""
    }${student.suffix ? ` ${student.suffix}` : ""}`;
  };

  return (
    <div className="app__table_container">
      <div className="app__table_wrapper">
        <table className="app__table">
          <thead className="app__table_thead">
            <tr>
              <th className="app__table_th">LRN</th>
              <th className="app__table_th">Name</th>
              <th className="app__table_th">Grade Level</th>
              <th className="app__table_th">Section</th>
              <th className="app__table_th">Status</th>
              <th className="app__table_th">Encoded By</th>
              <th className="app__table_th_right">Actions</th>
            </tr>
          </thead>
          <tbody className="app__table_tbody">
            {(list as ItemType[]).filter(Boolean).map((item: ItemType) => (
              <tr key={item.id} className="app__table_tr">
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title font-mono">
                      {formatLrn(item.lrn)}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <button
                      type="button"
                      className="app__table_cell_title text-left text-primary hover:underline cursor-pointer"
                      onClick={() => handleView(item)}
                    >
                      {getFullName(item)}
                    </button>
                    <div className="app__table_cell_subtitle">
                      {item.gender === "male" ? "Male" : "Female"} •{" "}
                      {new Date(item.date_of_birth).toLocaleDateString()}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  {(() => {
                    const enroll = enrollmentByStudent[String(item.id)];
                    if (!enroll) return <span className="text-muted-foreground text-sm">—</span>;
                    const band = getGradeBand(enroll.grade_level);
                    return (
                      <div className="flex flex-col gap-1">
                        <div className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 w-fit ${band.bg} ${band.border}`}>
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${band.dot}`} />
                          <span className={`text-xs font-semibold ${band.text}`}>
                            {getGradeLevelLabel(enroll.grade_level)}
                          </span>
                        </div>
                        {enroll.school_year && (
                          <span className="text-[11px] text-muted-foreground pl-0.5">{enroll.school_year}</span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {enrollmentByStudent[String(item.id)]?.section_id
                        ? sectionNames[
                            enrollmentByStudent[String(item.id)].section_id
                          ] || "-"
                        : "-"}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  {(() => {
                    const enrollment = enrollmentByStudent[String(item.id)];
                    const es = enrollment?.enrollment_status ?? "";
                    if (!es) return <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-gray-100 text-gray-600">Not Enrolled</span>;
                    const adviserId = es === "retained" && enrollment?.section_id
                      ? sectionAdviserIds[enrollment.section_id]
                      : undefined;
                    return (
                      <div className="app__table_cell_text">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${ENROLLMENT_STATUS_STYLES[es] ?? ""}`}
                        >
                          {ENROLLMENT_STATUS_LABELS[es] ?? es}
                        </span>
                        {adviserId && (
                          <div className="app__table_cell_subtitle mt-0.5">
                            Adviser: {adviserNames[adviserId] ?? "—"}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {item.encoded_by
                        ? encoderNames[String(item.encoded_by)] || "-"
                        : "-"}
                    </div>
                    <div className="app__table_cell_subtitle">
                      {item.created_at
                        ? new Date(item.created_at).toLocaleDateString()
                        : "-"}
                    </div>
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
                      <DropdownMenuContent align="end" className="w-40">
                        <DropdownMenuItem
                          onClick={() => handleView(item)}
                          className="cursor-pointer"
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </DropdownMenuItem>
                        {canEditDelete(item) && (
                          <DropdownMenuItem
                            onClick={() => handleEdit(item)}
                            className="cursor-pointer"
                          >
                            <Pencil className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {isSuperAdmin ? (
                          <DropdownMenuItem
                            onClick={() => handleForceDeleteConfirmation(item)}
                            variant="destructive"
                            className="cursor-pointer"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        ) : (
                          canDeleteStudent(item) && (
                            <DropdownMenuItem
                              onClick={() => handleDeleteConfirmation(item)}
                              variant="destructive"
                              className="cursor-pointer"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          )
                        )}
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
        message="Are you sure you want to delete this student?"
      />
      <ForceDeleteStudentModal
        isOpen={forceDeleteOpen}
        student={selectedItem}
        onClose={() => {
          setForceDeleteOpen(false);
          setSelectedItem(null);
        }}
        onDeleted={(deleted) => {
          dispatch(deleteItem(deleted));
        }}
      />
      <AddModal
        isOpen={modalAddOpen}
        editData={selectedItem}
        onClose={() => {
          setModalAddOpen(false);
          setSelectedItem(null);
        }}
      />
      <ViewModal
        isOpen={modalViewOpen}
        student={selectedItem}
        onClose={() => {
          setModalViewOpen(false);
          setSelectedItem(null);
        }}
        onStudentUpdated={
          selectedItem
            ? (updates) => {
                dispatch(updateList({ id: selectedItem.id, ...updates }));
                setSelectedItem((prev) =>
                  prev ? { ...prev, ...updates } : null,
                );
              }
            : undefined
        }
      />
    </div>
  );
};
