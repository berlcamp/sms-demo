"use client";

/**
 * The learner record's "IP (Ethnic Group)" picklist.
 *
 * Presentational on purpose — it takes a value and an onChange rather than a
 * react-hook-form `control`, so the three forms that ask for this field (the
 * Students modal, the teacher's edit modal and the enrolment wizard) each wrap
 * it in their own `FormField` without this component needing to be generic over
 * their differing form types.
 *
 * A learner whose stored group predates the picklist — the field was free text
 * until now — keeps their value as an extra option at the bottom rather than
 * being silently reset to "Not IP" when someone opens the record to change
 * something else. Losing an IP tagging as a side effect of editing a phone
 * number is exactly the kind of quiet data loss the IPEd return cannot absorb.
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CARAGA_ETHNIC_GROUPS,
  ETHNIC_GROUP_OPTIONS,
  NOT_IP_OPTION_VALUE,
  isIpLearner,
} from "@/lib/constants/ethnicGroups";

interface Props {
  value: string | undefined;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Rendered inside a FormControl by the caller when true. */
  triggerClassName?: string;
}

export function EthnicGroupSelect({
  value,
  onChange,
  disabled,
  triggerClassName = "h-10",
}: Props) {
  // Radix cannot hold "" as an item value, so an empty or absent value maps to
  // the "Not IP" token. That token must be excluded from the legacy test below
  // or it would render as its own bogus "previously entered" option.
  const current = value && value.trim() !== "" ? value : NOT_IP_OPTION_VALUE;
  const isLegacy =
    current !== NOT_IP_OPTION_VALUE &&
    isIpLearner(current) &&
    !CARAGA_ETHNIC_GROUPS.includes(current);

  return (
    <Select
      onValueChange={onChange}
      value={current}
      disabled={disabled}
    >
      <SelectTrigger className={triggerClassName}>
        <SelectValue placeholder="Not IP" />
      </SelectTrigger>
      <SelectContent>
        {ETHNIC_GROUP_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
        {isLegacy && (
          <SelectItem value={current}>{current} (previously entered)</SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
