"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  NSBI_ACTUAL_USAGE_LABELS,
  NSBI_ACTUAL_USAGES,
  NSBI_ROOM_CONDITIONS,
  NSBI_ROOM_USAGES,
} from "@/lib/constants/nsbi";
import type { NsbiRoomCondition, NsbiRoomUsage } from "@/types";
import { Plus, Trash2, X } from "lucide-react";
import { RoomDraft, TRISTATE_UNSET } from "./drafts";

/**
 * NSBI Table 2 for one building. Column order follows the printed form so the
 * screen can be filled straight from the paper walk-through.
 */

interface Props {
  buildingKey: string;
  buildingName: string;
  rooms: RoomDraft[];
  onChange: (key: string, patch: Partial<RoomDraft>) => void;
  onAdd: (buildingKey: string) => void;
  onRemove: (key: string) => void;
  disabled: boolean;
}

/**
 * Col. 6. A LIST, not a checkbox set: the answering guide records a room shared
 * by two concurrent SPED classes as "SPED classroom and SPED classroom", so the
 * same usage must be addable twice and the number of entries is the number of
 * concurrent usages. Every entry is removable individually.
 */
function ActualUsageEditor({
  value,
  onChange,
  disabled,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {value.map((code, i) => (
        <Badge
          key={`${code}-${i}`}
          variant="secondary"
          className="gap-1 font-normal"
        >
          {NSBI_ACTUAL_USAGE_LABELS[code] ?? code}
          {!disabled ? (
            <button
              type="button"
              aria-label={`Remove ${NSBI_ACTUAL_USAGE_LABELS[code] ?? code}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="hover:text-destructive"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </Badge>
      ))}
      {!disabled ? (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs"
            >
              <Plus className="mr-1 h-3 w-3" />
              Usage
            </Button>
          </PopoverTrigger>
          <PopoverContent className="max-h-72 w-72 overflow-y-auto p-1">
            {NSBI_ACTUAL_USAGES.map((group) => (
              <div key={group.group} className="mb-1">
                <div className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group.groupLabel}
                </div>
                {group.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="w-full rounded px-2 py-1 text-left text-xs hover:bg-accent"
                    onClick={() => onChange([...value, o.value])}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

export function NsbiRoomRows({
  buildingKey,
  buildingName,
  rooms,
  onChange,
  onAdd,
  onRemove,
  disabled,
}: Props) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="text-sm font-medium">
          {buildingName || "(unnamed building)"}
        </span>
        <Badge variant="outline" className="font-normal">
          {rooms.length} room{rooms.length === 1 ? "" : "s"}
        </Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto h-7"
          onClick={() => onAdd(buildingKey)}
          disabled={disabled}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add room
        </Button>
      </div>

      {rooms.length === 0 ? (
        <p className="px-3 py-4 text-xs italic text-muted-foreground">
          No rooms recorded for this building.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 text-xs">Floor (Col. 2)</TableHead>
                <TableHead className="w-40 text-xs">Room No. (Col. 3)</TableHead>
                <TableHead className="w-48 text-xs">Condition (Col. 4)</TableHead>
                <TableHead className="w-44 text-xs">Usage (Col. 5)</TableHead>
                <TableHead className="min-w-64 text-xs">
                  Actual Usage/s (Col. 6)
                </TableHead>
                <TableHead className="w-24 text-xs">Width m (Col. 7)</TableHead>
                <TableHead className="w-24 text-xs">Length m (Col. 8)</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rooms.map((room) => (
                <TableRow key={room.key}>
                  <TableCell>
                    <Input
                      aria-label="Floor number"
                      type="number"
                      min="0"
                      className="h-8"
                      value={room.floor_number}
                      onChange={(e) =>
                        onChange(room.key, { floor_number: e.target.value })
                      }
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label="Room number"
                      className="h-8"
                      value={room.room_number}
                      onChange={(e) =>
                        onChange(room.key, { room_number: e.target.value })
                      }
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={room.condition || TRISTATE_UNSET}
                      onValueChange={(v) =>
                        onChange(room.key, {
                          condition:
                            v === TRISTATE_UNSET
                              ? ""
                              : (v as NsbiRoomCondition),
                        })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8" aria-label="Room condition">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                        {NSBI_ROOM_CONDITIONS.map((c) => (
                          <SelectItem key={c.value} value={c.value}>
                            {c.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select
                      value={room.room_usage || TRISTATE_UNSET}
                      onValueChange={(v) =>
                        onChange(room.key, {
                          room_usage:
                            v === TRISTATE_UNSET ? "" : (v as NsbiRoomUsage),
                        })
                      }
                      disabled={disabled}
                    >
                      <SelectTrigger className="h-8" aria-label="Room usage">
                        <SelectValue placeholder="—" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                        {NSBI_ROOM_USAGES.map((u) => (
                          <SelectItem key={u.value} value={u.value}>
                            {u.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <ActualUsageEditor
                      value={room.actual_usages}
                      onChange={(next) =>
                        onChange(room.key, { actual_usages: next })
                      }
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label="Width in metres"
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8"
                      value={room.width_m}
                      onChange={(e) =>
                        onChange(room.key, { width_m: e.target.value })
                      }
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      aria-label="Length in metres"
                      type="number"
                      min="0"
                      step="0.01"
                      className="h-8"
                      value={room.length_m}
                      onChange={(e) =>
                        onChange(room.key, { length_m: e.target.value })
                      }
                      disabled={disabled}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      onClick={() => onRemove(room.key)}
                      disabled={disabled}
                      aria-label="Remove room"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

/** Grid header note explaining why width and length are separate columns. */
export const NSBI_ROOM_DIMENSION_NOTE =
  "Width is the chalkboard side, length the window side (answering guide, note 24).";
