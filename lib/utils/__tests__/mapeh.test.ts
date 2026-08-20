import { describe, expect, it } from "vitest";

import {
  buildCardSubjectRows,
  computeGeneralAverage,
  type MapehSourceRow,
} from "@/lib/utils/mapeh";

const subject = (
  name: string,
  quarters: (number | null)[],
  extra: Partial<MapehSourceRow> = {},
): MapehSourceRow => ({
  name,
  code: name.slice(0, 4).toUpperCase(),
  is_madrasah: false,
  mapeh_component: null,
  q1: quarters[0] ?? null,
  q2: quarters[1] ?? null,
  q3: quarters[2] ?? null,
  q4: quarters[3] ?? null,
  ...extra,
});

const generalAverageOf = (rows: MapehSourceRow[]) =>
  computeGeneralAverage(buildCardSubjectRows(rows)).average;

describe("buildCardSubjectRows", () => {
  it("leaves untagged subjects flat, ordered by code", () => {
    const rows = buildCardSubjectRows([
      subject("Science", [90, 90, 90, 90]),
      subject("English", [80, 80, 80, 80]),
    ]);

    expect(rows.map((r) => [r.name, r.kind])).toEqual([
      ["English", "plain"],
      ["Science", "plain"],
    ]);
  });

  it("folds tagged components into a computed MAPEH row in M-A-P-H order", () => {
    const rows = buildCardSubjectRows([
      // Deliberately out of print order, and named so alphabetical sorting
      // would get it wrong: Arts before Music, PE last.
      subject("Health", [80, 80, 80, 80], { mapeh_component: "health" }),
      subject("Arts", [90, 90, 90, 90], { mapeh_component: "arts" }),
      subject("P.E.", [86, 86, 86, 86], { mapeh_component: "pe" }),
      subject("Music", [88, 88, 88, 88], { mapeh_component: "music" }),
    ]);

    expect(rows.map((r) => [r.name, r.kind])).toEqual([
      ["MAPEH", "header"],
      ["Music", "sub"],
      ["Arts", "sub"],
      ["P.E.", "sub"],
      ["Health", "sub"],
    ]);

    // (88 + 90 + 86 + 80) / 4 = 86
    expect(rows[0].q1).toBe(86);
    expect(rows[0].final).toBe(86);
  });

  it("builds a quarter from whichever components are encoded so far", () => {
    const rows = buildCardSubjectRows([
      subject("Music", [90, 90, null, null], { mapeh_component: "music" }),
      subject("Arts", [80, null, null, null], { mapeh_component: "arts" }),
    ]);

    const header = rows.find((r) => r.kind === "header")!;
    expect(header.q1).toBe(85); // both components
    expect(header.q2).toBe(90); // only Music encoded
    expect(header.q3).toBeNull();
    expect(header.final).toBe(88); // round((85 + 90) / 2)
  });

  it("places the MAPEH block where its first component would have sorted", () => {
    const rows = buildCardSubjectRows([
      subject("English", [80, 80, 80, 80], { code: "ENG" }),
      subject("Science", [80, 80, 80, 80], { code: "SCI" }),
      subject("Music", [80, 80, 80, 80], { code: "MUS", mapeh_component: "music" }),
    ]);

    expect(rows.map((r) => r.name)).toEqual(["English", "MAPEH", "Music", "Science"]);
  });
});

describe("computeGeneralAverage", () => {
  it("counts MAPEH once, not once per component", () => {
    const math = subject("Math", [100, 100, 100, 100], { code: "MATH" });
    const components: MapehSourceRow[] = [
      subject("Music", [80, 80, 80, 80], { code: "MUS", mapeh_component: "music" }),
      subject("Arts", [80, 80, 80, 80], { code: "ART", mapeh_component: "arts" }),
      subject("PE", [80, 80, 80, 80], { code: "PE", mapeh_component: "pe" }),
      subject("Health", [80, 80, 80, 80], { code: "HEA", mapeh_component: "health" }),
    ];

    // Grouped: mean(100, 80) = 90. Flat, as the card did before migration 153,
    // it was mean(100, 80, 80, 80, 80) = 84 — MAPEH outweighing Math 4:1.
    expect(generalAverageOf([math, ...components])).toBe(90);

    const untagged = components.map((c) => ({ ...c, mapeh_component: null }));
    expect(generalAverageOf([math, ...untagged])).toBe(84);
  });

  it("keeps madrasah and ALS subjects out of the average but prints them", () => {
    const rows = buildCardSubjectRows([
      subject("Math", [90, 90, 90, 90], { code: "MATH" }),
      subject("Arabic", [60, 60, 60, 60], { code: "ARB", is_madrasah: true }),
    ]);

    expect(rows).toHaveLength(2);
    expect(computeGeneralAverage(rows).average).toBe(90);
  });

  it("returns null when nothing is encoded", () => {
    expect(generalAverageOf([subject("Math", [null, null, null, null])])).toBeNull();
  });

  it("marks the average failed below 75", () => {
    const rows = buildCardSubjectRows([subject("Math", [70, 70, 70, 70])]);
    expect(computeGeneralAverage(rows)).toEqual({ average: 70, remarks: "Failed" });
  });

  it("ignores an unrecognised component value rather than folding it in", () => {
    // The column is CHECK-constrained, but a loosely-typed read must not pull
    // an unknown value into the parent grade.
    const rows = buildCardSubjectRows([
      subject("Robotics", [80, 80, 80, 80], { mapeh_component: "dance" }),
    ]);

    expect(rows.map((r) => r.kind)).toEqual(["plain"]);
  });
});
