"use client";

import { SharedSlotBadge } from "@/components/SharedSlotBadge";
import { TemporaryScheduleBadge } from "@/components/TemporaryScheduleBadge";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { formatDays, formatTimeRange } from "@/lib/utils/scheduleConflicts";
import { fetchStaffNames } from "@/lib/utils/staff";
import { RootState, SubjectSchedule } from "@/types";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";

type ItemType = SubjectSchedule;

export const List = () => {
  const list = useSelector((state: RootState) => state.list.value);
  const user = useAppSelector((state) => state.user.user);
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const [sectionNames, setSectionNames] = useState<Record<string, string>>({});
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [roomNames, setRoomNames] = useState<Record<string, string>>({});

  // Fetch related data
  useEffect(() => {
    const fetchRelatedData = async () => {
      const schedules = list as ItemType[];
      if (schedules.length === 0) return;

      const subjectIds = Array.from(
        new Set(schedules.map((s) => s.subject_id)),
      );
      const sectionIds = Array.from(
        new Set(schedules.map((s) => s.section_id)),
      );
      // Temporary schedules have no teacher — keep nulls out of the .in() filter
      const teacherIds = Array.from(
        new Set(
          schedules
            .map((s) => s.teacher_id)
            .filter((id): id is string => id != null),
        ),
      );
      const roomIds = Array.from(new Set(schedules.map((s) => s.room_id)));

      // Fetch subjects (school-scoped)
      if (subjectIds.length > 0) {
        let query = supabase
          .from("sms_subjects")
          .select("id, name, code")
          .in("id", subjectIds);
        if (user?.school_id != null) {
          query = query.eq("school_id", user.school_id);
        }
        const { data } = await query;
        if (data) {
          const names: Record<string, string> = {};
          data.forEach((subject) => {
            names[subject.id] = `${subject.code} - ${subject.name}`;
          });
          setSubjectNames(names);
        }
      }

      // Fetch sections (school-scoped)
      if (sectionIds.length > 0) {
        let query = supabase
          .from("sms_sections")
          .select("id, name")
          .in("id", sectionIds);
        if (user?.school_id != null) {
          query = query.eq("school_id", user.school_id);
        }
        const { data } = await query;
        if (data) {
          const names: Record<string, string> = {};
          data.forEach((section) => {
            names[section.id] = section.name;
          });
          setSectionNames(names);
        }
      }

      // Fetch teachers. Deliberately NOT school-scoped: a teacher who has
      // since moved schools still taught this slot, and filtering them out
      // rendered the row as "-" — indistinguishable from an unassigned one.
      if (teacherIds.length > 0) {
        setTeacherNames(await fetchStaffNames(teacherIds));
      }

      // Fetch rooms (school-scoped)
      if (roomIds.length > 0) {
        let query = supabase
          .from("sms_rooms")
          .select("id, name")
          .in("id", roomIds);
        if (user?.school_id != null) {
          query = query.eq("school_id", user.school_id);
        }
        const { data } = await query;
        if (data) {
          const names: Record<string, string> = {};
          data.forEach((room) => {
            names[room.id] = room.name;
          });
          setRoomNames(names);
        }
      }
    };

    fetchRelatedData();
  }, [list, user?.school_id]);

  return (
    <div className="app__table_container">
      <div className="app__table_wrapper">
        <table className="app__table">
          <thead className="app__table_thead">
            <tr>
              <th className="app__table_th">Subject</th>
              <th className="app__table_th">Section</th>
              <th className="app__table_th">Teacher</th>
              <th className="app__table_th">Room</th>
              <th className="app__table_th">Days</th>
              <th className="app__table_th">Time</th>
              <th className="app__table_th">School Year</th>
            </tr>
          </thead>
          <tbody className="app__table_tbody">
            {(list as ItemType[]).map((item: ItemType) => (
              <tr key={item.id} className="app__table_tr">
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {subjectNames[item.subject_id] || "-"}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {sectionNames[item.section_id] || "-"}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {item.teacher_id == null ? (
                        <TemporaryScheduleBadge />
                      ) : (
                        teacherNames[item.teacher_id] || "-"
                      )}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title flex items-center gap-2">
                      {roomNames[item.room_id] || "-"}
                      {item.conflict_override && <SharedSlotBadge />}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="flex flex-wrap gap-1">
                    {(Array.isArray(item.days_of_week) ? item.days_of_week : [])
                      .slice()
                      .sort()
                      .map((day) => (
                      <span
                        key={day}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary"
                      >
                        {formatDays([day])}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title font-mono">
                      {formatTimeRange(item.start_time, item.end_time)}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {item.school_year}
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
