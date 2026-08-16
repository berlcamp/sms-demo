"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { addItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import {
  isValidRoomDimension,
  normalizeRoomDimension,
  roomDimensionArea,
} from "@/lib/utils/roomDimension";
import { Room } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";

type ItemType = Room;
const table = "sms_rooms";
const title = "Room";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  editData?: ItemType | null;
}

const FormSchema = z.object({
  name: z.string().min(1, "Room name is required"),
  building: z.string().optional(),
  capacity: z
    .number()
    .min(1, "Capacity must be at least 1")
    .optional()
    .or(z.literal("")),
  dimension: z
    .string()
    .optional()
    .refine((v) => !v || !v.trim() || isValidRoomDimension(v), {
      message: 'Use width x length in meters, e.g. "40x30"',
    }),
  room_type: z
    .enum([
      "classroom",
      "laboratory",
      "library",
      "gym",
      "auditorium",
      "computer_lab",
      "science_lab",
      "music_room",
      "art_room",
      "other",
    ])
    .optional(),
  condition: z
    .enum([
      "good",
      "needs_minor_repair",
      "needs_major_repair",
      "condemned",
    ])
    .optional(),
  description: z.string().optional(),
  is_active: z.boolean().default(true),
});

type FormType = z.infer<typeof FormSchema>;

export const AddModal = ({ isOpen, onClose, editData }: ModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const hasResetForEditRef = useRef<string | null>(null);

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);

  const form = useForm<FormType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: "",
      building: "",
      capacity: undefined,
      dimension: "",
      room_type: undefined,
      condition: undefined,
      description: "",
      is_active: true,
    },
  });

  // Reset form when modal opens or when editData changes
  useEffect(() => {
    if (!isOpen) {
      hasResetForEditRef.current = null;
      return;
    }

    if (editData?.id) {
      const editId = editData.id;
      if (hasResetForEditRef.current !== editId) {
        form.reset({
          name: editData.name || "",
          building: editData.building || "",
          capacity: editData.capacity || undefined,
          dimension: editData.dimension || "",
          room_type: (editData.room_type as FormType["room_type"]) || undefined,
          condition: (editData.condition as FormType["condition"]) || undefined,
          description: editData.description || "",
          is_active: editData.is_active ?? true,
        });
        hasResetForEditRef.current = editId;
      }
    } else if (!editData && hasResetForEditRef.current !== "add") {
      form.reset({
        name: "",
        building: "",
        capacity: undefined,
        dimension: "",
        room_type: undefined,
        condition: undefined,
        description: "",
        is_active: true,
      });
      hasResetForEditRef.current = "add";
    }
  }, [form, editData, isOpen]);

  const onSubmit = async (data: FormType) => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const newData = {
        name: data.name.trim(),
        building: data.building?.trim() || null,
        capacity: data.capacity && data.capacity > 0 ? data.capacity : null,
        dimension: data.dimension?.trim()
          ? normalizeRoomDimension(data.dimension)
          : null,
        room_type: data.room_type || null,
        condition: data.condition || null,
        description: data.description?.trim() || null,
        is_active: data.is_active,
        ...(user?.school_id != null && { school_id: user.school_id }),
      };

      if (editData?.id) {
        let updateQuery = supabase
          .from(table)
          .update(newData)
          .eq("id", editData.id);
        if (user?.school_id != null) {
          updateQuery = updateQuery.eq("school_id", user.school_id);
        }
        const { error } = await updateQuery;

        if (error) throw new Error(error.message);

        let selectQuery = supabase
          .from(table)
          .select()
          .eq("id", editData.id);
        if (user?.school_id != null) {
          selectQuery = selectQuery.eq("school_id", user.school_id);
        }
        const { data: updated } = await selectQuery.single();

        if (updated) {
          dispatch(updateList(updated));
        }

        onClose();
        toast.success("Room updated successfully!");
      } else {
        const { data: inserted, error } = await supabase
          .from(table)
          .insert([newData])
          .select()
          .single();

        if (error) {
          if (error.code === "23505") {
            toast.error("Room name already exists");
            setIsSubmitting(false);
            return;
          }
          throw new Error(error.message);
        }

        if (inserted) {
          dispatch(addItem(inserted));
        }
        onClose();
        toast.success("Room added successfully!");
      }
    } catch (err) {
      console.error("Submission error:", err);
      toast.error(err instanceof Error ? err.message : "Error saving room");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!isSubmitting) {
      form.reset();
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {editData ? "Edit" : "Add"} {title}
          </DialogTitle>
          <DialogDescription>
            {editData
              ? "Update room information below."
              : "Fill in the details to add a new room."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Room Name <span className="text-red-500">*</span>
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Room 101, Lab A"
                        className="h-10"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="building"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Building
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Main Building"
                        className="h-10"
                        {...field}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="room_type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Room Type
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select room type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="classroom">Classroom</SelectItem>
                        <SelectItem value="laboratory">Laboratory</SelectItem>
                        <SelectItem value="library">Library</SelectItem>
                        <SelectItem value="gym">Gym</SelectItem>
                        <SelectItem value="auditorium">Auditorium</SelectItem>
                        <SelectItem value="computer_lab">
                          Computer Lab
                        </SelectItem>
                        <SelectItem value="science_lab">Science Lab</SelectItem>
                        <SelectItem value="music_room">Music Room</SelectItem>
                        <SelectItem value="art_room">Art Room</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Capacity
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="e.g., 30"
                        className="h-10"
                        {...field}
                        onChange={(e) => {
                          const value = e.target.value;
                          field.onChange(
                            value === "" ? undefined : parseInt(value, 10),
                          );
                        }}
                        value={field.value || ""}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Maximum number of seats
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="dimension"
              render={({ field }) => {
                const area = roomDimensionArea(field.value);
                return (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Dimension (meters)
                    </FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., 40x30"
                        className="h-10"
                        {...field}
                        value={field.value ?? ""}
                        disabled={isSubmitting}
                      />
                    </FormControl>
                    <FormDescription className="text-xs">
                      Width x length in meters
                      {area !== null ? ` — ${area} sq m` : ""}. Printed as the
                      Classroom Size column of the Classroom Enrollment and Size
                      report.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />

            <FormField
              control={form.control}
              name="condition"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Condition
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select condition" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="good">Good</SelectItem>
                      <SelectItem value="needs_minor_repair">
                        Needs Minor Repair
                      </SelectItem>
                      <SelectItem value="needs_major_repair">
                        Needs Major Repair
                      </SelectItem>
                      <SelectItem value="condemned">Condemned</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    Used by the Classroom Needs Analysis report.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Description
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter room description (optional)"
                      className="min-h-[80px]"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 sm:gap-2 space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
                className="h-10"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="h-10 min-w-[100px]"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {editData ? "Updating..." : "Saving..."}
                  </span>
                ) : editData ? (
                  "Update"
                ) : (
                  "Save"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
