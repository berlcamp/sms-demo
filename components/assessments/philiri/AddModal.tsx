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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  getGradeLevelLabel,
  PHILIRI_COMPREHENSION_QUESTIONS,
  PHILIRI_GRADES,
  PHILIRI_LANGUAGES,
  PHILIRI_QUESTION_COUNT_MAX,
  PHILIRI_QUESTION_COUNT_MIN,
} from "@/lib/constants";
import { useAppDispatch, useAppSelector } from "@/lib/redux/hook";
import { addItem, updateList } from "@/lib/redux/listSlice";
import { supabase } from "@/lib/supabase/client";
import { PhilIriMaterial } from "@/types";
import { FileText, Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

// 10 MB upload cap for the material file.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Owning school; null authors a division-wide material. */
  schoolId: number | null;
  editData?: PhilIriMaterial | null;
}

export const AddModal = ({
  isOpen,
  onClose,
  schoolId,
  editData,
}: ModalProps) => {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.user.user);

  const [isSubmitting, setIsSubmitting] = useState(false);

  const [title, setTitle] = useState("");
  const [gradeLevel, setGradeLevel] = useState("");
  const [language, setLanguage] = useState("");
  const [setLabel, setSetLabel] = useState("");
  const [wordCount, setWordCount] = useState(0);
  const [questionCount, setQuestionCount] = useState(
    PHILIRI_COMPREHENSION_QUESTIONS,
  );
  const [instructions, setInstructions] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    if (editData?.id) {
      setTitle(editData.title || "");
      setGradeLevel(String(editData.grade_level));
      setLanguage(editData.language || "");
      setSetLabel(editData.set_label || "");
      setWordCount(editData.word_count || 0);
      setQuestionCount(
        editData.question_count || PHILIRI_COMPREHENSION_QUESTIONS,
      );
      setInstructions(editData.instructions || "");
      setIsActive(editData.is_active ?? true);
      setFileUrl(editData.file_url || null);
      setFileName(editData.file_name || null);
      setFile(null);
    } else {
      setTitle("");
      setGradeLevel("");
      setLanguage("");
      setSetLabel("");
      setWordCount(0);
      setQuestionCount(PHILIRI_COMPREHENSION_QUESTIONS);
      setInstructions("");
      setIsActive(true);
      setFileUrl(null);
      setFileName(null);
      setFile(null);
    }
  }, [isOpen, editData]);

  const onSubmit = async () => {
    if (isSubmitting) return;
    if (!title.trim()) return toast.error("Title is required.");
    if (!gradeLevel) return toast.error("Grade level is required.");
    if (!language) return toast.error("Language is required.");
    if (!wordCount || wordCount <= 0)
      return toast.error("Passage word count must be greater than 0.");
    if (
      questionCount < PHILIRI_QUESTION_COUNT_MIN ||
      questionCount > PHILIRI_QUESTION_COUNT_MAX
    )
      return toast.error(
        `Number of comprehension questions must be between ${PHILIRI_QUESTION_COUNT_MIN} and ${PHILIRI_QUESTION_COUNT_MAX}.`,
      );
    if (!file && !fileUrl)
      return toast.error("Upload the material file (image or PDF).");

    setIsSubmitting(true);
    try {
      const payload = {
        title: title.trim(),
        grade_level: Number(gradeLevel),
        language,
        set_label: setLabel.trim() || null,
        word_count: wordCount,
        question_count: questionCount,
        instructions: instructions.trim() || null,
        is_active: isActive,
      };

      let materialId: string;
      if (editData?.id) {
        const { error } = await supabase
          .from("sms_philiri_materials")
          .update(payload)
          .eq("id", editData.id);
        if (error) throw new Error(error.message);
        materialId = String(editData.id);
      } else {
        const { data: inserted, error } = await supabase
          .from("sms_philiri_materials")
          .insert([
            {
              ...payload,
              school_id: schoolId,
              created_by: user?.system_user_id ?? null,
            },
          ])
          .select()
          .single();
        if (error) throw new Error(error.message);
        materialId = String(inserted.id);
      }

      // Upload a newly selected material file (image/PDF), if any.
      let savedFileUrl = fileUrl;
      let savedFileName = fileName;
      if (file) {
        const ext = file.name.split(".").pop() || "bin";
        const path = `philiri-materials/${materialId}/material_${Date.now()}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("school-management")
          .upload(path, file, { upsert: true, contentType: file.type });
        if (uploadErr) throw new Error(uploadErr.message);
        const { data: pub } = supabase.storage
          .from("school-management")
          .getPublicUrl(path);
        savedFileUrl = pub.publicUrl;
        savedFileName = file.name;
      }

      const { error: fileErr } = await supabase
        .from("sms_philiri_materials")
        .update({ file_url: savedFileUrl, file_name: savedFileName })
        .eq("id", materialId);
      if (fileErr) throw new Error(fileErr.message);

      const { data: fresh } = await supabase
        .from("sms_philiri_materials")
        .select("*")
        .eq("id", materialId)
        .single();
      if (fresh) {
        dispatch(editData?.id ? updateList(fresh) : addItem(fresh));
      }

      toast.success(editData ? "Material updated!" : "Material added!");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving material");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(o) => !o && !isSubmitting && onClose()}>
      <DialogContent className="sm:max-w-[640px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            {editData ? "Edit" : "Add"} Phil-IRI Material
          </DialogTitle>
          <DialogDescription>
            Upload the DepEd Phil-IRI material (image or PDF) and describe it for
            one grade level and language. Section advisers download this file and
            record the class screening results.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label className="mb-1.5 block">
                Title <span className="text-red-500">*</span>
              </Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Phil-IRI Grade 4 English — Set A"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">
                Grade Level <span className="text-red-500">*</span>
              </Label>
              <Select
                value={gradeLevel}
                onValueChange={setGradeLevel}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  {PHILIRI_GRADES.map((g) => (
                    <SelectItem key={g} value={String(g)}>
                      {getGradeLevelLabel(g)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">
                Language <span className="text-red-500">*</span>
              </Label>
              <Select
                value={language}
                onValueChange={setLanguage}
                disabled={isSubmitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {PHILIRI_LANGUAGES.map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block">Set label</Label>
              <Input
                value={setLabel}
                onChange={(e) => setSetLabel(e.target.value)}
                placeholder="e.g., Set A"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">
                Passage word count <span className="text-red-500">*</span>
              </Label>
              <Input
                type="number"
                min={1}
                value={wordCount}
                onChange={(e) => setWordCount(Number(e.target.value || 0))}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <Label className="mb-1.5 block">
                Comprehension questions <span className="text-red-500">*</span>
              </Label>
              <Input
                type="number"
                min={PHILIRI_QUESTION_COUNT_MIN}
                max={PHILIRI_QUESTION_COUNT_MAX}
                value={questionCount}
                onChange={(e) =>
                  setQuestionCount(
                    Number(e.target.value || PHILIRI_COMPREHENSION_QUESTIONS),
                  )
                }
                disabled={isSubmitting}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                How many questions this passage asks on Form 3A/3B. Changing it
                does not rescore passage reads already recorded.
              </p>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={isSubmitting}
              />
              <Label>Active</Label>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 block">
              Material file (image / PDF) <span className="text-red-500">*</span>
            </Label>
            {file || fileUrl ? (
              <div className="flex h-10 items-center gap-2 rounded-md border px-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                {file ? (
                  <span className="min-w-0 flex-1 truncate text-sm" title={file.name}>
                    {file.name}
                  </span>
                ) : (
                  <a
                    href={fileUrl ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 truncate text-sm text-primary hover:underline"
                    title={fileName ?? "View file"}
                  >
                    {fileName ?? "View file"}
                  </a>
                )}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="ml-auto h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    setFile(null);
                    setFileUrl(null);
                    setFileName(null);
                  }}
                  disabled={isSubmitting}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <label
                className={`flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 text-sm text-muted-foreground hover:bg-muted/50 ${
                  isSubmitting ? "pointer-events-none opacity-50" : ""
                }`}
              >
                <Upload className="h-4 w-4 shrink-0" />
                <span className="truncate">Upload image / PDF</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  disabled={isSubmitting}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    if (f.size > MAX_FILE_BYTES) {
                      toast.error("File must be 10 MB or smaller.");
                      return;
                    }
                    setFile(f);
                  }}
                />
              </label>
            )}
          </div>

          <div>
            <Label className="mb-1.5 block">Instructions</Label>
            <Textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Administration notes…"
              rows={3}
              disabled={isSubmitting}
            />
          </div>
        </div>

        <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 gap-2 border-t bg-background px-6 py-4 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting}
            className="min-w-[100px]"
          >
            {isSubmitting ? "Saving…" : editData ? "Update" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
