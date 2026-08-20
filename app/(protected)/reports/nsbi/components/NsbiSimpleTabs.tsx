"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  NSBI_ACCESS_ROAD_TYPES,
  NSBI_AMENITIES,
  NSBI_FIELD_HELP,
  NSBI_FURNITURE_FIELDS,
  NSBI_KPI_UNMAPPED_NOTE,
  NSBI_SIGNATORY_ROLES,
  NSBI_TRANSPORT_TYPES,
  NSBI_WASH_FIELDS,
} from "@/lib/constants/nsbi";
import type { NsbiAmenityKey, NsbiSignatory } from "@/types";
import { Wand2 } from "lucide-react";
import {
  fromTristate,
  HeaderDraft,
  toTristate,
  TRISTATE_UNSET,
} from "./drafts";

/**
 * The five short NSBI tabs — Tables 3, 4B, 5, 6, 7 — plus the signature block.
 * Each renders straight off the constant list that also drives the printed
 * page, so the screen and the paper cannot list different columns.
 */

interface TabProps {
  draft: HeaderDraft;
  onChange: (patch: Partial<HeaderDraft>) => void;
  disabled: boolean;
}

function NumberCell({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const help = NSBI_FIELD_HELP[id];
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min="0"
        inputMode="numeric"
        className="h-9"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {help ? (
        <p className="text-[0.7rem] leading-snug text-muted-foreground">
          {help}
        </p>
      ) : null}
    </div>
  );
}

// ============================================================================
// Table 3 — Temporary Learning Space/s and Makeshift Room/s
// ============================================================================

export function NsbiTemporaryTab({ draft, onChange, disabled }: TabProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <NumberCell
        id="tls_count"
        label="No. of Temporary Learning Space/s (Col. 1)"
        value={draft.tls_count}
        onChange={(v) => onChange({ tls_count: v })}
        disabled={disabled}
      />
      <NumberCell
        id="tls_sections_count"
        label="No. of Classes/Sections using TLS (Col. 2)"
        value={draft.tls_sections_count}
        onChange={(v) => onChange({ tls_sections_count: v })}
        disabled={disabled}
      />
      <NumberCell
        id="makeshift_count"
        label="No. of Makeshift Room/s (Col. 3)"
        value={draft.makeshift_count}
        onChange={(v) => onChange({ makeshift_count: v })}
        disabled={disabled}
      />
      <NumberCell
        id="makeshift_sections_count"
        label="No. of Classes/Sections using Makeshift Room/s (Col. 4)"
        value={draft.makeshift_sections_count}
        onChange={(v) => onChange({ makeshift_sections_count: v })}
        disabled={disabled}
      />
    </div>
  );
}

// ============================================================================
// Table 4B — Stand-Alone Water and Sanitation Facilities
// ============================================================================

