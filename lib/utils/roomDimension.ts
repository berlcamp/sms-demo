/**
 * Room dimension ("40x30", in metres) — parsing, validation and display.
 *
 * `sms_rooms.dimension` is free TEXT (migration 137): it is transcribed from
 * the building inventory as one figure and printed back the same way. The
 * shape is validated here rather than by a CHECK constraint so a room measured
 * in a form the school actually uses is never rejected by the database.
 */

/** "40x30", "40 x 30", "40.5 × 30" — width and length in metres. */
const DIMENSION_RE = /^\s*(\d+(?:\.\d+)?)\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*$/;

export interface RoomDimension {
  width: number;
  length: number;
}

/** Parses "40x30" into its two sides, or null when the shape is not usable. */
export function parseRoomDimension(
  value: string | null | undefined,
): RoomDimension | null {
  if (!value) return null;
  const match = DIMENSION_RE.exec(value);
  if (!match) return null;
  const width = Number(match[1]);
  const length = Number(match[2]);
  if (!(width > 0) || !(length > 0)) return null;
  return { width, length };
}

export function isValidRoomDimension(value: string | null | undefined): boolean {
  return parseRoomDimension(value) !== null;
}

/** Stored form: "40 x 30". Returns the trimmed input when it is not parseable. */
export function normalizeRoomDimension(value: string): string {
  const parsed = parseRoomDimension(value);
  return parsed ? `${parsed.width} x ${parsed.length}` : value.trim();
}

/** Display form: "40 × 30 m". Empty string when there is nothing to show. */
export function formatRoomDimension(value: string | null | undefined): string {
  const parsed = parseRoomDimension(value);
  if (!parsed) return value?.trim() ?? "";
  return `${parsed.width} × ${parsed.length} m`;
}

/** Floor area in square metres, or null when the dimension is unusable. */
export function roomDimensionArea(
  value: string | null | undefined,
): number | null {
  const parsed = parseRoomDimension(value);
  if (!parsed) return null;
  return Math.round(parsed.width * parsed.length * 100) / 100;
}
