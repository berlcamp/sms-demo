"use client";

import {
  KPI_INTAKE_LEVELS,
  KPI_LEVELS,
  KPI_POPULATION_LABELS,
  KPI_TRANSITIONS,
} from "@/lib/constants/kpi";
import {
  formatNumber,
  formatPercent,
  grossEnrollmentRate,
  grossIntakeRate,
  netEnrollmentRate,
  netIntakeRate,
  sumFacts,
  transitionRate,
} from "@/lib/utils/kpi";
import type { KpiEnrollmentFact, KpiReference } from "@/types";
import { useMemo } from "react";
import { EmptyNote, IndicatorSection, KpiTable } from "./KpiShared";

interface AccessIndicatorsProps {
  current: KpiEnrollmentFact[];
  previous: KpiEnrollmentFact[];
  reference: KpiReference | null;
  schoolYear: string;
  previousSchoolYear: string;
  isSchoolScope: boolean;
}

/** GER − NER is the share of over-aged and under-aged learners (memo p. 6). */
function difference(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

export function AccessIndicators({
  current,
  previous,
  reference,
  schoolYear,
  previousSchoolYear,
  isSchoolScope,
}: AccessIndicatorsProps) {
  const enrollmentRows = useMemo(
    () =>
      KPI_LEVELS.map((level) => {
        const ger = grossEnrollmentRate(level, current, reference);
        const ner = netEnrollmentRate(level, current, reference);
        return { level, ger, ner };
      }),
    [current, reference]
  );

  const intakeRows = useMemo(
    () =>
      KPI_INTAKE_LEVELS.map((intake) => {
        const gir = grossIntakeRate(intake, current, reference);
        const nir = netIntakeRate(intake, current, reference);
        return { intake, gir, nir };
      }),
    [current, reference]
  );

  const transitionRows = useMemo(
    () =>
      KPI_TRANSITIONS.map((transition) => ({
        transition,
        rate: transitionRate(transition, current, previous),
        feedingEnrollment: sumFacts(previous, "enrollment", {
          grades: [transition.fromGrade],
        }),
      })),
    [current, previous]
  );

  const hasPopulation = enrollmentRows.some((r) => r.ger.denominator !== null);

  return (
    <div className="space-y-8">
      {!hasPopulation && (
        <EmptyNote>
          No projected population has been entered for SY {schoolYear}. Open
          <span className="font-medium"> Reference Data</span> to enter the PSA
          figures — every access indicator divides by them.
        </EmptyNote>
      )}

      <IndicatorSection
        metaKey="ger"
        title="Gross and Net Enrollment Rate"
        description={`SY ${schoolYear}. GER counts enrollment regardless of age; NER counts only learners of the official school age. GER − NER is the share of over-aged and under-aged learners.`}
        isSchoolScope={isSchoolScope}
      >
        <KpiTable
          head={
            <tr>
              <th className="text-left font-medium">Level</th>
              <th className="text-left font-medium">Official age</th>
              <th className="text-right font-medium">
                Enrollment (all ages)
              </th>
              <th className="text-right font-medium">
                Enrollment (official age)
              </th>
              <th className="text-right font-medium">Population</th>
              <th className="text-right font-medium">GER</th>
              <th className="text-right font-medium">NER</th>
              <th className="text-right font-medium">GER − NER</th>
            </tr>
          }
        >
          {enrollmentRows.map(({ level, ger, ner }) => (
            <tr key={level.key}>
              <td className="font-medium">{level.label}</td>
              <td className="text-muted-foreground">
                {KPI_POPULATION_LABELS[level.populationKey]}
              </td>
              <td className="text-right tabular-nums">
                {formatNumber(ger.numerator)}
              </td>
              <td className="text-right tabular-nums">
                {formatNumber(ner.numerator)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatNumber(ger.denominator)}
              </td>
              <td className="text-right tabular-nums font-medium">
                {formatPercent(ger.value)}
              </td>
              <td className="text-right tabular-nums font-medium">
                {formatPercent(ner.value)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatPercent(difference(ger.value, ner.value))}
              </td>
            </tr>
          ))}
        </KpiTable>
      </IndicatorSection>

      <IndicatorSection
        metaKey="gir"
        title="Gross and Net Intake Rate"
        description={`SY ${schoolYear}. New entrants = enrollment − repeaters. GIR counts entrants of any age; NIR counts only those of the official school-entrance age, and shall not exceed 100%.`}
        isSchoolScope={isSchoolScope}
      >
        <KpiTable
          head={
            <tr>
              <th className="text-left font-medium">Level</th>
              <th className="text-left font-medium">Entrance age</th>
              <th className="text-right font-medium">New entrants</th>
              <th className="text-right font-medium">
                New entrants (entrance age)
              </th>
              <th className="text-right font-medium">Population</th>
              <th className="text-right font-medium">GIR</th>
              <th className="text-right font-medium">NIR</th>
              <th className="text-right font-medium">GIR − NIR</th>
            </tr>
          }
        >
          {intakeRows.map(({ intake, gir, nir }) => (
            <tr key={intake.key}>
              <td className="font-medium">{intake.label}</td>
              <td className="text-muted-foreground">
                Age {intake.officialAge}
              </td>
              <td className="text-right tabular-nums">
                {formatNumber(gir.numerator)}
              </td>
              <td className="text-right tabular-nums">
                {formatNumber(nir.numerator)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatNumber(gir.denominator)}
              </td>
              <td className="text-right tabular-nums font-medium">
                {formatPercent(gir.value)}
              </td>
              <td className="text-right tabular-nums font-medium">
                {formatPercent(nir.value)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatPercent(difference(gir.value, nir.value))}
              </td>
            </tr>
          ))}
        </KpiTable>
      </IndicatorSection>

      <IndicatorSection
        metaKey="transition"
        title="Transition Rate"
        description={`New entrants to the next grade in SY ${schoolYear} over enrollment in the feeding grade in SY ${previousSchoolYear}.`}
        isSchoolScope={isSchoolScope}
      >
        <KpiTable
          head={
            <tr>
              <th className="text-left font-medium">Transition</th>
              <th className="text-right font-medium">
                New entrants (SY {schoolYear})
              </th>
              <th className="text-right font-medium">
                Enrollment (SY {previousSchoolYear})
              </th>
              <th className="text-right font-medium">
                Transition Rate
              </th>
            </tr>
          }
        >
          {transitionRows.map(({ transition, rate, feedingEnrollment }) => (
            <tr key={transition.key}>
              <td className="font-medium">{transition.label}</td>
              <td className="text-right tabular-nums">
                {formatNumber(rate.numerator)}
              </td>
              <td className="text-right tabular-nums text-muted-foreground">
                {formatNumber(feedingEnrollment)}
              </td>
              <td className="text-right tabular-nums font-medium">
                {formatPercent(rate.value)}
              </td>
            </tr>
          ))}
        </KpiTable>
        <p className="text-[11px] text-muted-foreground">
          A blank rate means there was no enrollment in the feeding grade in SY{" "}
          {previousSchoolYear}.
        </p>
      </IndicatorSection>
    </div>
  );
}
