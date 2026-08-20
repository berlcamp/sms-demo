"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  philIriDefaultQuestionType,
  philIriQuestionCount,
  PHILIRI_COMPREHENSION_QUESTIONS,
  PHILIRI_MISCUE_TYPES,
  PHILIRI_SELF_CORRECTION,
  PHILIRI_QUESTION_TYPE_ABBR,
  PHILIRI_QUESTION_TYPE_LABELS,
  PHILIRI_QUESTION_TYPES,
  type PhilIriQuestionType,
} from "@/lib/constants";
import { PhilIriMaterial, PhilIriComprehensionAnswer } from "@/types";
import { Check, X } from "lucide-react";
import { computeIndividual, PhilIriIndividual, rawCorrectOf } from "../philiriUtils";

export interface PassageFormValue {
  minutes: number | null;
  seconds: number | null;
  // Per-question comprehension result (q1..qn), typed for the ISR (Form 4).
  answers: Record<string, PhilIriComprehensionAnswer>;
  miscues: Record<string, number | null>;
  dateAssessed: string;
  remarks: string;
}

export const emptyMiscues = (): Record<string, number | null> =>
  Object.fromEntries(
    [...PHILIRI_MISCUE_TYPES.map((m) => m.key), PHILIRI_SELF_CORRECTION.key].map(
      (k) => [k, null],
    ),
  );

/**
 * Blank q1..qn answer map for a passage with `count` questions, pre-typed with
 * the default L/I/C spread. The count comes from the material (migration 152) —
 * it is NOT a fixed 7, since DepEd's graded passages differ per grade and set.
 */
export const emptyAnswers = (
  count: number = PHILIRI_COMPREHENSION_QUESTIONS,
): Record<string, PhilIriComprehensionAnswer> =>
  Object.fromEntries(
    Array.from({ length: Math.max(1, Math.trunc(count)) }, (_, i) => [
      `q${i + 1}`,
      { correct: null, type: philIriDefaultQuestionType(i, count) },
    ]),
  );

export const emptyPassageValue = (
  count: number = PHILIRI_COMPREHENSION_QUESTIONS,
): PassageFormValue => ({
  minutes: null,
  seconds: null,
  answers: emptyAnswers(count),
  miscues: emptyMiscues(),
  dateAssessed: "",
  remarks: "",
});

/**
 * Question keys of a passage form value, ordered q1..qn. Read off the value
 * itself rather than off the material, so a read SAVED against a different
 * question count still renders every mark the teacher made.
 */
