import { describe, expect, it } from "vitest";
import {
  philIriDefaultQuestionType,
  philIriDefaultQuestionTypes,
  philIriQuestionCount,
  philIriRecordQuestionCount,
  PHILIRI_COMPREHENSION_QUESTIONS,
  PHILIRI_DEFAULT_QUESTION_TYPES,
} from "../assessments";

describe("philIriDefaultQuestionTypes", () => {
  it("reproduces the hand-written 7-question layout exactly", () => {
    // Migration 152 must not move a single existing passage's default typing.
    expect(philIriDefaultQuestionTypes(PHILIRI_COMPREHENSION_QUESTIONS)).toEqual(
      PHILIRI_DEFAULT_QUESTION_TYPES,
    );
  });

  it("types every question, literal-led, for any legal count", () => {
    for (let n = 1; n <= 20; n++) {
      const types = philIriDefaultQuestionTypes(n);
      expect(types).toHaveLength(n);
      expect(types.every((t) => t !== undefined)).toBe(true);
      const literal = types.filter((t) => t === "literal").length;
      const inferential = types.filter((t) => t === "inferential").length;
      const critical = types.filter((t) => t === "critical").length;
      expect(literal + inferential + critical).toBe(n);
      expect(literal).toBeGreaterThanOrEqual(inferential);
      expect(literal).toBeGreaterThanOrEqual(critical);
    }
  });

  it("keeps the three types in L → I → C order", () => {
    expect(philIriDefaultQuestionTypes(10)).toEqual([
      "literal",
      "literal",
      "literal",
      "literal",
      "inferential",
      "inferential",
      "inferential",
      "critical",
      "critical",
      "critical",
    ]);
  });

  it("returns nothing for a zero or negative count", () => {
    expect(philIriDefaultQuestionTypes(0)).toEqual([]);
    expect(philIriDefaultQuestionTypes(-3)).toEqual([]);
  });
});

describe("philIriDefaultQuestionType", () => {
  it("defaults to the 7-question layout when no count is given", () => {
    expect(philIriDefaultQuestionType(0)).toBe("literal");
    expect(philIriDefaultQuestionType(3)).toBe("inferential");
    expect(philIriDefaultQuestionType(6)).toBe("critical");
  });

  it("falls back to literal past the end of the passage", () => {
    expect(philIriDefaultQuestionType(9, 5)).toBe("literal");
  });
});

describe("philIriQuestionCount", () => {
  it("reads the material's authored count", () => {
    expect(philIriQuestionCount({ question_count: 12 })).toBe(12);
  });

  it("falls back to 7 for a material predating migration 152", () => {
    expect(philIriQuestionCount({ question_count: null })).toBe(7);
    expect(philIriQuestionCount({})).toBe(7);
    expect(philIriQuestionCount(null)).toBe(7);
    expect(philIriQuestionCount({ question_count: 0 })).toBe(7);
  });
});

describe("philIriRecordQuestionCount", () => {
  it("prefers the denominator the read was actually scored against", () => {
    // The passage has since been shortened to 7 — the saved form keeps its 10.
    expect(
      philIriRecordQuestionCount({ comprehension_total: 10 }, { question_count: 7 }),
    ).toBe(10);
  });

  it("falls back to the material for a record with no stored total", () => {
    expect(
      philIriRecordQuestionCount({ comprehension_total: null }, { question_count: 9 }),
    ).toBe(9);
    expect(philIriRecordQuestionCount(null, null)).toBe(7);
  });
});
