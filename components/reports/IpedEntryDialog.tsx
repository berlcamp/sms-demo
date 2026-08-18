"use client";

/**
 * The typed half of one school's IPEd Program Data Set row.
 *
 * These columns are in a dialog rather than inline in the table because the
 * printed form is fifty columns wide — an inline input grid at that width is
 * unusable at any screen size, and the twenty numeric cells here are two
 * matrices that only read correctly when laid out as matrices.
 *
 * The derived figures are shown alongside as read-only context (the teacher
 * headcount by sex, the enrolment) so whoever is typing the IP split can see
 * the total it has to reconcile against.
 */

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
import { Textarea } from "@/components/ui/textarea";
import {
  IPED_BANDS,
  IPED_HALVES,
  IPED_TEACHER_CELLS,
  IPED_TEXT_FIELDS,
  orientedKey,
  type IpedEntryNumericKey,
  type IpedEntryTextKey,
} from "@/lib/constants/iped";
import { supabase } from "@/lib/supabase/client";
import { useAppSelector } from "@/lib/redux/hook";
import type { IpedProgramFact, IpedReportEntry } from "@/types";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

/** Every typed cell, held as the raw string the user is editing. */
type DraftNumbers = Partial<Record<IpedEntryNumericKey, string>>;
type DraftTexts = Partial<Record<IpedEntryTextKey, string>>;

/** "" / "not answered" is a real state and must round-trip as NULL, not 0. */
function toNumberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : null;
}

function fromNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

const IMPLEMENTING_UNANSWERED = "unanswered";

const ORIENTED_BLOCKS = [
  {
    block: "teachers_oriented" as const,
    label: "Total No. of Teachers Oriented on IPEd Program (CUMULATIVE)",
  },
  {
    block: "heads_oriented" as const,
    label: "Total No. of School Heads Oriented on IPEd Program (CUMULATIVE)",
  },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fiscalYear: number;
  fact: IpedProgramFact | null;
  entry: IpedReportEntry | null;
  onSaved: () => void;
}

