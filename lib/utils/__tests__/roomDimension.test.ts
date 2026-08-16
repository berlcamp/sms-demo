import { describe, expect, it } from "vitest";
import {
  formatRoomDimension,
  isValidRoomDimension,
  normalizeRoomDimension,
  parseRoomDimension,
  roomDimensionArea,
} from "../roomDimension";

describe("parseRoomDimension", () => {
  it("accepts the shapes a school actually writes", () => {
    expect(parseRoomDimension("40x30")).toEqual({ width: 40, length: 30 });
    expect(parseRoomDimension(" 40 X 30 ")).toEqual({ width: 40, length: 30 });
    expect(parseRoomDimension("40 × 30")).toEqual({ width: 40, length: 30 });
    expect(parseRoomDimension("7.5x9")).toEqual({ width: 7.5, length: 9 });
  });

  it("rejects anything that is not two positive sides", () => {
    expect(parseRoomDimension("")).toBeNull();
    expect(parseRoomDimension(null)).toBeNull();
    expect(parseRoomDimension("40")).toBeNull();
    expect(parseRoomDimension("40x")).toBeNull();
    expect(parseRoomDimension("0x30")).toBeNull();
    expect(parseRoomDimension("large")).toBeNull();
  });
});

describe("isValidRoomDimension", () => {
  it("mirrors the parser", () => {
    expect(isValidRoomDimension("40x30")).toBe(true);
    expect(isValidRoomDimension("40")).toBe(false);
  });
});

describe("normalizeRoomDimension", () => {
  it("stores one canonical form", () => {
    expect(normalizeRoomDimension("40x30")).toBe("40 x 30");
    expect(normalizeRoomDimension(" 40 × 30 ")).toBe("40 x 30");
  });

  it("leaves an unparseable value alone rather than losing it", () => {
    expect(normalizeRoomDimension("  irregular  ")).toBe("irregular");
  });
});

describe("formatRoomDimension", () => {
  it("prints metres", () => {
    expect(formatRoomDimension("40 x 30")).toBe("40 × 30 m");
  });

  it("is empty when there is nothing measured", () => {
    expect(formatRoomDimension(null)).toBe("");
    expect(formatRoomDimension("")).toBe("");
  });
});

describe("roomDimensionArea", () => {
  it("computes floor area in square metres", () => {
    expect(roomDimensionArea("40x30")).toBe(1200);
    expect(roomDimensionArea("7.5x9")).toBe(67.5);
  });

  it("is null when the dimension is unusable", () => {
    expect(roomDimensionArea("irregular")).toBeNull();
  });
});
