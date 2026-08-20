// MAPEH component taxonomy (migration 153).
//
// MAPEH is one learning area made of four components. DepEd prints it as a
// single subject line carrying one grade, with the components indented
// beneath as the breakdown, and it counts ONCE toward the general average.
//
// Before 153 the app had no way to say which subjects were components, so:
//
//   * the report card and SF9 printed all four flat and counted them 4x,
//     weighting MAPEH four times against Math;
//   * SF10 and Form 137 grouped them by running a regex over the subject
//     name (`generateSf10.ts` getJHSKey / getESKey), which misses a subject
//     called "P.E." or "MUSIC & ARTS G8", and dropped MAPEH from the general
//     average entirely.
//
// `sms_subjects.mapeh_component` replaces the guess with a stored fact. NULL
// (the default) means the subject is not part of MAPEH, so nothing that
// predates the column changes behaviour until a school tags something.
//
// There is deliberately no MAPEH row in sms_subjects: the parent is computed
// at print time. A real parent row would need its own schedule and grade
// entry, and a teacher could then encode a MAPEH grade contradicting the one
// derived from its components.

export type MapehComponent = "music" | "arts" | "pe" | "health";

/** The label of the computed parent row. */
export const MAPEH_LABEL = "MAPEH";

/**
 * The four components, in the order they print — which is the order the
 * acronym spells. A boolean column could not have expressed this, which is
 * why the subject form stores which component rather than merely whether.
 */
export const MAPEH_COMPONENTS: {
  value: MapehComponent;
  /** Shown in the dropdown and printed as the indented row label */
  label: string;
  /** Compact form, for badges beside a subject code */
  short: string;
}[] = [
  { value: "music", label: "Music", short: "Music" },
  { value: "arts", label: "Arts", short: "Arts" },
  { value: "pe", label: "Physical Education", short: "PE" },
  { value: "health", label: "Health", short: "Health" },
];

/** Print order, by component. Anything untagged sorts after all four. */
export const mapehComponentRank = (value: MapehComponent | null): number => {
  if (!value) return MAPEH_COMPONENTS.length;
  const index = MAPEH_COMPONENTS.findIndex((c) => c.value === value);
  return index === -1 ? MAPEH_COMPONENTS.length : index;
};

/**
 * Resolve the stored component of a subject, rejecting anything that is not
 * one of the four. The column is CHECK-constrained, but historical rows read
 * through loosely-typed queries are not, and an unknown value must not
 * silently pull a subject into the parent grade.
 */
export function getMapehComponent(subject: {
  mapeh_component?: string | null;
}): MapehComponent | null {
  const stored = subject.mapeh_component;
  if (!stored) return null;
  return MAPEH_COMPONENTS.some((c) => c.value === stored)
    ? (stored as MapehComponent)
    : null;
}

export const getMapehComponentLabel = (value: MapehComponent): string =>
  MAPEH_COMPONENTS.find((c) => c.value === value)?.label ?? value;

export const getMapehComponentShortLabel = (value: MapehComponent): string =>
  MAPEH_COMPONENTS.find((c) => c.value === value)?.short ?? value;

/** True when the subject is tagged as one of the four MAPEH components. */
export const isMapehComponent = (subject: {
  mapeh_component?: string | null;
}): boolean => getMapehComponent(subject) !== null;
