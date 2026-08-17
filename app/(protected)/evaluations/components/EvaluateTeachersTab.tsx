"use client";

import { StarRating } from "@/components/StarRating";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TEACHING_USER_TYPES } from "@/lib/constants";
import { useAppSelector } from "@/lib/redux/hook";
import { supabase } from "@/lib/supabase/client";
import { getCurrentSchoolYear } from "@/lib/utils/schoolYear";
import { Evaluation, EvaluationQuestion } from "@/types";
import {
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  UserCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";

interface Teacher {
  id: string;
  name: string;
}

interface EvaluationWithQuestions extends Evaluation {
  questions: EvaluationQuestion[];
  submittedTeacherIds: Set<string>;
}

export const EvaluateTeachersTab = () => {
  const user = useAppSelector((state) => state.user.user);
  const [loading, setLoading] = useState(true);
  const [evaluations, setEvaluations] = useState<EvaluationWithQuestions[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);

  // Dialog state
  const [selectedEvaluation, setSelectedEvaluation] =
    useState<EvaluationWithQuestions | null>(null);
  const [selectedTeacher, setSelectedTeacher] = useState<Teacher | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const schoolYear = getCurrentSchoolYear();

  const fetchData = useCallback(async () => {
    if (!user?.school_id) return;

    setLoading(true);
    try {
      // Fetch active principal_to_teacher evaluations
      const { data: evals } = await supabase
        .from("sms_evaluations")
        .select("*")
        .eq("school_id", user.school_id)
        .eq("type", "principal_to_teacher")
        .eq("is_active", true)
        .eq("school_year", schoolYear);

      // Fetch teachers in the school. Volunteer teachers stand in front of a
      // class, so the principal evaluates them the same way.
      const { data: teacherData } = await supabase
        .from("sms_users")
        .select("id, name")
        .eq("school_id", user.school_id)
        .in("type", [...TEACHING_USER_TYPES])
        .eq("is_active", true)
        .order("name");

      setTeachers(
        (teacherData || []).map((t) => ({ id: String(t.id), name: t.name || "" })),
      );

      if (!evals || evals.length === 0) {
        setEvaluations([]);
        setLoading(false);
        return;
      }

      const enriched: EvaluationWithQuestions[] = [];

      for (const ev of evals as Evaluation[]) {
        const { data: questions } = await supabase
          .from("sms_evaluation_questions")
          .select("*")
          .eq("evaluation_id", ev.id)
          .order("order_number");

        // Fetch all teacher IDs already evaluated by this principal for this evaluation
        const { data: submitted } = await supabase
          .from("sms_evaluation_responses")
          .select("evaluatee_id")
          .eq("evaluation_id", ev.id)
          .eq("respondent_type", "principal")
          .eq("respondent_id", user.id);

        const submittedTeacherIds = new Set<string>(
          (submitted || []).map((r) => String(r.evaluatee_id)),
        );

        enriched.push({
          ...ev,
          questions: (questions || []) as EvaluationQuestion[],
          submittedTeacherIds,
        });
      }

      setEvaluations(enriched);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load evaluations");
    } finally {
      setLoading(false);
    }
  }, [user?.school_id, user?.id, schoolYear]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleStartEvaluation = (
    ev: EvaluationWithQuestions,
    teacher: Teacher,
  ) => {
    setSelectedEvaluation(ev);
    setSelectedTeacher(teacher);
    setRatings({});
  };

  const handleClose = () => {
    if (!submitting) {
      setSelectedEvaluation(null);
      setSelectedTeacher(null);
      setRatings({});
    }
  };

  const handleSubmit = async () => {
    if (!selectedEvaluation || !selectedTeacher || !user) return;

    const unanswered = selectedEvaluation.questions.filter(
      (q) => !ratings[q.id],
    );
    if (unanswered.length > 0) {
      toast.error("Please rate all questions before submitting");
      return;
    }

    setSubmitting(true);
    try {
      const responses = selectedEvaluation.questions.map((q) => ({
        evaluation_id: selectedEvaluation.id,
        question_id: q.id,
        respondent_type: "principal" as const,
        respondent_id: user.id,
        evaluatee_id: selectedTeacher.id,
        rating: ratings[q.id],
        school_year: schoolYear,
        school_id: user.school_id,
      }));

      const { error } = await supabase
        .from("sms_evaluation_responses")
        .insert(responses);

      if (error) {
        if (error.code === "23505") {
          toast.error("You have already evaluated this teacher");
        } else {
          throw error;
        }
      } else {
        toast.success("Evaluation submitted successfully!");
        const evalId = selectedEvaluation.id;
        const teacherId = selectedTeacher.id;
        handleClose();
        // Mark as submitted locally
        setEvaluations((prev) =>
          prev.map((ev) => {
            if (ev.id !== evalId) return ev;
            const updated = new Set(ev.submittedTeacherIds);
            updated.add(teacherId);
            return { ...ev, submittedTeacherIds: updated };
          }),
        );
      }
    } catch (err) {
      console.error(err);
      toast.error("Failed to submit evaluation");
    } finally {
      setSubmitting(false);
    }
  };

  const allRated =
    selectedEvaluation?.questions.every((q) => ratings[q.id]) ?? false;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (evaluations.length === 0) {
    return (
      <div className="app__empty_state">
        <div className="app__empty_state_icon">
          <ClipboardCheck className="w-12 h-12 mx-auto text-muted-foreground" />
        </div>
        <p className="app__empty_state_title">No evaluations available</p>
        <p className="app__empty_state_description">
          There are no active Principal to Teacher evaluations for {schoolYear}.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {evaluations.map((ev) => (
        <div key={ev.id} className="rounded-xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b">
            <h3 className="text-base font-semibold text-gray-900">
              {ev.title}
            </h3>
            {ev.description && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {ev.description}
              </p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {ev.questions.length} question{ev.questions.length !== 1 ? "s" : ""}{" "}
              &middot; {ev.school_year}
            </p>
          </div>

          {teachers.length === 0 ? (
            <div className="px-5 py-6 text-sm text-muted-foreground">
              No teachers found in this school.
            </div>
          ) : (
            <div className="divide-y">
              {teachers.map((teacher) => {
                const isSubmitted = ev.submittedTeacherIds.has(teacher.id);
                return (
                  <div
                    key={teacher.id}
                    className="flex items-center justify-between px-5 py-3"
                  >
                    <div className="flex items-center gap-2 text-sm text-gray-800">
                      <UserCircle className="h-4 w-4 text-muted-foreground" />
                      {teacher.name}
                    </div>
                    {isSubmitted ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium bg-green-100 text-green-800">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Evaluated
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleStartEvaluation(ev, teacher)}
                        disabled={ev.questions.length === 0}
                      >
                        Evaluate
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      {/* Evaluation Form Dialog */}
      <Dialog open={!!selectedEvaluation} onOpenChange={handleClose}>
        <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-semibold">
              {selectedEvaluation?.title}
            </DialogTitle>
            <DialogDescription>
              Evaluating: {selectedTeacher?.name}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {selectedEvaluation?.questions.map((q, index) => (
              <div key={q.id} className="rounded-lg border p-4 space-y-2">
                <p className="text-sm font-medium text-gray-800">
                  <span className="text-muted-foreground mr-1.5">
                    {index + 1}.
                  </span>
                  {q.question_text}
                </p>
                <StarRating
                  value={ratings[q.id] || 0}
                  onChange={(val) =>
                    setRatings((prev) => ({ ...prev, [q.id]: val }))
                  }
                  size="lg"
                />
              </div>
            ))}
          </div>

          <DialogFooter className="gap-2 sm:gap-2 space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={submitting}
              className="h-10"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || !allRated}
              className="h-10 min-w-[140px]"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Submitting...
                </span>
              ) : (
                "Submit Evaluation"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
