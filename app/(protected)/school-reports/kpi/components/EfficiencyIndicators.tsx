"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getGradeLevelLabel } from "@/lib/constants";
import { KPI_CYCLES, idealYearsInput } from "@/lib/constants/kpi";
import {
  buildGradeEfficiency,
  formatNumber,
  formatPercent,
  oldMethodCohortSurvival,
  oldMethodCompletionRate,
  oldMethodPromotionRate,
  percent,
  reconstructCohort,
  shiftSchoolYear,
  sumFacts,
} from "@/lib/utils/kpi";
import type { KpiEnrollmentFact } from "@/types";
import { useMemo, useState } from "react";
import { EmptyNote, IndicatorSection, KpiTable, StatTile } from "./KpiShared";

interface EfficiencyIndicatorsProps {
  current: KpiEnrollmentFact[];
  previous: KpiEnrollmentFact[];
  /** Fact tables keyed by school year, for the old-method cohort lags. */
  lagged: Record<string, KpiEnrollmentFact[]>;
  schoolYear: string;
  previousSchoolYear: string;
  isSchoolScope: boolean;
}

/** Kindergarten through Grade 12 — repetition and dropout cover every grade. */
const ALL_GRADES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export function EfficiencyIndicators({
  current,
  previous,
  lagged,
  schoolYear,
  previousSchoolYear,
  isSchoolScope,
}: EfficiencyIndicatorsProps) {
  const [cycleKey, setCycleKey] = useState(KPI_CYCLES[0].key);
  const cycle = KPI_CYCLES.find((c) => c.key === cycleKey) ?? KPI_CYCLES[0];

  const rows = useMemo(
    () => buildGradeEfficiency(cycle, current, previous),
    [cycle, current, previous]
  );

  const cohort = useMemo(() => reconstructCohort(cycle, rows), [cycle, rows]);

  const laggedYear = shiftSchoolYear(schoolYear, cycle.lagYears);
  // Memoised so the fallback [] does not make a new array on every render and
  // re-run the two cohort computations below.
  const laggedFacts = useMemo(
    () => lagged[laggedYear] ?? [],
    [lagged, laggedYear]
  );

  const oldCsr = useMemo(
    () => oldMethodCohortSurvival(cycle, current, laggedFacts),
    [cycle, current, laggedFacts]
  );
  const oldCompletion = useMemo(
    () => oldMethodCompletionRate(cycle, current, laggedFacts),
    [cycle, current, laggedFacts]
  );

  /** Repetition and simple dropout, every grade — both valid at school level. */
  const allGradeRows = useMemo(
    () =>
      ALL_GRADES.map((grade) => {
        const enrollmentPrevious = sumFacts(previous, "enrollment", {
          grades: [grade],
        });
        const enrollmentCurrent = sumFacts(current, "enrollment", {
          grades: [grade],
        });
        const repeaters = sumFacts(current, "repeaters", { grades: [grade] });
        const dropouts = sumFacts(current, "dropouts", { grades: [grade] });
        return {
          grade,
          enrollmentPrevious,
          enrollmentCurrent,
          repeaters,
          dropouts,
          repetitionRate: percent(
            repeaters,
            enrollmentPrevious > 0 ? enrollmentPrevious : null
          ),
          simpleDropoutRate: percent(
            dropouts,
            enrollmentCurrent > 0 ? enrollmentCurrent : null
          ),
        };
      }).filter((r) => r.enrollmentCurrent > 0 || r.enrollmentPrevious > 0),
    [current, previous]
  );

  const survivalByGrade = new Map(
    cohort.survivalRates.map((s) => [s.gradeLevel, s.value])
  );
  const pupilYearsByGrade = new Map(
    cohort.pupilYears.map((s) => [s.gradeLevel, s.value])
  );

  const hasPreviousYear = previous.length > 0;

  return (
    <div className="space-y-8">
      <div className="flex items-end gap-3 flex-wrap">
        <div className="w-full sm:w-80">
          <label className="text-sm font-medium mb-1.5 block">
            Education cycle
          </label>
          <Select value={cycleKey} onValueChange={setCycleKey}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {KPI_CYCLES.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Drives the cohort model and the survival / completion rates below.
          </p>
        </div>
      </div>

      {!hasPreviousYear && (
        <EmptyNote>
          No enrollment found for SY {previousSchoolYear}. The reconstructed
          cohort method needs two consecutive school years, so the rates below
          will read “—” until the previous year has enrollment records.
        </EmptyNote>
      )}

      <IndicatorSection
        metaKey="promotion"
        title="Reconstructed cohort — promotion, repetition and school leaver rates"
        description={`Rates for SY ${schoolYear} against BOSY enrollment in SY ${previousSchoolYear}. The three rates sum to 100% by construction. For ${getGradeLevelLabel(cycle.finalGrade)} the promotion rate is the ${cycle.graduates ? "graduation" : "completion"} rate.`}
        isSchoolScope={isSchoolScope}
      >
        <KpiTable
          head={
            <tr>
              <th className="text-left font-medium">Grade</th>
              <th className="text-right font-medium">
                Enrollment SY {previousSchoolYear}
              </th>
              <th className="text-right font-medium">
                Repeaters SY {schoolYear}
              </th>
              <th className="text-right font-medium">Promotion</th>
              <th className="text-right font-medium">Repetition</th>
              <th className="text-right font-medium">School leaver</th>
              <th className="text-right font-medium">Survival</th>
              <th className="text-right font-medium">Pupil-years</th>
            </tr>
          }
        >
          {rows.map((row) => (
            <tr key={row.gradeLevel}>
              <td className="font-medium">
                {getGradeLevelLabel(row.gradeLevel)}
                {row.isTerminal && (
                  <span className="ml-1.5 text-[10px] text-muted-foreground">
                    ({cycle.graduates ? "graduation" : "completion"})
                  </span>
                )}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatNumber(row.enrollmentPrevious)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatNumber(row.repeatersCurrent)}
              </td>
              <td className="text-right tabular-nums font-medium">
                {formatPercent(row.promotionRate)}
              </td>
              <td className="text-right tabular-nums">
                {formatPercent(row.repetitionRate)}
              </td>
              <td className="text-right tabular-nums">
                {formatPercent(row.schoolLeaverRate)}
              </td>
              <td className="text-right tabular-nums">
                {formatPercent(survivalByGrade.get(row.gradeLevel) ?? null)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatNumber(pupilYearsByGrade.get(row.gradeLevel) ?? null)}
              </td>
            </tr>
          ))}
        </KpiTable>
        <p className="text-[11px] text-muted-foreground">
          Survival and pupil-years come from a notional cohort of 1,000 learners
          followed through the rates above, with repetition capped at 3 — the
          UNESCO Institute for Statistics model the memo&apos;s template is built
          on.
        </p>
      </IndicatorSection>

      <IndicatorSection
        metaKey="cohort_survival"
        title="Cohort survival, completion and efficiency"
        description={`Reconstructed cohort, ${cycle.label}.`}
        isSchoolScope={isSchoolScope}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Cohort Survival Rate"
            value={formatPercent(cohort.cohortSurvivalRate)}
            hint={`Reaching ${getGradeLevelLabel(cycle.finalGrade)}`}
          />
          <StatTile
            label="Completion Rate"
            value={formatPercent(cohort.completionRate)}
            hint={`${cycle.graduates ? "Graduating from" : "Completing"} ${getGradeLevelLabel(cycle.finalGrade)}`}
          />
          <StatTile
            label="Coefficient of Efficiency"
            value={formatPercent(cohort.coefficientOfEfficiency)}
            hint={`${formatNumber(cohort.totalPupilYears)} pupil-years spent`}
          />
          <StatTile
            label="Years Input per Graduate"
            value={formatNumber(cohort.yearsInputPerGraduate, 1)}
            hint={`Ideal: ${idealYearsInput(cycle)} years`}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          CSR − CompR ={" "}
          {formatPercent(
            cohort.cohortSurvivalRate !== null && cohort.completionRate !== null
              ? cohort.cohortSurvivalRate - cohort.completionRate
              : null
          )}{" "}
          — the share of the cohort that reached the final grade but did not
          complete it.
          {cohort.incomplete && (
            <>
              {" "}
              Some grades had no enrollment in SY {previousSchoolYear}; their
              rates were treated as zero in the model, so these figures
              understate the cohort.
            </>
          )}
        </p>
      </IndicatorSection>

      <IndicatorSection
        metaKey="repetition"
        title="Repetition Rate and Simple Dropout Rate — all grade levels"
        description={`Repetition: repeaters in SY ${schoolYear} over BOSY enrollment in SY ${previousSchoolYear}. Simple dropout: EOSY dropouts over BOSY enrollment, both SY ${schoolYear}. Both are computed at school level.`}
        isSchoolScope={isSchoolScope}
      >
        {allGradeRows.length === 0 ? (
          <EmptyNote>No enrollment records for these school years.</EmptyNote>
        ) : (
          <KpiTable
            head={
              <tr>
                <th className="text-left font-medium">Grade</th>
                <th className="text-right font-medium">
                  Enrollment SY {previousSchoolYear}
                </th>
                <th className="text-right font-medium">Repeaters</th>
                <th className="text-right font-medium">
                  Repetition Rate
                </th>
                <th className="text-right font-medium">
                  Enrollment SY {schoolYear}
                </th>
                <th className="text-right font-medium">Dropouts</th>
                <th className="text-right font-medium">
                  Simple Dropout Rate
                </th>
              </tr>
            }
          >
            {allGradeRows.map((row) => (
              <tr key={row.grade}>
                <td className="font-medium">
                  {getGradeLevelLabel(row.grade)}
                </td>
                <td className="text-right tabular-nums text-muted-foreground">
                  {formatNumber(row.enrollmentPrevious)}
                </td>
                <td className="text-right tabular-nums">
                  {formatNumber(row.repeaters)}
                </td>
                <td className="text-right tabular-nums font-medium">
                  {formatPercent(row.repetitionRate)}
                </td>
                <td className="text-right tabular-nums text-muted-foreground">
                  {formatNumber(row.enrollmentCurrent)}
                </td>
                <td className="text-right tabular-nums">
                  {formatNumber(row.dropouts)}
                </td>
                <td className="text-right tabular-nums font-medium">
                  {formatPercent(row.simpleDropoutRate)}
                </td>
              </tr>
            ))}
          </KpiTable>
        )}
        <p className="text-[11px] text-muted-foreground">
          The simple dropout rate is not the school leaver rate: it excludes
          learners who finish a grade but fail to enroll the following year.
        </p>
      </IndicatorSection>

      <IndicatorSection
        metaKey="completion"
        title="Old method — promotion, graduation, survival and completion"
        description={`The conventions used before the reconstructed cohort method. Promotion and graduation use EOSY outcomes over BOSY enrollment in the same year; survival and completion follow the cohort that entered ${getGradeLevelLabel(cycle.entryGrade)} in SY ${laggedYear}.`}
        isSchoolScope={isSchoolScope}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <StatTile
            tone="muted"
            label={`Cohort Survival Rate (old method)`}
            value={formatPercent(oldCsr.value)}
            hint={`${formatNumber(oldCsr.numerator)} in ${getGradeLevelLabel(cycle.finalGrade)} now ÷ ${formatNumber(oldCsr.denominator)} in ${getGradeLevelLabel(cycle.entryGrade)} in SY ${laggedYear}`}
          />
          <StatTile
            tone="muted"
            label={`Completion Rate (old method)`}
            value={formatPercent(oldCompletion.value)}
            hint={`${formatNumber(oldCompletion.numerator)} ${cycle.graduates ? "graduates" : "completers"} ÷ ${formatNumber(oldCompletion.denominator)} entrants in SY ${laggedYear}`}
          />
        </div>

        <KpiTable
          head={
            <tr>
              <th className="text-left font-medium">Grade</th>
              <th className="text-right font-medium">
                BOSY enrollment SY {schoolYear}
              </th>
              <th className="text-right font-medium">
                EOSY promotes / graduates
              </th>
              <th className="text-right font-medium">
                Promotion / Graduation Rate
              </th>
            </tr>
          }
        >
          {cycle.grades.map((grade) => {
            const isTerminal = grade === cycle.finalGrade;
            const result = oldMethodPromotionRate(grade, current, {
              graduation: isTerminal && cycle.graduates,
            });
            return (
              <tr key={grade}>
                <td className="font-medium">
                  {getGradeLevelLabel(grade)}
                  {isTerminal && (
                    <span className="ml-1.5 text-[10px] text-muted-foreground">
                      ({cycle.graduates ? "graduation" : "completion"})
                    </span>
                  )}
                </td>
                <td className="text-right tabular-nums text-muted-foreground">
                  {formatNumber(result.denominator)}
                </td>
                <td className="text-right tabular-nums">
                  {formatNumber(result.numerator)}
                </td>
                <td className="text-right tabular-nums font-medium">
                  {formatPercent(result.value)}
                </td>
              </tr>
            );
          })}
        </KpiTable>
        <p className="text-[11px] text-muted-foreground">
          Old-method rates read as “—” until the school year&apos;s end-of-year
          outcomes are recorded: promotes, graduates and dropouts come from each
          learner&apos;s final enrollment status.
        </p>
      </IndicatorSection>
    </div>
  );
}