export function questionKeysOf(v: PassageFormValue): string[] {
  return Object.keys(v.answers).sort(
    (a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")),
  );
}

export function totalSecondsOf(v: PassageFormValue): number | null {
  return v.minutes === null && v.seconds === null
    ? null
    : (v.minutes ?? 0) * 60 + (v.seconds ?? 0);
}

export function passageComputed(
  material: PhilIriMaterial,
  v: PassageFormValue,
): PhilIriIndividual {
  // Raw comprehension score is derived from the per-question ✓ marks, over the
  // number of questions the form actually carries — which for a saved read is
  // the count it was scored against, not the material's current count.
  return computeIndividual(
    Number(material.word_count),
    v.miscues,
    rawCorrectOf(v.answers),
    questionKeysOf(v).length || philIriQuestionCount(material),
    totalSecondsOf(v),
  );
}

interface Props {
  material: PhilIriMaterial;
  value: PassageFormValue;
  onChange: (patch: Partial<PassageFormValue>) => void;
  disabled?: boolean;
}

/**
 * Presentational field set for one graded-passage read (Phil-IRI Form 3A/3B).
 * Fully controlled — the parent owns state and persistence; this only renders
 * inputs + the live-computed results for the given material. Each comprehension
 * question is marked correct/incorrect and typed (Literal / Inferential /
 * Critical) so the Individual Summary Record (Form 4) can be derived from it.
 */
export function PhilIriPassageFields({
  material,
  value,
  onChange,
  disabled,
}: Props) {
  const computed = passageComputed(material, value);
  const rawCorrect = rawCorrectOf(value.answers);
  const questionKeys = questionKeysOf(value);
  const questionTotal = questionKeys.length || philIriQuestionCount(material);

  const setMiscue = (key: string, raw: string) =>
    onChange({
      miscues: {
        ...value.miscues,
        [key]: raw === "" ? null : Math.max(0, Math.trunc(Number(raw) || 0)),
      },
    });

  const answerOf = (q: string): PhilIriComprehensionAnswer =>
    value.answers[q] ?? { correct: null, type: "literal" };

  const patchAnswer = (q: string, patch: Partial<PhilIriComprehensionAnswer>) =>
    onChange({
      answers: { ...value.answers, [q]: { ...answerOf(q), ...patch } },
    });

  return (
    <div className="space-y-6">
      {/* PART A — Comprehension */}
      <section className="space-y-3">
        <p className="text-sm font-semibold border-b pb-1">
          Part A — Comprehension
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <Label className="mb-1 block text-xs">Time — minutes</Label>
            <Input
              type="number"
              min={0}
              value={value.minutes === null ? "" : value.minutes}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  minutes:
                    e.target.value === ""
                      ? null
                      : Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                })
              }
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Time — seconds</Label>
            <Input
              type="number"
              min={0}
              max={59}
              value={value.seconds === null ? "" : value.seconds}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  seconds:
                    e.target.value === ""
                      ? null
                      : Math.min(
                          59,
                          Math.max(0, Math.trunc(Number(e.target.value) || 0)),
                        ),
                })
              }
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Reading rate (wpm)</Label>
            <Input value={computed.readingRate ?? "-"} disabled readOnly />
          </div>
          <div>
            <Label className="mb-1 block text-xs">
              Score (of {questionTotal})
            </Label>
            <Input
              value={`${rawCorrect}/${questionTotal}`}
              disabled
              readOnly
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-muted px-3 py-1">
            Comprehension: {computed.comprehensionScore ?? "-"}
            {computed.comprehensionScore !== null ? "%" : ""}
          </span>
          <span className="rounded-full bg-muted px-3 py-1">
            Level: {computed.comprehensionLevel ?? "-"}
          </span>
        </div>
        <div>
          <Label className="mb-1 block text-xs">
            Responses to Questions{" "}
            <span className="font-normal text-muted-foreground">
              (mark correct / wrong and set the question type)
            </span>
          </Label>
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60">
                  <th className="px-3 py-1.5 text-left w-12">#</th>
                  <th className="px-2 py-1.5 text-center w-32">Response</th>
                  <th className="px-2 py-1.5 text-left">
                    Type of Question{" "}
                    <span className="font-normal text-muted-foreground">
                      (L / I / C)
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {questionKeys.map((q, i) => {
                  const a = answerOf(q);
                  return (
                    <tr key={q} className="border-t">
                      <td className="px-3 py-1 text-muted-foreground">
                        {i + 1}.
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant={a.correct === true ? "green" : "outline"}
                            className="h-7 w-7"
                            disabled={disabled}
                            title="Correct"
                            onClick={() =>
                              patchAnswer(q, {
                                correct: a.correct === true ? null : true,
                              })
                            }
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant={a.correct === false ? "destructive" : "outline"}
                            className="h-7 w-7"
                            disabled={disabled}
                            title="Wrong"
                            onClick={() =>
                              patchAnswer(q, {
                                correct: a.correct === false ? null : false,
                              })
                            }
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                      <td className="px-2 py-1">
                        <Select
                          value={a.type}
                          disabled={disabled}
                          onValueChange={(v) =>
                            patchAnswer(q, { type: v as PhilIriQuestionType })
                          }
                        >
                          <SelectTrigger className="h-8 w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {PHILIRI_QUESTION_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {PHILIRI_QUESTION_TYPE_ABBR[t]} —{" "}
                                {PHILIRI_QUESTION_TYPE_LABELS[t]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* PART B — Word Reading */}
      <section className="space-y-3">
        <p className="text-sm font-semibold border-b pb-1">
          Part B — Word Reading (Pagbasa)
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span>
            <span className="text-muted-foreground">Seleksyon (Selection): </span>
            <span className="font-medium">{material.title}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Level: </span>
            <span className="font-medium">{material.grade_level}</span>
          </span>
          <span>
            <span className="text-muted-foreground">Set: </span>
            <span className="font-medium">{material.set_label ?? "-"}</span>
          </span>
        </div>
        <div className="rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/60">
                <th className="px-3 py-1.5 text-left">
                  Types of Miscues{" "}
                  <span className="font-normal italic text-muted-foreground">
                    (Uri ng Mali)
                  </span>
                </th>
                <th className="px-3 py-1.5 text-center w-32">
                  Number of Miscues
                </th>
              </tr>
            </thead>
            <tbody>
              {PHILIRI_MISCUE_TYPES.map((mt, i) => (
                <tr key={mt.key} className="border-t">
                  <td className="px-3 py-1">
                    {i + 1}. {mt.en}{" "}
                    <span className="italic text-muted-foreground">
                      ({mt.fil})
                    </span>
                  </td>
                  <td className="p-0 text-center">
                    <Input
                      type="number"
                      min={0}
                      className="h-8 w-full rounded-none border-0 text-center"
                      value={value.miscues[mt.key] === null ? "" : value.miscues[mt.key]!}
                      disabled={disabled}
                      onChange={(e) => setMiscue(mt.key, e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                    />
                  </td>
                </tr>
              ))}
              <tr className="border-t bg-muted/30 font-medium">
                <td className="px-3 py-1">Total Miscues (Kabuuan)</td>
                <td className="px-3 py-1 text-center">
                  {computed.totalMiscues ?? "-"}
                </td>
              </tr>
              {/* Tallied on the form and on the reading-profile matrix, but not
                  counted as a miscue — sits below the total for that reason. */}
              <tr className="border-t">
                <td className="px-3 py-1">
                  {PHILIRI_SELF_CORRECTION.en}{" "}
                  <span className="italic text-muted-foreground">
                    ({PHILIRI_SELF_CORRECTION.fil})
                  </span>{" "}
                  <span className="text-xs text-muted-foreground">
                    — not counted as a miscue
                  </span>
                </td>
                <td className="p-0 text-center">
                  <Input
                    type="number"
                    min={0}
                    className="h-8 w-full rounded-none border-0 text-center"
                    value={
                      value.miscues[PHILIRI_SELF_CORRECTION.key] === null ||
                      value.miscues[PHILIRI_SELF_CORRECTION.key] === undefined
                        ? ""
                        : value.miscues[PHILIRI_SELF_CORRECTION.key]!
                    }
                    disabled={disabled}
                    onChange={(e) =>
                      setMiscue(PHILIRI_SELF_CORRECTION.key, e.target.value)
                    }
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </td>
              </tr>
              <tr className="border-t">
                <td className="px-3 py-1">Number of Words in the Passage</td>
                <td className="px-3 py-1 text-center">{material.word_count}</td>
              </tr>
              <tr className="border-t">
                <td className="px-3 py-1">Word Reading Score</td>
                <td className="px-3 py-1 text-center">
                  {computed.wordReadingScore === null
                    ? "-"
                    : `${computed.wordReadingScore}%`}
                </td>
              </tr>
              <tr className="border-t font-medium">
                <td className="px-3 py-1">
                  Word Reading Level (Antas ng Pagbasa)
                </td>
                <td className="px-3 py-1 text-center">
                  {computed.wordReadingLevel ?? "-"}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
            Overall Reading Level: {computed.overallReadingLevel ?? "-"}
          </span>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label className="mb-1 block text-xs">Date assessed</Label>
          <Input
            type="date"
            value={value.dateAssessed}
            disabled={disabled}
            onChange={(e) => onChange({ dateAssessed: e.target.value })}
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs">Remarks</Label>
          <Input
            value={value.remarks}
            disabled={disabled}
            onChange={(e) => onChange({ remarks: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