export function IpedEntryDialog({
  open,
  onOpenChange,
  fiscalYear,
  fact,
  entry,
  onSaved,
}: Props) {
  const user = useAppSelector((state) => state.user.user);
  const [numbers, setNumbers] = useState<DraftNumbers>({});
  const [texts, setTexts] = useState<DraftTexts>({});
  const [implementing, setImplementing] = useState(IMPLEMENTING_UNANSWERED);
  const [saving, setSaving] = useState(false);

  // Reseed whenever a different school's row is opened. Nothing is carried
  // over from the previous school — a stale draft would silently write one
  // school's figures onto another.
  useEffect(() => {
    if (!open) return;
    const nextNumbers: DraftNumbers = {};
    IPED_TEACHER_CELLS.forEach((c) => {
      nextNumbers[c.key] = fromNumber(entry?.[c.key]);
    });
    ORIENTED_BLOCKS.forEach(({ block }) => {
      IPED_HALVES.forEach((half) => {
        IPED_BANDS.forEach((band) => {
          const key = orientedKey(block, half.value, band.value);
          nextNumbers[key] = fromNumber(entry?.[key]);
        });
      });
    });
    nextNumbers.contextualized_resources = fromNumber(
      entry?.contextualized_resources,
    );
    setNumbers(nextNumbers);

    const nextTexts: DraftTexts = {};
    IPED_TEXT_FIELDS.forEach((f) => {
      nextTexts[f.key] = entry?.[f.key] ?? "";
    });
    setTexts(nextTexts);

    setImplementing(
      entry?.implementing_iped === true
        ? "yes"
        : entry?.implementing_iped === false
          ? "no"
          : IMPLEMENTING_UNANSWERED,
    );
  }, [open, entry]);

  const setNumber = (key: IpedEntryNumericKey, value: string) =>
    setNumbers((prev) => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    if (!fact) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        school_id: Number(fact.school_id),
        fiscal_year: fiscalYear,
        implementing_iped:
          implementing === IMPLEMENTING_UNANSWERED ? null : implementing === "yes",
        updated_by_user_id: user?.system_user_id
          ? Number(user.system_user_id)
          : null,
      };
      (Object.keys(numbers) as IpedEntryNumericKey[]).forEach((key) => {
        payload[key] = toNumberOrNull(numbers[key]);
      });
      IPED_TEXT_FIELDS.forEach((f) => {
        const value = (texts[f.key] ?? "").trim();
        payload[f.key] = value === "" ? null : value;
      });

      const { error } = await supabase
        .from("sms_iped_report_entries")
        .upsert(payload, { onConflict: "school_id,fiscal_year" });
      if (error) throw new Error(error.message);

      toast.success("Saved");
      onSaved();
      onOpenChange(false);
    } catch (err) {
      console.error("Error saving IPEd entry:", err);
      toast.error(
        err instanceof Error ? err.message : "Failed to save the entry.",
      );
    } finally {
      setSaving(false);
    }
  };

  const derivedTeacherTotal =
    (fact?.teachers_male ?? 0) + (fact?.teachers_female ?? 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{fact?.school_name ?? "School"}</DialogTitle>
          <DialogDescription>
            IPEd Program Data Set FY {fiscalYear} — the columns the system
            cannot derive. Leave a cell blank to leave it blank on the form; a
            blank is not a zero.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Implementing IPEd — also selects the A / B half of the matrices. */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Implementing IPEd</Label>
            <Select value={implementing} onValueChange={setImplementing}>
              <SelectTrigger className="h-9 w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yes">Yes</SelectItem>
                <SelectItem value="no">No</SelectItem>
                <SelectItem value={IMPLEMENTING_UNANSWERED}>
                  Not answered
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              This also decides which half of the matrices below the school
              reports under — A. IPEd Implementing Schools, or B. Schools
              Serving IP Learners. Left unanswered, it reports under neither.
            </p>
          </div>

          {/* Teachers by sex x IP. */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Total No. of Teachers
            </Label>
            <p className="text-[11px] text-muted-foreground">
              The system holds {derivedTeacherTotal} active teacher
              {derivedTeacherTotal === 1 ? "" : "s"} for this school (
              {fact?.teachers_male ?? 0} male, {fact?.teachers_female ?? 0}{" "}
              female), but records no IP status for staff, so all four cells are
              typed.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {IPED_TEACHER_CELLS.map((cell) => (
                <div key={cell.key} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {cell.sex} · {cell.ip}
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    className="h-9"
                    value={numbers[cell.key] ?? ""}
                    onChange={(e) => setNumber(cell.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* The two cumulative orientation matrices. */}
          {ORIENTED_BLOCKS.map(({ block, label }) => (
            <div key={block} className="space-y-2">
              <Label className="text-sm font-medium">{label}</Label>
              <div className="overflow-x-auto border rounded-md">
                <table className="text-sm border-collapse min-w-full">
                  <thead>
                    <tr className="bg-muted/60">
                      <th className="border px-3 py-2 text-left" />
                      {IPED_BANDS.map((b) => (
                        <th key={b.value} className="border px-2 py-2 w-24">
                          {b.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {IPED_HALVES.map((half) => (
                      <tr key={half.value}>
                        <td className="border px-3 py-1.5 text-xs whitespace-nowrap">
                          {half.label}
                        </td>
                        {IPED_BANDS.map((band) => {
                          const key = orientedKey(block, half.value, band.value);
                          return (
                            <td key={band.value} className="border px-1 py-1">
                              <Input
                                type="number"
                                min={0}
                                className="h-8 text-center"
                                value={numbers[key] ?? ""}
                                onChange={(e) => setNumber(key, e.target.value)}
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <div className="space-y-1.5">
            <Label className="text-sm font-medium">
              Total No. of Contextualized Teaching and Learning Resources
              (CUMULATIVE)
            </Label>
            <Input
              type="number"
              min={0}
              className="h-9 w-full sm:w-48"
              value={numbers.contextualized_resources ?? ""}
              onChange={(e) =>
                setNumber("contextualized_resources", e.target.value)
              }
            />
          </div>

          {IPED_TEXT_FIELDS.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label className="text-sm font-medium">{field.label}</Label>
              <Textarea
                rows={3}
                value={texts[field.key] ?? ""}
                onChange={(e) =>
                  setTexts((prev) => ({ ...prev, [field.key]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !fact}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
