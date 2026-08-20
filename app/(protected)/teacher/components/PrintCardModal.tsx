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
import { Label } from "@/components/ui/label";
import { DEFAULT_CORE_VALUES } from "@/lib/constants/reportCardCoreValues";
import {
  generateReportCardPrint,
  type CoreValuesData,
  type ReportCardDesign,
} from "@/lib/pdf/generateReportCard";
import { supabase } from "@/lib/supabase/client";
import { isTermBasedSchoolYear } from "@/lib/utils/schoolYear";
import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

interface PrintCardModalProps {
  isOpen: boolean;
  onClose: () => void;
  studentId: string;
  studentName: string;
  schoolId: string;
  sectionId: string;
  schoolYear: string;
}

export function PrintCardModal({
  isOpen,
  onClose,
  studentId,
  studentName,
  schoolId,
  sectionId,
  schoolYear,
}: PrintCardModalProps) {
  // A term-based school year (SY 2026-2027 onward) is the MATATAG curriculum,
  // whose card carries three terms — the two legacy designs print four
  // quarter columns and would leave one permanently blank. Default to the
  // matching design; a stored choice still wins over it.
  const defaultDesign: ReportCardDesign = isTermBasedSchoolYear(schoolYear)
    ? "matatag"
    : "3-fold";
  const [design, setDesign] = useState<ReportCardDesign>(defaultDesign);
  const [printing, setPrinting] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    setLoading(true);
    supabase
      .from("sms_report_card_core_values")
      .select("card_design")
      .eq("student_id", studentId)
      .eq("school_year", schoolYear)
      .maybeSingle()
      .then(({ data }) => {
        if (!isMounted) return;
        setDesign((data?.card_design as ReportCardDesign) ?? defaultDesign);
        setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen, studentId, schoolYear, defaultDesign]);

  const handlePrint = async () => {
    setPrinting(true);
    try {
      const { data: row, error: fetchError } = await supabase
        .from("sms_report_card_core_values")
        .select("core_values, card_design")
        .eq("student_id", studentId)
        .eq("school_year", schoolYear)
        .maybeSingle();

      if (fetchError) {
        console.error("PrintCardModal fetch:", fetchError);
        toast.error("Could not load report card data");
        return;
      }

      const coreValues =
        (row?.core_values as CoreValuesData) ?? DEFAULT_CORE_VALUES;

      const { error: upsertError } = await supabase
        .from("sms_report_card_core_values")
        .upsert(
          {
            student_id: Number(studentId),
            school_id: schoolId,
            school_year: schoolYear,
            core_values: coreValues,
            card_design: design,
          },
          { onConflict: "student_id,school_year" },
        );

      if (upsertError) {
        console.error("PrintCardModal upsert:", upsertError);
        toast.error("Could not save card design before printing");
        return;
      }

      await generateReportCardPrint({
        schoolId,
        studentId,
        sectionId,
        schoolYear,
        coreValues,
        design,
      });
    } catch (error) {
      console.error("Error generating report card:", error);
      toast.error("Failed to generate report card");
    } finally {
      setPrinting(false);
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Print Report Card</DialogTitle>
          <DialogDescription>{studentName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label className="text-sm font-medium">Card Design</Label>
          <p className="text-xs text-muted-foreground">
            Core values are edited from{" "}
            <span className="font-medium text-foreground">Core Values Entry</span>{" "}
            in the student menu. They are included automatically when you print.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={design === "matatag" ? "default" : "outline"}
              size="sm"
              onClick={() => setDesign("matatag")}
              disabled={loading}
            >
              MATATAG (2 Fold)
            </Button>
            <Button
              type="button"
              variant={design === "3-fold" ? "default" : "outline"}
              size="sm"
              onClick={() => setDesign("3-fold")}
              disabled={loading}
            >
              3 Fold
            </Button>
            <Button
              type="button"
              variant={design === "2-fold" ? "default" : "outline"}
              size="sm"
              onClick={() => setDesign("2-fold")}
              disabled={loading}
            >
              2 Fold
            </Button>
          </div>
          {design === "matatag" ? (
            <p className="text-xs text-muted-foreground">
              Learner&rsquo;s Performance Report &mdash; one folded sheet. Learning
              areas come from the grade level&rsquo;s subjects, and the period
              columns follow the school year (
              {isTermBasedSchoolYear(schoolYear) ? "3 terms" : "4 quarters"}).
              Core values are not part of this form.
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={printing || loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handlePrint()}
            disabled={printing || loading}
          >
            <Printer className="mr-2 h-4 w-4" />
            {printing ? "Printing..." : "Print"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
