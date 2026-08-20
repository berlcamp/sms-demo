"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  NSBI_BUILDING_CONDITIONS,
  NSBI_BUILDING_MATERIALS,
  NSBI_BUILDING_TYPES,
  NSBI_CLASSIFICATIONS,
  NSBI_FIELD_HELP,
  NSBI_FUND_SOURCES,
  NSBI_SPECIFIC_FUND_SOURCES,
} from "@/lib/constants/nsbi";
import type {
  NsbiBuildingCondition,
  NsbiBuildingMaterial,
  NsbiClassification,
  NsbiFundSource,
} from "@/types";
import { ChevronDown, ChevronRight, HelpCircle, Trash2 } from "lucide-react";
import {
  BuildingDraft,
  fromTristate,
  toTristate,
  TRISTATE_UNSET,
} from "./drafts";

/**
 * One building: NSBI Table 1 (Cols. 1–18) and that building's Table 4A water
 * and sanitation counts, together on one card because that is how a school
 * head walks the campus — one building at a time, not one column at a time.
 */

interface Props {
  draft: BuildingDraft;
  index: number;
  roomCount: number;
  expanded: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<BuildingDraft>) => void;
  onRemove: () => void;
  disabled: boolean;
}

/** A field label with the answering guide's definition behind a hover. */
function FieldLabel({ htmlFor, text }: { htmlFor: string; text: string }) {
  const help = NSBI_FIELD_HELP[htmlFor.split("__").pop() ?? ""];
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor} className="text-xs">
        {text}
      </Label>
      {help ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground"
              aria-label={`What is ${text}?`}
            >
              <HelpCircle className="h-3 w-3" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{help}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

/** Yes / No / not yet answered. Blank is a distinct state on a signed form. */
function TristateField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: boolean | null;
  onChange: (next: boolean | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel htmlFor={id} text={label} />
      <Select
        value={toTristate(value)}
        onValueChange={(v) => onChange(fromTristate(v))}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="h-9">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="yes">Yes</SelectItem>
          <SelectItem value="no">No</SelectItem>
          <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
  disabled,
  step,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  step?: string;
}) {
  return (
    <div className="space-y-1">
      <FieldLabel htmlFor={id} text={label} />
      <Input
        id={id}
        type="number"
        min="0"
        step={step}
        inputMode="decimal"
        className="h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

export function NsbiBuildingCard({
  draft,
  index,
  roomCount,
  expanded,
  onToggle,
  onChange,
  onRemove,
  disabled,
}: Props) {
  const p = `b${draft.key}__`;

  // Col. 2's list is filtered by Col. 3: picking "LGU Funded" should not leave
  // the school head scrolling past 150 national types. With no fund source
  // chosen yet, every group is offered.
  const typeGroups =
    draft.fund_sources.length > 0
      ? draft.fund_sources.flatMap((f) => NSBI_BUILDING_TYPES[f] ?? [])
      : (Object.keys(NSBI_BUILDING_TYPES) as NsbiFundSource[]).flatMap(
          (f) => NSBI_BUILDING_TYPES[f],
        );

  const toggleFundSource = (value: NsbiFundSource, checked: boolean) => {
    onChange({
      fund_sources: checked
        ? [...draft.fund_sources, value]
        : draft.fund_sources.filter((f) => f !== value),
    });
  };

  const toggleMaterial = (value: NsbiBuildingMaterial, checked: boolean) => {
    onChange({
      building_materials: checked
        ? [...draft.building_materials, value]
        : draft.building_materials.filter((m) => m !== value),
    });
  };

  const declaredRooms = draft.room_count.trim();
  const roomsDisagree =
    declaredRooms !== "" && Number(declaredRooms) !== roomCount;

  return (
    <Card>
      <CardHeader className="py-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onToggle}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
          <span className="text-xs font-mono text-muted-foreground">
            #{index + 1}
          </span>
          <Input
            aria-label="Building name or number"
            placeholder="Building name or number"
            className="h-9 max-w-xs font-medium"
            value={draft.building_name}
            onChange={(e) => onChange({ building_name: e.target.value })}
            disabled={disabled}
          />
          <Badge variant="outline" className="font-normal">
            {roomCount} room{roomCount === 1 ? "" : "s"}
          </Badge>
          {roomsDisagree ? (
            <Badge variant="destructive" className="font-normal">
              Col. 7 says {declaredRooms}
            </Badge>
          ) : null}
          <div className="ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-destructive hover:text-destructive"
              onClick={onRemove}
              disabled={disabled}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {expanded ? (
        <CardContent className="space-y-5 pt-0">
          {/* ---- Cols. 3–4: fund sources ---- */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Fund Source/s (Col. 3)</Label>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {NSBI_FUND_SOURCES.map((f) => (
                  <label
                    key={f.value}
                    className="flex items-start gap-2 text-xs"
                  >
                    <Checkbox
                      checked={draft.fund_sources.includes(f.value)}
                      onChange={(e) =>
                        toggleFundSource(f.value, e.target.checked)
                      }
                      disabled={disabled}
                    />
                    <span>{f.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <FieldLabel
                  htmlFor={`${p}building_type`}
                  text="Building Type (Col. 2)"
                />
                <Select
                  value={draft.building_type || TRISTATE_UNSET}
                  onValueChange={(v) =>
                    onChange({ building_type: v === TRISTATE_UNSET ? "" : v })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger id={`${p}building_type`} className="h-9">
                    <SelectValue placeholder="Select a type" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                    {typeGroups.map((g) => (
                      <SelectGroup key={g.group}>
                        <SelectLabel>{g.group}</SelectLabel>
                        {g.options.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                            {o.year ? ` (${o.year})` : ""}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label
                  htmlFor={`${p}specific_fund_source`}
                  className="text-xs"
                >
                  Specific Fund Source/s (Col. 4)
                </Label>
                <Select
                  value={draft.specific_fund_source || TRISTATE_UNSET}
                  onValueChange={(v) =>
                    onChange({
                      specific_fund_source: v === TRISTATE_UNSET ? "" : v,
                    })
                  }
                  disabled={disabled}
                >
                  <SelectTrigger
                    id={`${p}specific_fund_source`}
                    className="h-9"
                  >
                    <SelectValue placeholder="Select a source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                    {NSBI_SPECIFIC_FUND_SOURCES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* ---- Cols. 5–9 ---- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1 sm:col-span-2">
              <FieldLabel
                htmlFor={`${p}condition`}
                text="Building Condition (Col. 5)"
              />
              <Select
                value={draft.condition || TRISTATE_UNSET}
                onValueChange={(v) =>
                  onChange({
                    condition:
                      v === TRISTATE_UNSET
                        ? ""
                        : (v as NsbiBuildingCondition),
                  })
                }
                disabled={disabled}
              >
                <SelectTrigger id={`${p}condition`} className="h-9">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                  {NSBI_BUILDING_CONDITIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <NumberField
              id={`${p}storeys`}
              label="No. of Storeys (Col. 6)"
              value={draft.storeys}
              onChange={(v) => onChange({ storeys: v })}
              disabled={disabled}
            />
            <NumberField
              id={`${p}room_count`}
              label="No. of Rooms (Col. 7)"
              value={draft.room_count}
              onChange={(v) => onChange({ room_count: v })}
              disabled={disabled}
            />
            <NumberField
              id={`${p}year_completed`}
              label="Year Completed (Col. 8)"
              value={draft.year_completed}
              onChange={(v) => onChange({ year_completed: v })}
              disabled={disabled}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-1">
              <FieldLabel
                htmlFor={`${p}classification`}
                text="Classification (Col. 9)"
              />
              <Select
                value={draft.classification || TRISTATE_UNSET}
                onValueChange={(v) =>
                  onChange({
                    classification:
                      v === TRISTATE_UNSET ? "" : (v as NsbiClassification),
                  })
                }
                disabled={disabled}
              >
                <SelectTrigger id={`${p}classification`} className="h-9">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                  {NSBI_CLASSIFICATIONS.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <TristateField
              id={`${p}pwd_accessible`}
              label="PWD accessible? (Col. 10)"
              value={draft.pwd_accessible}
              onChange={(v) => onChange({ pwd_accessible: v })}
              disabled={disabled}
            />
            <TristateField
              id={`${p}major_repair_last_5y`}
              label="Major repair, last 5 yrs? (Col. 11)"
              value={draft.major_repair_last_5y}
              onChange={(v) => onChange({ major_repair_last_5y: v })}
              disabled={disabled}
            />
            <TristateField
              id={`${p}has_certificate_of_acceptance`}
              label="Cert. of Acceptance? (Col. 12)"
              value={draft.has_certificate_of_acceptance}
              onChange={(v) => onChange({ has_certificate_of_acceptance: v })}
              disabled={disabled}
            />
            <TristateField
              id={`${p}in_deped_book_of_accounts`}
              label="In Book of Accounts? (Col. 13)"
              value={draft.in_deped_book_of_accounts}
              onChange={(v) => onChange({ in_deped_book_of_accounts: v })}
              disabled={disabled}
            />
          </div>

          {/* ---- Cols. 14–18 ---- */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">Building Materials (Col. 14)</Label>
              <div className="grid grid-cols-3 gap-1.5">
                {NSBI_BUILDING_MATERIALS.map((m) => (
                  <label
                    key={m.value}
                    className="flex items-center gap-2 text-xs"
                  >
                    <Checkbox
                      checked={draft.building_materials.includes(m.value)}
                      onChange={(e) => toggleMaterial(m.value, e.target.checked)}
                      disabled={disabled}
                    />
                    <span>{m.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <FieldLabel
                  htmlFor={`${p}date_of_acquisition`}
                  text="Date of Acquisition (Col. 15)"
                />
                <Input
                  id={`${p}date_of_acquisition`}
                  type="date"
                  className="h-9"
                  value={draft.date_of_acquisition}
                  onChange={(e) =>
                    onChange({ date_of_acquisition: e.target.value })
                  }
                  disabled={disabled}
                />
              </div>
              <NumberField
                id={`${p}acquisition_cost`}
                label="Acquisition Cost (Col. 16)"
                value={draft.acquisition_cost}
                onChange={(v) => onChange({ acquisition_cost: v })}
                disabled={disabled}
                step="0.01"
              />
              <NumberField
                id={`${p}book_value`}
                label="Book Value (Col. 17)"
                value={draft.book_value}
                onChange={(v) => onChange({ book_value: v })}
                disabled={disabled}
                step="0.01"
              />
            </div>
          </div>

          <div className="space-y-1">
            <FieldLabel
              htmlFor={`${p}insurance_info`}
              text="Insurance Information (Col. 18)"
            />
            <Input
              id={`${p}insurance_info`}
              className="h-9"
              placeholder="Current insurance policy — state if none"
              value={draft.insurance_info}
              onChange={(e) => onChange({ insurance_info: e.target.value })}
              disabled={disabled}
            />
          </div>

          {/* ---- Table 4A: this building's water and sanitation ---- */}
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Table 4A · Water and Sanitation Facilities in this building
            </div>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <NumberField
                id={`${p}bowls_male`}
                label="Bowls — Male"
                value={draft.bowls_male}
                onChange={(v) => onChange({ bowls_male: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}bowls_female`}
                label="Bowls — Female"
                value={draft.bowls_female}
                onChange={(v) => onChange({ bowls_female: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}bowls_pwd`}
                label="Bowls — PWD"
                value={draft.bowls_pwd}
                onChange={(v) => onChange({ bowls_pwd: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}bowls_shared`}
                label="Bowls — Shared"
                value={draft.bowls_shared}
                onChange={(v) => onChange({ bowls_shared: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}bowls_nonfunctional`}
                label="Non-functional bowls"
                value={draft.bowls_nonfunctional}
                onChange={(v) => onChange({ bowls_nonfunctional: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}washbasins`}
                label="Sink / Washbasin"
                value={draft.washbasins}
                onChange={(v) => onChange({ washbasins: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}urinals`}
                label="Urinals"
                value={draft.urinals}
                onChange={(v) => onChange({ urinals: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}urinal_troughs`}
                label="Urinal Trough"
                value={draft.urinal_troughs}
                onChange={(v) => onChange({ urinal_troughs: v })}
                disabled={disabled}
              />
              <TristateField
                id={`${p}septic_tank`}
                label="With Septic Tank"
                value={draft.septic_tank}
                onChange={(v) => onChange({ septic_tank: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}faucets_with_water`}
                label="Faucets — with water"
                value={draft.faucets_with_water}
                onChange={(v) => onChange({ faucets_with_water: v })}
                disabled={disabled}
              />
              <NumberField
                id={`${p}faucets_without_water`}
                label="Faucets — without water"
                value={draft.faucets_without_water}
                onChange={(v) => onChange({ faucets_without_water: v })}
                disabled={disabled}
              />
            </div>
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
