"use client";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  KPI_CYCLES,
  KPI_IQR_MIN_SCHOOLS,
  KPI_LEVELS,
  interpretGpi,
  interpretIqr,
} from "@/lib/constants/kpi";
import {
  buildGradeEfficiency,
  computeIqr,
  formatNumber,
  formatPercent,
  formatRatio,
  genderParityIndex,
  learnerRatio,
  reconstructCohort,
  seatTotal,
  sumFacts,
} from "@/lib/utils/kpi";
import type {
  KpiEnrollmentFact,
  KpiReference,
  KpiResourceFact,
} from "@/types";
import { useMemo, useState } from "react";
import { EmptyNote, IndicatorSection, KpiTable, StatTile } from "./KpiShared";

interface RatioIndicatorsProps {
  current: KpiEnrollmentFact[];
  previous: KpiEnrollmentFact[];
  resources: KpiResourceFact[];
  /** Reference row for the current scope — seats, toilets, overrides. */
  reference: KpiReference | null;
  /** Every school's reference row for this school year, keyed by school id. */
  referenceBySchool: Map<string, KpiReference>;
  isSchoolScope: boolean;
  schoolYear: string;
}

type IqrResource = "teachers" | "classrooms" | "seats";

const IQR_RESOURCE_LABELS: Record<IqrResource, string> = {
  teachers: "Teachers",
  classrooms: "Classrooms",
  seats: "Seats",
};

