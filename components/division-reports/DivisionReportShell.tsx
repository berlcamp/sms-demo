"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Download, FileSpreadsheet, FileText, X } from "lucide-react";
import Link from "next/link";
import { ReactNode } from "react";

export interface ActiveFilter {
  label: string;
  onClear: () => void;
}

interface DivisionReportShellProps {
  title: string;
  description?: string;
  filterBar?: ReactNode;
  activeFilters?: ActiveFilter[];
  onClearFilters?: () => void;
  onExportCsv?: () => void;
  onExportExcel?: () => void;
  exportDisabled?: boolean;
  loading?: boolean;
  recordCount?: number;
  children: ReactNode;
}

export function DivisionReportShell({
  title,
  description,
  filterBar,
  activeFilters,
  onClearFilters,
  onExportCsv,
  onExportExcel,
  exportDisabled,
  loading,
  recordCount,
  children,
}: DivisionReportShellProps) {
  const hasExports = onExportCsv || onExportExcel;

  return (
    <div>
      <div className="app__title">
        <div className="flex items-center gap-3">
          <Link
            href="/division/reports"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← SDO Reports
          </Link>
        </div>
        <h1 className="app__title_text">{title}</h1>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="app__content space-y-4">
        {(filterBar || hasExports) && (
          <Card>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-1 flex-wrap items-end gap-3">
                  {filterBar}
                  {!loading && recordCount !== undefined && (
                    <span className="pb-1 text-xs text-muted-foreground">
                      {recordCount} result{recordCount !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {hasExports && (
                  <div className="flex items-end gap-3">
                    <Separator
                      orientation="vertical"
                      className="h-9 hidden sm:block"
                    />
                    <div className="flex gap-2">
                      {onExportCsv && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onExportCsv}
                          disabled={exportDisabled || loading}
                        >
                          <FileText className="mr-1.5 h-3.5 w-3.5" />
                          CSV
                        </Button>
                      )}
                      {onExportExcel && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={onExportExcel}
                          disabled={exportDisabled || loading}
                        >
                          <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                          Excel
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {activeFilters && activeFilters.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Filters:
                  </span>
                  {activeFilters.map((f, i) => (
                    <Badge
                      key={i}
                      variant="secondary"
                      className="gap-1 pr-1 text-xs"
                    >
                      {f.label}
                      <button
                        onClick={f.onClear}
                        className="ml-1 rounded hover:bg-background/60"
                        aria-label={`Remove ${f.label}`}
                        type="button"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                  {onClearFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={onClearFilters}
                    >
                      Clear all
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {loading ? (
          <Card className="overflow-hidden">
            <CardContent className="p-0">
              <div className="flex gap-6 border-b bg-muted/40 px-4 py-3">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="ml-auto h-3 w-20" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3 w-16" />
              </div>
              {[140, 180, 110, 160, 130].map((w, i) => (
                <div
                  key={i}
                  className="flex gap-6 border-b px-4 py-3.5 last:border-0"
                >
                  <Skeleton className="h-4" style={{ width: `${w}px` }} />
                  <Skeleton className="ml-auto h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))}
            </CardContent>
          </Card>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * The card every division report's table sits in. `app__table_shell` is what
 * gives it the same border, muted header and row dividers as the Students,
 * Rooms and Staff lists; only the numeric alignment is this shell's own.
 */
export function ReportTableCard({
  children,
  caption,
}: {
  children: ReactNode;
  caption?: string;
}) {
  return (
    <div className="app__table_shell [&_tbody_td]:tabular-nums">
      {caption && (
        <div className="border-b border-border bg-muted/50 px-6 py-2 text-sm font-medium">
          {caption}
        </div>
      )}
      {children}
    </div>
  );
}

export function EmptyReportState({
  message,
  action,
}: {
  message: string;
  action?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <Download className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{message}</p>
        {action}
      </CardContent>
    </Card>
  );
}
