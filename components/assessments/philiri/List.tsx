"use client";

import { ConfirmationModal } from "@/components/ConfirmationModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getGradeLevelLabel, philIriQuestionCount } from "@/lib/constants";
import { useAppDispatch } from "@/lib/redux/hook";
import { deleteItem } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { PhilIriMaterial } from "@/types";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { AddModal } from "./AddModal";

type ItemType = PhilIriMaterial;
const table = "sms_philiri_materials";

const CANNOT_DELETE_MESSAGE =
  "Cannot delete: this material already has recorded learner results.";

export const List = ({ schoolId }: { schoolId: number | null }) => {
  const dispatch = useAppDispatch();
  const list = useSelector(
    (state: { list: { value: ItemType[] } }) => state.list.value,
  );

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemType | null>(null);
  const [recordCount, setRecordCount] = useState<Record<string, number>>({});

  const fetchRecordCounts = useCallback(async () => {
    const ids = (list as ItemType[]).map((m) => String(m.id)).filter(Boolean);
    if (ids.length === 0) {
      setRecordCount({});
      return;
    }
    const { data } = await supabase
      .from("sms_philiri_records")
      .select("material_id")
      .in("material_id", ids);
    const counts: Record<string, number> = {};
    (data ?? []).forEach((row) => {
      const mid = String(row.material_id);
      counts[mid] = (counts[mid] ?? 0) + 1;
    });
    setRecordCount(counts);
  }, [list]);

  useEffect(() => {
    fetchRecordCounts();
  }, [fetchRecordCounts]);

  const handleDeleteConfirmation = (item: ItemType) => {
    if ((recordCount[String(item.id)] ?? 0) > 0) {
      toast.error(CANNOT_DELETE_MESSAGE);
      return;
    }
    setSelectedItem(item);
    setIsModalOpen(true);
  };

  const handleEdit = (item: ItemType) => {
    setSelectedItem(item);
    setModalAddOpen(true);
  };

  const handleDelete = async () => {
    if (!selectedItem) return;
    const { error } = await supabase
      .from(table)
      .delete()
      .eq("id", selectedItem.id);
    if (error) {
      toast.error(error.code === "23503" ? CANNOT_DELETE_MESSAGE : error.message);
    } else {
      toast.success("Successfully deleted!");
      dispatch(deleteItem(selectedItem));
      setIsModalOpen(false);
    }
  };

  return (
    <div className="app__table_container">
      <div className="app__table_wrapper">
        <table className="app__table">
          <thead className="app__table_thead">
            <tr>
              <th className="app__table_th">Title</th>
              <th className="app__table_th">Grade</th>
              <th className="app__table_th">Language</th>
              <th className="app__table_th">Set</th>
              <th className="app__table_th">Words</th>
              <th className="app__table_th">Questions</th>
              <th className="app__table_th">File</th>
              <th className="app__table_th">Status</th>
              <th className="app__table_th_right">Actions</th>
            </tr>
          </thead>
          <tbody className="app__table_tbody">
            {(list as ItemType[]).map((item) => (
              <tr key={item.id} className="app__table_tr">
                <td className="app__table_td">
                  <div className="app__table_cell_title">{item.title}</div>
                </td>
                <td className="app__table_td">
                  {getGradeLevelLabel(item.grade_level)}
                </td>
                <td className="app__table_td">{item.language}</td>
                <td className="app__table_td">{item.set_label ?? "-"}</td>
                <td className="app__table_td">{item.word_count}</td>
                <td className="app__table_td">
                  {philIriQuestionCount(item)}
                </td>
                <td className="app__table_td">
                  {item.file_url ? (
                    <a
                      href={item.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      View
                    </a>
                  ) : (
                    "-"
                  )}
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
                      <DropdownMenuContent align="end" className="w-44">
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
                          disabled={(recordCount[String(item.id)] ?? 0) > 0}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {(recordCount[String(item.id)] ?? 0) > 0
                            ? "Has recorded results"
                            : "Delete"}
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
        message="Are you sure you want to delete this Phil-IRI material?"
      />
      <AddModal
        isOpen={modalAddOpen}
        schoolId={schoolId}
        editData={selectedItem}
        onClose={() => {
          setModalAddOpen(false);
          setSelectedItem(null);
        }}
      />
    </div>
  );
};
