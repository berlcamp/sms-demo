// components/AddItemTypeModal.tsx
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
import {
  DEFAULT_STAFF_CATEGORY,
  SCHOOL_STAFF_USER_TYPES,
  USER_TYPE_LABELS,
  isLoginDisabledUserType,
  isTeacherRole,
} from "@/lib/constants";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { addItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { User } from "@/types";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { z } from "zod";

// Always update this on other pages
type ItemType = User;
const table = "sms_users";
const title = "Staff";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  editData?: ItemType | null; // Optional prop for editing existing item
}

const FormSchema = z.object({
  name: z.string().min(1, "Name is required"),
  employee_id: z.string().optional(),
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  position: z.string().optional(),
  type: z.enum(SCHOOL_STAFF_USER_TYPES, {
    required_error: "Staff type is required",
  }),
  staff_category_code: z
    .enum([
      "admin",
      "utility",
      "security",
      "health",
      "library",
      "guidance",
      "other",
      "teacher",
    ])
    .optional(),
});

type FormType = z.infer<typeof FormSchema>;

export const AddModal = ({ isOpen, onClose, editData }: ModalProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);

  const form = useForm<FormType>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: editData ? editData.name : "",
      employee_id: editData?.employee_id ?? "",
      email: editData ? editData.email : "",
      position: editData?.position ?? "",
      type: (editData?.type as FormType["type"]) || undefined,
      staff_category_code:
        (editData?.staff_category_code as FormType["staff_category_code"]) || undefined,
    },
  });

  // Submit handler
  const onSubmit = async (data: FormType) => {
    if (isSubmitting) return; // 🚫 Prevent double-submit
    setIsSubmitting(true);

    try {
      // The role often implies the category the Non-Teaching Personnel report
      // needs; fall back to it rather than filing the person under nothing.
      const derivedCategory = isTeacherRole(data.type)
        ? "teacher"
        : data.staff_category_code ||
          DEFAULT_STAFF_CATEGORY[data.type] ||
          null;
      const newData = {
        name: data.name.trim(),
        email: data.email.trim().toLowerCase(),
        type: data.type,
        staff_category_code: derivedCategory,
        position: data.position?.trim() || null,
        ...(user?.school_id != null && { school_id: user.school_id }),
        ...(data.employee_id?.trim() && { employee_id: data.employee_id.trim() }),
      };

      // 🔹 Step 4: Insert or Update logic
      if (editData?.id) {
        const { error } = await supabase
          .from(table)
          .update(newData)
          .eq("id", editData.id);

        if (error) {
          if (
            error.code === "23505" &&
            error.message?.includes("sms_users_email_key")
          ) {
            form.setError("email", {
              type: "manual",
              message: "Email already exists",
            });
            return;
          }
          throw new Error(error.message);
        }

        // ✅ Fetch updated record
        const { data: updated } = await supabase
          .from(table)
          .select()
          .eq("id", editData.id)
          .single();

        if (updated) {
          dispatch(updateList(updated));
        }

        onClose();
        toast.success("Staff member updated successfully!");
      } else {
        const { data: inserted, error } = await supabase
          .from(table)
          .insert([newData])
          .select()
          .single();

        if (error) {
          if (
            error.code === "23505" &&
            error.message?.includes("sms_users_email_key")
          ) {
            form.setError("email", {
              type: "manual",
              message: "Email already exists",
            });
            return;
          }
          throw new Error(error.message);
        }

        if (inserted) {
          dispatch(addItem(inserted));
        }
        onClose();
        toast.success("Staff member added successfully!");
      }
    } catch (err) {
      console.error("Submission error:", err);
      toast.error(err instanceof Error ? err.message : "Error saving staff member");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      form.clearErrors();
      form.reset({
        name: editData?.name || "",
        employee_id: editData?.employee_id ?? "",
        email: editData?.email || "",
        position: editData?.position ?? "",
        type: (editData?.type as FormType["type"]) || undefined,
        staff_category_code:
          (editData as unknown as { staff_category_code?: FormType["staff_category_code"] })
            ?.staff_category_code || undefined,
      });
    }
  }, [form, editData, isOpen]);

  const handleClose = () => {
    if (!isSubmitting) {
      form.reset();
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {editData ? "Edit" : "Add"} {title}
          </DialogTitle>
          <DialogDescription>
            {editData
              ? "Update staff member information below."
              : "Fill in the details to add a new staff member."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Staff Name <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter full name"
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
              name="employee_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Employee ID
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter employee ID"
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Email Address <span className="text-red-500">*</span>
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="staff@example.com"
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
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Staff Type <span className="text-red-500">*</span>
                  </FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isSubmitting}
                  >
                    <FormControl>
                      <SelectTrigger className="h-10">
                        <SelectValue placeholder="Select staff type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SCHOOL_STAFF_USER_TYPES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {USER_TYPE_LABELS[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription className="text-xs">
                    {isLoginDisabledUserType(field.value)
                      ? "Personnel record only — this role cannot sign in to the system."
                      : "Select the role/type for this staff member."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="position"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm font-medium">
                    Position / Designation
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Teacher III, Assistant School Head"
                      className="h-10"
                      {...field}
                      disabled={isSubmitting}
                    />
                  </FormControl>
                  <FormDescription className="text-xs">
                    Optional. Enter &quot;Assistant School Head&quot; (or
                    &quot;Assistant Principal&quot;) to count this person under
                    Assistant School Head on the dashboard.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {form.watch("type") && !isTeacherRole(form.watch("type")) && (
              <FormField
                control={form.control}
                name="staff_category_code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium">
                      Staff Category
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isSubmitting}
                    >
                      <FormControl>
                        <SelectTrigger className="h-10">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="admin">Administrative</SelectItem>
                        <SelectItem value="utility">Utility</SelectItem>
                        <SelectItem value="security">Security</SelectItem>
                        <SelectItem value="health">Health Services</SelectItem>
                        <SelectItem value="library">Library</SelectItem>
                        <SelectItem value="guidance">Guidance</SelectItem>
                        <SelectItem value="other">Other Non-Teaching</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription className="text-xs">
                      Used by the Division Non-Teaching Personnel report.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
