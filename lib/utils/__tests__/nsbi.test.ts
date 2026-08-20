/**
 * NSBI Table 5 prefill from the KPI seat inventory (migrations 118 + 154).
 *
 * The risk this pins down is silent damage: a prefill that overwrote a physical
 * count, or that apportioned the KPI's single 2-seater total across the form's
 * three level columns, would put a fabricated number on a return four officers
 * sign — and nothing downstream would ever flag it.
 */

import { describe, expect, it } from "vitest";
import {
  nsbiFurnitureFromKpi,
  nsbiSchoolYearForAsOf,
  nsbiSeatTotal,
} from "../nsbi";
import type { NsbiSubmission } from "@/types";

const kpi = {
  seats_kindergarten: 40,
  seats_arm_chairs: 250,
  seats_school_desks: 60,
};

function blankFurniture(): Record<string, string> {
  return {
    furniture_kinder_modular_table: "",
    furniture_kinder_chair: "",
    furniture_armchair: "",
    furniture_school_desk: "",
    furniture_other_table: "",
    furniture_other_chair: "",
    furniture_1seater_elementary: "",
    furniture_1seater_jhs: "",
    furniture_1seater_shs: "",
    furniture_2seater_elementary: "",
    furniture_2seater_jhs: "",
    furniture_2seater_shs: "",
  };
}

describe("nsbiSchoolYearForAsOf", () => {
  it("puts a 31 May inventory in the school year that is ending", () => {
    // The form is headed "as of May 31, 2026", which is the END of SY 2025-2026.
    expect(nsbiSchoolYearForAsOf("2026-05-31")).toBe("2025-2026");
  });

  it("rolls over in June, when the next school year opens", () => {
    expect(nsbiSchoolYearForAsOf("2026-05-31")).toBe("2025-2026");
    expect(nsbiSchoolYearForAsOf("2026-06-01")).toBe("2026-2027");
    expect(nsbiSchoolYearForAsOf("2026-12-31")).toBe("2026-2027");
    expect(nsbiSchoolYearForAsOf("2027-01-15")).toBe("2026-2027");
  });

  it("returns empty rather than a wrong year for an unusable date", () => {
    expect(nsbiSchoolYearForAsOf("not-a-date")).toBe("");
  });
});

describe("nsbiFurnitureFromKpi", () => {
  it("fills the three columns that map one-to-one", () => {
    const result = nsbiFurnitureFromKpi(kpi, blankFurniture());
    expect(result.furniture.furniture_kinder_chair).toBe("40");
    expect(result.furniture.furniture_armchair).toBe("250");
    expect(result.furniture.furniture_school_desk).toBe("60");
    expect(result.filled).toEqual(["Kinder Chair", "Armchair", "School Desk"]);
  });

  it("never apportions the KPI's single 2-seater total across the three levels", () => {
    // This is the whole reason the fourth component is unmapped: the form wants
    // Elementary / JHS / SHS and the KPI holds one school-wide number.
    const result = nsbiFurnitureFromKpi(kpi, blankFurniture());
    expect(result.furniture.furniture_2seater_elementary).toBe("");
    expect(result.furniture.furniture_2seater_jhs).toBe("");
    expect(result.furniture.furniture_2seater_shs).toBe("");
  });

  it("maps kinder seats to the CHAIR, not the modular table", () => {
    // A modular table is furniture but not a seat (guide notes 36 vs 37).
    const result = nsbiFurnitureFromKpi(kpi, blankFurniture());
    expect(result.furniture.furniture_kinder_modular_table).toBe("");
    expect(result.furniture.furniture_kinder_chair).toBe("40");
  });

  it("never overwrites a column the school head already counted", () => {
    const current = { ...blankFurniture(), furniture_armchair: "233" };
    const result = nsbiFurnitureFromKpi(kpi, current);
    expect(result.furniture.furniture_armchair).toBe("233");
    expect(result.kept).toEqual(["Armchair"]);
    expect(result.filled).toEqual(["Kinder Chair", "School Desk"]);
  });

  it("treats an entered zero as counted, not as blank", () => {
    // Zero armchairs is a real answer and must survive the prefill.
    const current = { ...blankFurniture(), furniture_armchair: "0" };
    const result = nsbiFurnitureFromKpi(kpi, current);
    expect(result.furniture.furniture_armchair).toBe("0");
    expect(result.kept).toContain("Armchair");
  });

  it("reports the components the KPI row has no figure for", () => {
    const result = nsbiFurnitureFromKpi(
      { ...kpi, seats_school_desks: null },
      blankFurniture(),
    );
    expect(result.missing).toEqual(["School Desk"]);
    expect(result.furniture.furniture_school_desk).toBe("");
  });

  it("leaves the input map untouched", () => {
    const current = blankFurniture();
    nsbiFurnitureFromKpi(kpi, current);
    expect(current.furniture_armchair).toBe("");
  });
});

describe("nsbiSeatTotal", () => {
  it("applies the memo's multipliers to desks and 2-seater sets", () => {
    // kinder 40 + armchairs 250 + desks 60x2 + 2-seaters 15x2 + 1-seaters 12
    const submission = {
      furniture_kinder_chair: 40,
      furniture_armchair: 250,
      furniture_school_desk: 60,
      furniture_2seater_elementary: 15,
      furniture_2seater_jhs: null,
      furniture_2seater_shs: null,
      furniture_1seater_elementary: 12,
      furniture_1seater_jhs: null,
      furniture_1seater_shs: null,
    } as unknown as NsbiSubmission;
    expect(nsbiSeatTotal(submission)).toBe(40 + 250 + 120 + 30 + 12);
  });
});
