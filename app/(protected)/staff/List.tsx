"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { USER_TYPE_LABELS } from "@/lib/constants";
import { useAppDispatch } from "@/lib/redux/hook";
import { updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { RootState, User } from "@/types"; // Import the RootState type
import { MoreVertical, Pencil, UserMinus, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { useSelector } from "react-redux";
import { AddModal } from "./AddModal";

// Always update this on other pages
type ItemType = User;
const table = "sms_users";

// Helper function to get initials from name
const getInitials = (name: string): string => {
  if (!name) return "?";
  const parts = name.trim().split(" ");
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
};

export const List = () => {
  const dispatch = useAppDispatch();
  const list = useSelector((state: RootState) => state.list.value) as ItemType[];
  const [schoolsMap, setSchoolsMap] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase
      .from("sms_schools")
      .select("id, name")
      .then(({ data }) => {
        const map: Record<string, string> = {};
        data?.forEach((s) => {
          map[String(s.id)] = s.name;
        });
        setSchoolsMap(map);
      });
  }, []);

  const [modalAddOpen, setModalAddOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemType | null>(null);

  const handleEdit = (item: ItemType) => {
    setSelectedItem(item);
    setModalAddOpen(true);
  };

  const handleToggleStatus = async (item: ItemType) => {
    const newActive = !item.is_active;
    const { error } = await supabase
      .from(table)
      .update({ is_active: newActive })
      .eq("id", item.id);

    if (error) {
      toast.error(error.message);
    } else {
      dispatch(updateList({ ...item, is_active: newActive }));
      toast.success(
        newActive ? "Staff member set to Active." : "Staff member set to Inactive."
      );
    }
  };

  return (
    <div className="app__table_container">
      <div className="app__table_wrapper">
        <table className="app__table">
          <thead className="app__table_thead">
            <tr>
              <th className="app__table_th">Name</th>
              <th className="app__table_th">School</th>
              <th className="app__table_th">Type</th>
              <th className="app__table_th">Position</th>
              <th className="app__table_th">Status</th>
              <th className="app__table_th_right">Actions</th>
            </tr>
          </thead>
          <tbody className="app__table_tbody">
            {list.map((item: ItemType) => (
              <tr key={item.id} className="app__table_tr">
                <td className="app__table_td">
                  <div className="app__table_cell_content">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-primary font-medium">
                        {getInitials(item.name || "")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="app__table_cell_text">
                      <div className="app__table_cell_title">
                        {item.name || "-"}
                      </div>
                      <div className="app__table_cell_subtitle">
                        {item.email || "-"}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {item.school_id
                        ? schoolsMap[String(item.school_id)] || item.school_id
                        : "-"}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                    {/* One lookup rather than a chain that had to be extended
                        for every new role — and silently printed "-" for the
                        ones nobody remembered (librarian, guidance, nurse). */}
                    {USER_TYPE_LABELS[item.type ?? ""] ?? "-"}
                  </span>
                </td>
                <td className="app__table_td">
                  <div className="app__table_cell_text">
                    <div className="app__table_cell_title">
                      {item.position || "-"}
                    </div>
                  </div>
                </td>
                <td className="app__table_td">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      item.is_active
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground"
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
                          onClick={() => handleToggleStatus(item)}
                          className="cursor-pointer"
                        >
                          {item.is_active ? (
                            <>
                              <UserMinus className="mr-2 h-4 w-4" />
                              Set Inactive
                            </>
                          ) : (
                            <>
                              <UserPlus className="mr-2 h-4 w-4" />
                              Set Active
                            </>
                          )}
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

      <AddModal
        isOpen={modalAddOpen}
        editData={selectedItem}
        onClose={() => setModalAddOpen(false)}
      />
    </div>
  );
};