export function NsbiStandaloneWashTab({
  draft,
  onChange,
  disabled,
}: TabProps) {
  return (
    <div className="space-y-3">
      <p className="max-w-2xl text-xs text-muted-foreground">
        Facilities built separately from any school building. Facilities inside
        a building are counted on that building&rsquo;s card under Table 4A.
      </p>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {NSBI_WASH_FIELDS.map((f) =>
          f.kind === "tristate" ? (
            <div key={f.key} className="space-y-1">
              <Label
                htmlFor={`standalone_${f.key}`}
                className="text-xs"
              >
                {f.label}
              </Label>
              <Select
                value={toTristate(draft.standalone_septic_tank)}
                onValueChange={(v) =>
                  onChange({ standalone_septic_tank: fromTristate(v) })
                }
                disabled={disabled}
              >
                <SelectTrigger id={`standalone_${f.key}`} className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <NumberCell
              key={f.key}
              id={`standalone_${f.key}`}
              label={f.label}
              value={draft.standalone[f.key] ?? ""}
              onChange={(v) =>
                onChange({
                  standalone: { ...draft.standalone, [f.key]: v },
                })
              }
              disabled={disabled}
            />
          ),
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Table 5 — Existing Number of Usable Furniture
// ============================================================================

export function NsbiFurnitureTab({
  draft,
  onChange,
  disabled,
  onPrefillFromKpi,
  prefilling = false,
}: TabProps & {
  /** Pulls the three mappable seat counts out of the KPI reference (118). */
  onPrefillFromKpi?: () => void;
  prefilling?: boolean;
}) {
  const ungrouped = NSBI_FURNITURE_FIELDS.filter((f) => !f.group);
  const groups = Array.from(
    new Set(
      NSBI_FURNITURE_FIELDS.filter((f) => f.group).map((f) => f.group as string),
    ),
  );

  const setField = (field: string, value: string) =>
    onChange({ furniture: { ...draft.furniture, [field]: value } });

  return (
    <div className="space-y-5">
      {onPrefillFromKpi ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 p-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onPrefillFromKpi}
            disabled={disabled || prefilling}
          >
            <Wand2 className="mr-2 h-4 w-4" />
            {prefilling ? "Reading…" : "Prefill from KPI seat inventory"}
          </Button>
          <span className="max-w-xl text-xs text-muted-foreground">
            Fills only blank columns from the seat counts already kept for the
            KPI seat-learner ratio. {NSBI_KPI_UNMAPPED_NOTE}
          </span>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {ungrouped.map((f) => (
          <div key={f.field} className="space-y-1">
            <Label htmlFor={f.field} className="text-xs">
              {f.label}
            </Label>
            <Input
              id={f.field}
              type="number"
              min="0"
              inputMode="numeric"
              className="h-9"
              value={draft.furniture[f.field] ?? ""}
              onChange={(e) => setField(f.field, e.target.value)}
              disabled={disabled}
            />
            {f.help ? (
              <p className="text-[0.7rem] leading-snug text-muted-foreground">
                {f.help}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {groups.map((group) => (
        <div key={group} className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {NSBI_FURNITURE_FIELDS.filter((f) => f.group === group).map((f) => (
              <div key={f.field} className="space-y-1">
                <Label htmlFor={f.field} className="text-xs">
                  {f.label}
                </Label>
                <Input
                  id={f.field}
                  type="number"
                  min="0"
                  inputMode="numeric"
                  className="h-9"
                  value={draft.furniture[f.field] ?? ""}
                  onChange={(e) => setField(f.field, e.target.value)}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Table 6 — Other Facilities/Amenities
// ============================================================================
// Yes / No / unanswered, laid out in the form's three column groups.

export function NsbiAmenitiesTab({ draft, onChange, disabled }: TabProps) {
  const setAmenity = (key: NsbiAmenityKey, value: boolean | null) => {
    const next = { ...draft.amenities };
    if (value === null) delete next[key];
    else next[key] = value;
    onChange({ amenities: next });
  };

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {([1, 2, 3] as const).map((column) => (
        <div key={column} className="space-y-2">
          {NSBI_AMENITIES.filter((a) => a.column === column).map((a) => (
            <div
              key={a.value}
              className="flex items-start justify-between gap-3 rounded-md border p-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium">{a.label}</div>
                <p className="text-[0.7rem] leading-snug text-muted-foreground">
                  {a.help}
                </p>
              </div>
              <Select
                value={toTristate(draft.amenities[a.value] ?? null)}
                onValueChange={(v) => setAmenity(a.value, fromTristate(v))}
                disabled={disabled}
              >
                <SelectTrigger
                  className="h-8 w-20 shrink-0"
                  aria-label={a.label}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">Yes</SelectItem>
                  <SelectItem value="no">No</SelectItem>
                  <SelectItem value={TRISTATE_UNSET}>—</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Table 7 — Access going to School (check all applicable)
// ============================================================================

export function NsbiAccessTab({ draft, onChange, disabled }: TabProps) {
  const toggle = (list: string[], value: string, on: boolean) =>
    on ? [...list, value] : list.filter((v) => v !== value);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-2">
        <div className="text-sm font-medium">Type of Access Road (Col. 1)</div>
        {NSBI_ACCESS_ROAD_TYPES.map((r) => (
          <label
            key={r.value}
            className="flex items-start gap-2 rounded-md border p-2 text-xs"
          >
            <Checkbox
              className="mt-0.5"
              checked={draft.access_road_types.includes(r.value)}
              onChange={(e) =>
                onChange({
                  access_road_types: toggle(
                    draft.access_road_types,
                    r.value,
                    e.target.checked,
                  ),
                })
              }
              disabled={disabled}
            />
            <span>
              <span className="font-medium">{r.label}</span>
              <span className="block text-muted-foreground">{r.help}</span>
            </span>
          </label>
        ))}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">
          Accessible by Type of Transportation (Col. 2)
        </div>
        <div className="grid grid-cols-2 gap-2">
          {NSBI_TRANSPORT_TYPES.map((t) => (
            <label
              key={t.value}
              className="flex items-center gap-2 rounded-md border p-2 text-xs"
            >
              <Checkbox
                checked={draft.transport_types.includes(t.value)}
                onChange={(e) =>
                  onChange({
                    transport_types: toggle(
                      draft.transport_types,
                      t.value,
                      e.target.checked,
                    ),
                  })
                }
                disabled={disabled}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Header identity (page 1 only) and the signature block
// ============================================================================

export function NsbiSignatoriesTab({ draft, onChange, disabled }: TabProps) {
  const patchSignatory = (
    role: string,
    patch: Partial<NsbiSignatory>,
  ) =>
    onChange({
      signatories: draft.signatories.map((s) =>
        s.role === role ? { ...s, ...patch } : s,
      ),
    });

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:max-w-lg">
        <div className="space-y-1">
          <Label htmlFor="latitude" className="text-xs">
            Latitude
          </Label>
          <Input
            id="latitude"
            type="number"
            step="0.000001"
            className="h-9"
            placeholder="8.714167"
            value={draft.latitude}
            onChange={(e) => onChange({ latitude: e.target.value })}
            disabled={disabled}
          />
          <p className="text-[0.7rem] text-muted-foreground">
            {NSBI_FIELD_HELP.latitude}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="longitude" className="text-xs">
            Longitude
          </Label>
          <Input
            id="longitude"
            type="number"
            step="0.000001"
            className="h-9"
            placeholder="125.749722"
            value={draft.longitude}
            onChange={(e) => onChange({ longitude: e.target.value })}
            disabled={disabled}
          />
          <p className="text-[0.7rem] text-muted-foreground">
            {NSBI_FIELD_HELP.longitude}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="text-sm font-medium">Signatories</div>
        <p className="max-w-2xl text-xs text-muted-foreground">
          The Supply Officer signs page 1 only; the other three sign every page.
        </p>
        {NSBI_SIGNATORY_ROLES.map((role) => {
          const value = draft.signatories.find((s) => s.role === role.value);
          return (
            <div
              key={role.value}
              className="grid items-end gap-3 rounded-md border p-3 sm:grid-cols-[10rem_1fr_1fr]"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium">{role.label}</span>
                {role.value === "supply_officer" ? (
                  <Badge variant="outline" className="font-normal text-[0.65rem]">
                    Page 1
                  </Badge>
                ) : null}
              </div>
              <div className="space-y-1">
                <Label htmlFor={`sig-name-${role.value}`} className="text-xs">
                  Name
                </Label>
                <Input
                  id={`sig-name-${role.value}`}
                  className="h-9"
                  value={value?.name ?? ""}
                  onChange={(e) =>
                    patchSignatory(role.value, { name: e.target.value })
                  }
                  disabled={disabled}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`sig-title-${role.value}`} className="text-xs">
                  Title as printed
                </Label>
                <Textarea
                  id={`sig-title-${role.value}`}
                  rows={2}
                  className="text-xs"
                  value={value?.title ?? ""}
                  onChange={(e) =>
                    patchSignatory(role.value, { title: e.target.value })
                  }
                  disabled={disabled}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1 lg:max-w-2xl">
        <Label htmlFor="notes" className="text-xs">
          Internal notes
        </Label>
        <Textarea
          id="notes"
          rows={3}
          placeholder="Not printed on the form."
          value={draft.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
