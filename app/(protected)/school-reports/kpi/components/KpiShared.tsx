"use client";

import { Badge } from "@/components/ui/badge";
import { KPI_INDICATOR_META } from "@/lib/constants/kpi";
import { Info } from "lucide-react";
import { ReactNode } from "react";

/**
 * Section heading for one indicator, carrying the memo's applicability note.
 *
 * The note is not decoration: the memo does not compute most of these at school
 * level, and a school head reading a GER of 143% needs to know it is measured
 * against a catchment estimate they typed in, not a PSA release.
 */
export function IndicatorSection({
  metaKey,
  title,
  description,
  isSchoolScope,
  actions,
  children,
}: {
  metaKey: keyof typeof KPI_INDICATOR_META;
  title: string;
  description?: string;
  isSchoolScope: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const meta = KPI_INDICATOR_META[metaKey];
  const showNote = isSchoolScope && meta && meta.school !== "yes";

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            {title}
            {showNote && (
              <Badge
                variant="outline"
                className={
                  meta.school === "discretionary"
                    ? "border-amber-300 bg-amber-50 text-amber-800 text-[10px] font-normal"
                    : "border-slate-300 bg-slate-50 text-slate-700 text-[10px] font-normal"
                }
              >
                {meta.school === "discretionary"
                  ? "Discretionary at school level"
                  : "Division-level indicator"}
              </Badge>
            )}
          </h3>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        {actions}
      </div>

      {showNote && meta.schoolNote && (
        <p className="flex gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>{meta.schoolNote}</span>
        </p>
      )}

      {children}
    </section>
  );
}

/** The shell every KPI table sits in — the standard app__table dress. */
export function KpiTable({
  head,
  children,
}: {
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="app__table_shell">
      <div className="app__table_wrapper">
        <table className="w-full text-sm">
          <thead>{head}</thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </div>
  );
}

/** Headline figure with its formula spelled out underneath. */
export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "muted";
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        tone === "muted" ? "bg-muted/30" : "bg-background"
      }`}
    >
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      {hint && (
        <div className="text-[11px] text-muted-foreground mt-1">{hint}</div>
      )}
    </div>
  );
}

export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
