// Grouping the four MAPEH components into one printed subject (migration 153).
//
// Shared by the report card (lib/pdf/generateReportCard.ts) and SF9
// (lib/pdf/generateSf9.ts), which fetch identically shaped rows and, before
// this, each carried its own copy of the flat layout and the flat average.
// One implementation so the two forms cannot drift apart again — the same
// reason migration 128 collapsed the two GPA code paths into one.
//
// The parent MAPEH row is computed here and never stored. Its grade for a
// quarter is the mean of whichever components have a grade for that quarter:
// a card printed mid-year shows a MAPEH grade built from the components
// encoded so far, matching how the existing per-subject final already
// averages whichever quarters exist rather than waiting for all four.
//
// Rounding happens at every level, which is what the rest of the card does
// and what a teacher reproduces by hand from the printed numbers.

import { getMapehComponent, MAPEH_LABEL, mapehComponentRank } from "@/lib/constants/mapeh";

/** DepEd passing mark. */
export const PASSING_GRADE = 75;

/** One subject as fetched from sms_grades + sms_subjects, before grouping. */
export interface MapehSourceRow {
  name: string;
  /** Used for print order; falls back to the name when absent */
  code?: string | null;
  is_madrasah: boolean;
  mapeh_component?: string | null;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
}

/** One printed line. `header` is the computed MAPEH row, `sub` its breakdown. */
export interface CardSubjectRow {
  name: string;
  kind: "plain" | "header" | "sub";
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
  /** Mean of the quarters present, rounded; null when nothing is encoded */
  final: number | null;
  remarks: string;
  /**
   * Whether this line's final feeds the general average. False for the four
   * component rows — the header row carries them, once — and false for
   * madrasah/ALS subjects, which have been out of the average since 076.
   */
  countsTowardAverage: boolean;
}

const mean = (values: number[]): number =>
  values.reduce((a, b) => a + b, 0) / values.length;

const roundedMean = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v != null);
  return present.length >= 1 ? Math.round(mean(present)) : null;
};

const remarksFor = (final: number | null): string =>
  final === null ? "" : final >= PASSING_GRADE ? "Passed" : "Failed";

const sortKeyOf = (row: MapehSourceRow): string =>
  (row.code || row.name || "").toLowerCase();

function toCardRow(
  name: string,
  kind: CardSubjectRow["kind"],
  quarters: (number | null)[],
  countsTowardAverage: boolean,
): CardSubjectRow {
  const [q1, q2, q3, q4] = quarters;
  const final = roundedMean(quarters);
  return {
    name,
    kind,
    q1: q1 ?? null,
    q2: q2 ?? null,
    q3: q3 ?? null,
    q4: q4 ?? null,
    final,
    remarks: remarksFor(final),
    countsTowardAverage,
  };
}

/**
 * Order the subjects for print and fold any tagged MAPEH components into a
 * computed parent row followed by its breakdown.
 *
 * Subjects sort by code — matching every other subject list in the app — and
 * the MAPEH block sits where its first component would have fallen. Before
 * this the report card imposed no subject order at all, so the print order was
 * the insertion order of sms_grades and could change when a teacher re-encoded.
 */
export function buildCardSubjectRows(sourceRows: MapehSourceRow[]): CardSubjectRow[] {
  const components = sourceRows.filter((r) => getMapehComponent(r) !== null);
  const others = sourceRows.filter((r) => getMapehComponent(r) === null);

  const blocks: { sortKey: string; rows: CardSubjectRow[] }[] = others.map((row) => ({
    sortKey: sortKeyOf(row),
    rows: [toCardRow(row.name, "plain", [row.q1, row.q2, row.q3, row.q4], !row.is_madrasah)],
  }));

  if (components.length > 0) {
    // Each quarter of the parent is the mean of the components that have a
    // grade for it, so a half-encoded quarter still prints a figure.
    const parentQuarters = ([1, 2, 3, 4] as const).map((q) =>
      roundedMean(components.map((r) => r[`q${q}` as "q1" | "q2" | "q3" | "q4"])),
    );

    const ordered = [...components].sort((a, b) => {
      const rank = mapehComponentRank(getMapehComponent(a)) - mapehComponentRank(getMapehComponent(b));
      return rank !== 0 ? rank : sortKeyOf(a).localeCompare(sortKeyOf(b));
    });

    blocks.push({
      // Anchor the block where its earliest component would have sorted.
      sortKey: components.map(sortKeyOf).sort()[0],
      rows: [
        toCardRow(MAPEH_LABEL, "header", parentQuarters, true),
        ...ordered.map((row) =>
          toCardRow(row.name, "sub", [row.q1, row.q2, row.q3, row.q4], false),
        ),
      ],
    });
  }

  return blocks
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .flatMap((b) => b.rows);
}

/**
 * The general average: the mean of the per-subject finals that count, rounded.
 * MAPEH contributes once through its header row rather than four times
 * through its components.
 */
export function computeGeneralAverage(rows: CardSubjectRow[]): {
  average: number | null;
  remarks: string;
} {
  const finals = rows
    .filter((r) => r.countsTowardAverage)
    .map((r) => r.final)
    .filter((v): v is number => v != null);
  const average = finals.length >= 1 ? Math.round(mean(finals)) : null;
  return { average, remarks: remarksFor(average) };
}