export function RatioIndicators({
  current,
  previous,
  resources,
  reference,
  referenceBySchool,
  isSchoolScope,
  schoolYear,
}: RatioIndicatorsProps) {
  const [iqrResource, setIqrResource] = useState<IqrResource>("teachers");

  const totalEnrollment = useMemo(
    () => sumFacts(current, "enrollment"),
    [current]
  );

  const derivedTeachers = resources.reduce((sum, r) => sum + r.teachers, 0);
  const derivedClassrooms = resources.reduce((sum, r) => sum + r.classrooms, 0);

  // An override exists only to reconcile against an official release; when it
  // is set it wins, and the derived figure is shown beside it.
  const teachers = reference?.teacher_count_override ?? derivedTeachers;
  const classrooms = reference?.classroom_count_override ?? derivedClassrooms;
  const seats = seatTotal(reference);
  const toilets = reference?.toilet_bowls_functional ?? null;

  const teacherRatio = learnerRatio(totalEnrollment, teachers);
  const classroomRatio = learnerRatio(totalEnrollment, classrooms);
  const seatRatio = learnerRatio(totalEnrollment, seats);
  const toiletRatio = learnerRatio(totalEnrollment, toilets);

  /** Female-to-male enrollment, overall and per level. */
  const gpiRows = useMemo(() => {
    const rows = KPI_LEVELS.map((level) => {
      const female = sumFacts(current, "enrollment", {
        grades: level.grades,
        sex: "female",
      });
      const male = sumFacts(current, "enrollment", {
        grades: level.grades,
        sex: "male",
      });
      const femaleOfficial = sumFacts(current, "enrollment", {
        grades: level.grades,
        ages: [level.ageMin, level.ageMax],
        sex: "female",
      });
      const maleOfficial = sumFacts(current, "enrollment", {
        grades: level.grades,
        ages: [level.ageMin, level.ageMax],
        sex: "male",
      });
      return {
        key: level.key,
        label: level.label,
        female,
        male,
        gpi: genderParityIndex(female, male),
        gpiOfficialAge: genderParityIndex(femaleOfficial, maleOfficial),
      };
    });
    return rows.filter((r) => r.female + r.male > 0);
  }, [current]);

  const overallGpi = genderParityIndex(
    sumFacts(current, "enrollment", { sex: "female" }),
    sumFacts(current, "enrollment", { sex: "male" })
  );

  /** GPI of the completion rate — an efficiency indicator, per the memo. */
  const completionGpiRows = useMemo(
    () =>
      KPI_CYCLES.map((cycle) => {
        const female = reconstructCohort(
          cycle,
          buildGradeEfficiency(cycle, current, previous, "female")
        ).completionRate;
        const male = reconstructCohort(
          cycle,
          buildGradeEfficiency(cycle, current, previous, "male")
        ).completionRate;
        return {
          key: cycle.key,
          label: cycle.label,
          female,
          male,
          gpi: genderParityIndex(female, male),
        };
      }),
    [current, previous]
  );

  const iqr = useMemo(
    () =>
      computeIqr(resources, (fact) => {
        if (iqrResource === "teachers") return fact.teachers;
        if (iqrResource === "classrooms") return fact.classrooms;
        return seatTotal(referenceBySchool.get(fact.school_id) ?? null) ?? 0;
      }),
    [resources, iqrResource, referenceBySchool]
  );

  return (
    <div className="space-y-8">
      <IndicatorSection
        metaKey="ratios"
        title="Learner ratios"
        description={`SY ${schoolYear}, total enrollment ${formatNumber(totalEnrollment)}. Each ratio is total enrollment over the number of units — read as learners per unit.`}
        isSchoolScope={isSchoolScope}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile
            label="Teacher-Learner Ratio"
            value={formatRatio(teacherRatio.value)}
            hint={
              teacherRatio.units === null
                ? "No teachers on record"
                : `${formatNumber(teacherRatio.units)} teachers${
                    reference?.teacher_count_override != null
                      ? ` (override; ${formatNumber(derivedTeachers)} on record)`
                      : ""
                  }`
            }
          />
          <StatTile
            label="Classroom-Learner Ratio"
            value={formatRatio(classroomRatio.value)}
            hint={
              classroomRatio.units === null
                ? "No instructional rooms on record"
                : `${formatNumber(classroomRatio.units)} classrooms${
                    reference?.classroom_count_override != null
                      ? ` (override; ${formatNumber(derivedClassrooms)} on record)`
                      : ""
                  }`
            }
          />
          <StatTile
            label="Seat-Learner Ratio"
            value={formatRatio(seatRatio.value)}
            hint={
              seatRatio.units === null
                ? "Enter the seat inventory in Reference Data"
                : `${formatNumber(seatRatio.units)} seats`
            }
          />
          <StatTile
            label="Toilet Bowl-Learner Ratio"
            value={formatRatio(toiletRatio.value)}
            hint={
              toiletRatio.units === null
                ? "Enter functional toilet bowls in Reference Data"
                : `${formatNumber(toiletRatio.units)} functional bowls`
            }
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Teachers are active staff of type “teacher”; classrooms are active
          rooms of type “classroom”. Seats and toilet bowls have no source in
          the system and come from Reference Data.
        </p>
      </IndicatorSection>

      <IndicatorSection
        metaKey="ratios"
        title="Gender Parity Index"
        description="Female value over male value. Below 0.97 favours males, 0.97–1.03 is parity, above 1.03 favours females."
        isSchoolScope={isSchoolScope}
        actions={
          <Badge variant="outline" className="font-normal">
            Overall GPI: {overallGpi === null ? "—" : overallGpi.toFixed(3)} —{" "}
            {interpretGpi(overallGpi)}
          </Badge>
        }
      >
        {gpiRows.length === 0 ? (
          <EmptyNote>No enrollment for SY {schoolYear}.</EmptyNote>
        ) : (
          <KpiTable
            head={
              <tr>
                <th className="text-left font-medium">Level</th>
                <th className="text-right font-medium">Female</th>
                <th className="text-right font-medium">Male</th>
                <th className="text-right font-medium">
                  GPI (enrollment)
                </th>
                <th className="text-right font-medium">
                  GPI (official age)
                </th>
                <th className="text-left font-medium">
                  Interpretation
                </th>
              </tr>
            }
          >
            {gpiRows.map((row) => (
              <tr key={row.key}>
                <td className="font-medium">{row.label}</td>
                <td className="text-right tabular-nums">
                  {formatNumber(row.female)}
                </td>
                <td className="text-right tabular-nums">
                  {formatNumber(row.male)}
                </td>
                <td className="text-right tabular-nums font-medium">
                  {row.gpi === null ? "—" : row.gpi.toFixed(3)}
                </td>
                <td className="text-right tabular-nums">
                  {row.gpiOfficialAge === null
                    ? "—"
                    : row.gpiOfficialAge.toFixed(3)}
                </td>
                <td className="text-muted-foreground">
                  {interpretGpi(row.gpi)}
                </td>
              </tr>
            ))}
          </KpiTable>
        )}

        <KpiTable
          head={
            <tr>
              <th className="text-left font-medium">
                Completion Rate by sex
              </th>
              <th className="text-right font-medium">Female</th>
              <th className="text-right font-medium">Male</th>
              <th className="text-right font-medium">GPI</th>
              <th className="text-left font-medium">Interpretation</th>
            </tr>
          }
        >
          {completionGpiRows.map((row) => (
            <tr key={row.key}>
              <td className="font-medium">{row.label}</td>
              <td className="text-right tabular-nums">
                {formatPercent(row.female)}
              </td>
              <td className="text-right tabular-nums">
                {formatPercent(row.male)}
              </td>
              <td className="text-right tabular-nums font-medium">
                {row.gpi === null ? "—" : row.gpi.toFixed(3)}
              </td>
              <td className="text-muted-foreground">
                {interpretGpi(row.gpi)}
              </td>
            </tr>
          ))}
        </KpiTable>

        <p className="text-[11px] text-muted-foreground">
          GER and NER are not shown by sex: Reference Data holds one projected
          population per age band, so a sex-disaggregated GER would divide both
          sexes by the same denominator and its GPI would collapse to the
          enrollment GPI already shown above.
        </p>
      </IndicatorSection>

      <IndicatorSection
        metaKey="iqr"
        title="Inter-Quartile Ratio"
        description="Resources held by the most favoured quartile of learners over those held by the least favoured quartile. 1.00–1.30 is equitable distribution."
        isSchoolScope={isSchoolScope}
        actions={
          <div className="w-44">
            <Select
              value={iqrResource}
              onValueChange={(v) => setIqrResource(v as IqrResource)}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(IQR_RESOURCE_LABELS) as IqrResource[]).map(
                  (key) => (
                    <SelectItem key={key} value={key}>
                      {IQR_RESOURCE_LABELS[key]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {!iqr.eligible ? (
          <EmptyNote>
            The IQR needs at least {KPI_IQR_MIN_SCHOOLS} schools with enrollment
            — {iqr.schoolCount} {iqr.schoolCount === 1 ? "school has" : "schools have"}{" "}
            data for SY {schoolYear}. Switch the scope to division-wide to
            compute it.
          </EmptyNote>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <StatTile
                label={`IQR — ${IQR_RESOURCE_LABELS[iqrResource]}`}
                value={iqr.iqr === null ? "—" : iqr.iqr.toFixed(2)}
                hint={interpretIqr(iqr.iqr)}
              />
              <StatTile
                tone="muted"
                label="t(Q1) — most favoured"
                value={formatNumber(iqr.q1Resources, 1)}
                hint="Resources up to the 25% learner mark"
              />
              <StatTile
                tone="muted"
                label="t(Q4) — least favoured"
                value={formatNumber(iqr.q4Resources, 1)}
                hint="Total resources − t(Q3)"
              />
              <StatTile
                tone="muted"
                label="Schools included"
                value={formatNumber(iqr.schoolCount)}
                hint={`${formatNumber(iqr.totalResources)} ${IQR_RESOURCE_LABELS[
                  iqrResource
                ].toLowerCase()}, ${formatNumber(iqr.totalEnrollment)} learners`}
              />
            </div>

            <KpiTable
              head={
                <tr>
                  <th className="text-left font-medium">School</th>
                  <th className="text-right font-medium">
                    Enrollment
                  </th>
                  <th className="text-right font-medium">
                    {IQR_RESOURCE_LABELS[iqrResource]}
                  </th>
                  <th className="text-right font-medium">Ratio</th>
                  <th className="text-right font-medium">
                    CF enrollment
                  </th>
                  <th className="text-right font-medium">
                    % CF enrollment
                  </th>
                  <th className="text-right font-medium">
                    CF {IQR_RESOURCE_LABELS[iqrResource].toLowerCase()}
                  </th>
                </tr>
              }
            >
              {iqr.rows.map((row) => (
                <tr key={row.schoolId}>
                  <td className="font-medium">{row.schoolName}</td>
                  <td className="text-right tabular-nums">
                    {formatNumber(row.enrollment)}
                  </td>
                  <td className="text-right tabular-nums">
                    {formatNumber(row.resources)}
                  </td>
                  <td className="text-right tabular-nums">
                    {Number.isFinite(row.ratio) ? formatRatio(row.ratio) : "—"}
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground">
                    {formatNumber(row.cumulativeEnrollment)}
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground">
                    {row.cumulativeEnrollmentPercent.toFixed(2)}%
                  </td>
                  <td className="text-right tabular-nums text-muted-foreground">
                    {formatNumber(row.cumulativeResources)}
                  </td>
                </tr>
              ))}
            </KpiTable>
            <p className="text-[11px] text-muted-foreground">
              Schools are sorted by learners per unit, best served first, so the
              25% mark falls in the most favoured quartile. Schools with no
              enrollment are excluded.
            </p>
          </>
        )}
      </IndicatorSection>
    </div>
  );
}
